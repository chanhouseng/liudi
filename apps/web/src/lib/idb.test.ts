import 'fake-indexeddb/auto'

import { beforeEach, describe, expect, it } from 'vitest'

import type { Case } from '@/domain/types'
import { parseImportPayload } from '@/domain/repo'
import { computeChainHash, verifyChain } from './hash'
import {
  addCapture,
  addDefect,
  addPhoto,
  addRoom,
  addRoomToCase,
  addSlotPhoto,
  createCaseWithRooms,
  db,
  deleteCaseCascade,
  deleteDefect,
  exportAll,
  getRoomShotMap,
  getSlotPhotoByPhase,
  importAll,
  listCompareSlots,
  listPhotoDefects,
  listRooms,
  putCase,
  setDefectPhenomenon,
} from './idb'

const baseCase: Case = {
  id: 'c1',
  alias: '文一西路 3 幢',
  city: 'hangzhou',
  addressMasked: '文一西路 3 幢',
  rentMonthly: 400000,
  deposit: 400000,
  leaseStart: '2025-09-01',
  leaseEnd: '2026-11-01',
  landlordType: 'personal',
  createdAt: '2026-11-15T00:00:00.000Z',
}

async function seedFullCase(): Promise<void> {
  await putCase(baseCase)
  await addRoom({ id: 'r1', caseId: 'c1', kind: 'living', label: '客厅' })
  await addCapture({
    id: 'cp1',
    roomId: 'r1',
    phase: 'move_in',
    takenAt: '2026-11-15T00:00:00.000Z',
    device: 'test',
  })
  await addPhoto({
    id: 'p1',
    captureId: 'cp1',
    slot: 'wall-n',
    blob: new Blob(['a']),
    thumb: new Blob(['b']),
    takenAt: '2026-11-15T00:00:00.000Z',
    sha256: 'aa',
    prevHash: 'GENESIS',
    chainHash: 'cc',
  })
  await db.defects.put({
    id: 'd1',
    photoId: 'p1',
    bbox: [0.1, 0.1, 0.5, 0.5],
    phenomenon: 'stain',
    source: 'manual',
    confidence: 1,
    seq: 1,
  })
  await db.findings.put({
    id: 'f1',
    roomId: 'r1',
    photoOutId: 'p1',
    bbox: [0.1, 0.1, 0.5, 0.5],
    phenomenon: 'stain',
    surface: 'wall',
    severity: 'moderate',
    needsRephoto: false,
  })
  await db.judgements.put({
    findingId: 'f1',
    cls: 'B',
    ruleId: 'B-01',
    reason: '日常使用形成的表面污渍，属正常损耗',
    legalRefs: ['civil-710'],
    confidence: 0.9,
  })
  await db.deductions.put({
    id: 'dd1',
    caseId: 'c1',
    rawText: '保洁 600',
    label: '退租深度保洁',
    amount: 60000,
    quantity: 1,
    estimate: { low: 28000, mid: 42000, high: 70000 },
    depreciation: { years: 0, lifespan: 1, residualRatio: 1 },
    liableAmount: 0,
    status: 'disputed',
    reason: '退租前已做过保洁',
  })
  await db.letters.put({
    id: 'l1',
    caseId: 'c1',
    tone: 'neutral',
    channel: 'wechat',
    subject: '押金对一下',
    body: '……',
    citations: [],
    createdAt: '2026-11-15T00:00:00.000Z',
  })
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('数据层', () => {
  it('创建 case → room → capture → photo 后各表可查，缩略图独立成表', async () => {
    await seedFullCase()
    expect(await db.cases.count()).toBe(1)
    expect(await db.rooms.count()).toBe(1)
    expect(await db.captures.count()).toBe(1)
    expect(await db.photos.count()).toBe(1)
    expect(await db.thumbs.count()).toBe(1)
    expect(await db.defects.count()).toBe(1)
  })

  it('删除 case 后所有子记录为 0（级联）', async () => {
    await seedFullCase()
    await deleteCaseCascade('c1')
    const tables = [
      db.cases,
      db.rooms,
      db.captures,
      db.photos,
      db.thumbs,
      db.defects,
      db.findings,
      db.judgements,
      db.deductions,
      db.letters,
    ]
    for (const t of tables) {
      expect(await t.count()).toBe(0)
    }
  })

  it('级联删除不影响其他案件', async () => {
    await seedFullCase()
    await putCase({ ...baseCase, id: 'c2', alias: '另一处' })
    await addRoom({ id: 'r9', caseId: 'c2', kind: 'bath', label: '卫生间' })
    await deleteCaseCascade('c1')
    expect(await db.cases.count()).toBe(1)
    const rooms = await db.rooms.toArray()
    expect(rooms.map((r) => r.id)).toEqual(['r9'])
  })

  it('exportAll 不含二进制；importAll 回导成功并提示照片缺失', async () => {
    await seedFullCase()
    const payload = await exportAll()
    const json = JSON.stringify(payload)
    expect(json).not.toContain('blob')

    await db.delete()
    await db.open()

    const parsed = parseImportPayload(json)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.missingPhotos).toBe(true)

    await importAll(parsed.payload)
    expect(await db.cases.count()).toBe(1)
    expect(await db.photos.count()).toBe(1)
    expect((await db.photos.toArray())[0].blob).toBeNull()
    expect(await db.thumbs.count()).toBe(0)
  })
})

describe('取证数据', () => {
  it('createCaseWithRooms 播种 6 个默认房间（共 18 点位）', async () => {
    await createCaseWithRooms(baseCase, [
      'entry',
      'living',
      'bedroom',
      'kitchen',
      'bath',
      'balcony',
    ])
    const rooms = await listRooms('c1')
    expect(rooms.map((r) => r.label)).toEqual([
      '玄关',
      '客厅',
      '卧室',
      '厨房',
      '卫生间',
      '阳台',
    ])
    expect(rooms.length).toBe(6)
  })

  it('addSlotPhoto 自动建 move_in capture；重拍同点位保留旧图，shotMap 取最新', async () => {
    await putCase(baseCase)
    await addRoom({ id: 'r1', caseId: 'c1', kind: 'living', label: '客厅' })

    await addSlotPhoto('r1', 'wall-n', {
      blob: new Blob(['old']),
      thumb: new Blob(['old-t']),
      sha256: 'old',
    })
    expect(await db.captures.count()).toBe(1)
    expect(await db.photos.count()).toBe(1)

    await addSlotPhoto('r1', 'wall-n', {
      blob: new Blob(['new']),
      thumb: new Blob(['new-t']),
      sha256: 'new',
    })
    expect(await db.captures.count()).toBe(1)
    expect(await db.photos.count()).toBe(2)
    expect(await db.thumbs.count()).toBe(2)

    const shot = await getRoomShotMap('r1')
    expect(shot.size).toBe(1)
    expect(shot.get('wall-n')?.sha256).toBe('new')
  })

  it('addSlotPhoto 不同点位各自入册', async () => {
    await putCase(baseCase)
    await addRoom({ id: 'r1', caseId: 'c1', kind: 'living', label: '客厅' })
    await addSlotPhoto('r1', 'wall-n', { blob: new Blob(['a']), thumb: new Blob(['t']), sha256: 'a' })
    await addSlotPhoto('r1', 'floor', { blob: new Blob(['b']), thumb: new Blob(['t']), sha256: 'b' })
    const shot = await getRoomShotMap('r1')
    expect(shot.size).toBe(2)
    expect(shot.has('wall-n')).toBe(true)
    expect(shot.has('floor')).toBe(true)
  })

  it('addRoomToCase 同类型重复添加时标签递增', async () => {
    await putCase(baseCase)
    const first = await addRoomToCase('c1', 'bedroom')
    expect(first.label).toBe('卧室')
    const second = await addRoomToCase('c1', 'bedroom')
    expect(second.label).toBe('卧室 2')
  })
})

describe('证据链与瑕疵', () => {
  it('addSlotPhoto 顺序入链：首张 prevHash=GENESIS，verifyChain 全链通过', async () => {
    await putCase(baseCase)
    await addRoom({ id: 'r1', caseId: 'c1', kind: 'living', label: '客厅' })
    await addSlotPhoto('r1', 'wall-n', { blob: new Blob(['a']), thumb: new Blob(['t']), sha256: 'aa' })
    await new Promise((r) => setTimeout(r, 2))
    await addSlotPhoto('r1', 'floor', { blob: new Blob(['b']), thumb: new Blob(['t']), sha256: 'bb' })

    const photos = await db.photos.orderBy('takenAt').toArray()
    expect(photos).toHaveLength(2)
    expect(photos[0].prevHash).toBe('GENESIS')
    expect(photos[0].chainHash).toBe(
      await computeChainHash('GENESIS', photos[0].sha256, photos[0].takenAt),
    )
    expect(photos[1].prevHash).toBe(photos[0].chainHash)
    expect(await verifyChain(photos)).toEqual({ ok: true, count: 2 })
  })

  it('篡改库内照片 sha256 → verifyChain 报出断链位置', async () => {
    await putCase(baseCase)
    await addRoom({ id: 'r1', caseId: 'c1', kind: 'living', label: '客厅' })
    await addSlotPhoto('r1', 'wall-n', { blob: new Blob(['a']), thumb: new Blob(['t']), sha256: 'aa' })
    await new Promise((r) => setTimeout(r, 2))
    await addSlotPhoto('r1', 'floor', { blob: new Blob(['b']), thumb: new Blob(['t']), sha256: 'bb' })

    const photos = await db.photos.orderBy('takenAt').toArray()
    await db.photos.update(photos[1].id, { sha256: 'tampered' })
    const after = await db.photos.orderBy('takenAt').toArray()
    const r = await verifyChain(after)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.breakIndex).toBe(1)
      expect(r.photoId).toBe(photos[1].id)
      expect(r.reason).toBe('hash-mismatch')
    }
  })

  it('addDefect 序号案件内递增；删除后不回收', async () => {
    await putCase(baseCase)
    await addRoom({ id: 'r1', caseId: 'c1', kind: 'living', label: '客厅' })
    await addSlotPhoto('r1', 'wall-n', { blob: new Blob(['a']), thumb: new Blob(['t']), sha256: 'aa' })
    const photo = (await db.photos.toArray())[0]

    const d1 = await addDefect(photo.id, { bbox: [0.1, 0.1, 0.2, 0.2], phenomenon: 'stain' })
    const d2 = await addDefect(photo.id, { bbox: [0.3, 0.3, 0.2, 0.2], phenomenon: 'scratch' })
    expect(d1.seq).toBe(1)
    expect(d2.seq).toBe(2)

    await deleteDefect(d1.id)
    const d3 = await addDefect(photo.id, { bbox: [0.5, 0.5, 0.1, 0.1], phenomenon: 'chip' })
    expect(d3.seq).toBe(3)

    const list = await listPhotoDefects(photo.id)
    expect(list.map((d) => d.seq)).toEqual([2, 3])
  })

  it('seq 按案件隔离；setDefectPhenomenon 可改', async () => {
    await putCase(baseCase)
    await addRoom({ id: 'r1', caseId: 'c1', kind: 'living', label: '客厅' })
    await addSlotPhoto('r1', 'wall-n', { blob: new Blob(['a']), thumb: new Blob(['t']), sha256: 'aa' })
    const p1 = (await db.photos.toArray())[0]
    await addDefect(p1.id, { bbox: [0.1, 0.1, 0.2, 0.2], phenomenon: 'stain' })
    await addDefect(p1.id, { bbox: [0.3, 0.3, 0.2, 0.2], phenomenon: 'scratch' })

    await putCase({ ...baseCase, id: 'c2', alias: '另一处' })
    await addRoom({ id: 'r9', caseId: 'c2', kind: 'bath', label: '卫生间' })
    await addSlotPhoto('r9', 'fixture', { blob: new Blob(['c']), thumb: new Blob(['t']), sha256: 'cc' })
    const photos = await db.photos.where('captureId').anyOf(
      (await db.captures.where('roomId').equals('r9').toArray()).map((c) => c.id),
    ).toArray()
    const p9 = photos[0]
    const d9 = await addDefect(p9.id, { bbox: [0, 0, 0.1, 0.1], phenomenon: 'rust' })
    expect(d9.seq).toBe(1)

    await setDefectPhenomenon(d9.id, 'dirt')
    const list = await listPhotoDefects(p9.id)
    expect(list[0].phenomenon).toBe('dirt')
  })
})

describe('退租相与对比槽位', () => {
  it('addSlotPhoto 默认入住相；phase=move_out 建独立退租相，两相照片分属不同 capture', async () => {
    await putCase(baseCase)
    await addRoom({ id: 'r1', caseId: 'c1', kind: 'living', label: '客厅' })
    await addSlotPhoto('r1', 'wall-n', { blob: new Blob(['a']), thumb: new Blob(['t']), sha256: 'aa' })
    await addSlotPhoto('r1', 'wall-n', { blob: new Blob(['b']), thumb: new Blob(['t']), sha256: 'bb' }, 'move_out')

    const captures = await db.captures.where('roomId').equals('r1').toArray()
    expect(captures.map((c) => c.phase).sort()).toEqual(['move_in', 'move_out'])
    expect(await db.photos.count()).toBe(2)
    const inPhoto = await getSlotPhotoByPhase('r1', 'wall-n', 'move_in')
    const outPhoto = await getSlotPhotoByPhase('r1', 'wall-n', 'move_out')
    expect(inPhoto?.sha256).toBe('aa')
    expect(outPhoto?.sha256).toBe('bb')
    expect(await getSlotPhotoByPhase('r1', 'wall-s', 'move_out')).toBeUndefined()
    expect(await getSlotPhotoByPhase('r1', 'floor', 'move_in')).toBeUndefined()
  })

  it('listCompareSlots 按模板序返回槽位并标记两相有无', async () => {
    await putCase(baseCase)
    await addRoom({ id: 'r1', caseId: 'c1', kind: 'living', label: '客厅' })
    await addRoom({ id: 'r2', caseId: 'c1', kind: 'entry', label: '玄关' })
    // 客厅：wall-n 拍满两相；floor 只拍入住
    await addSlotPhoto('r1', 'wall-n', { blob: new Blob(['a']), thumb: new Blob(['t']), sha256: 'a' })
    await addSlotPhoto('r1', 'floor', { blob: new Blob(['b']), thumb: new Blob(['t']), sha256: 'b' })
    await addSlotPhoto('r1', 'wall-n', { blob: new Blob(['c']), thumb: new Blob(['t']), sha256: 'c' }, 'move_out')
    // 玄关：只拍退租
    await addSlotPhoto('r2', 'door', { blob: new Blob(['d']), thumb: new Blob(['t']), sha256: 'd' }, 'move_out')

    const rows = await listCompareSlots('c1')
    // 房间序：玄关(entry) 在客厅(living) 前；槽位按模板序
    expect(rows.map((r) => `${r.roomLabel}/${r.slotId}`)).toEqual([
      '玄关/door',
      '玄关/floor',
      '玄关/meter-e',
      '客厅/wall-n',
      '客厅/wall-s',
      '客厅/floor',
      '客厅/window',
    ])
    const byKey = new Map(rows.map((r) => [`${r.roomLabel}/${r.slotId}`, r]))
    expect(byKey.get('客厅/wall-n')).toMatchObject({ hasMoveIn: true, hasMoveOut: true, slotLabel: '墙面-北' })
    expect(byKey.get('客厅/floor')).toMatchObject({ hasMoveIn: true, hasMoveOut: false })
    expect(byKey.get('玄关/door')).toMatchObject({ hasMoveIn: false, hasMoveOut: true })
    expect(byKey.get('玄关/floor')).toMatchObject({ hasMoveIn: false, hasMoveOut: false })
  })
})
