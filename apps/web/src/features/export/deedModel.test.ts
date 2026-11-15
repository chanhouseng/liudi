import { describe, expect, it } from 'vitest'

import type { Case, Capture, Defect, Room } from '@/domain/types'
import { assembleDeed, caseNoOf } from './deedModel'

const baseCase: Case = {
  id: 'abcdef12-3456-7890-abcd-ef1234567890',
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

const rooms: Room[] = [
  { id: 'r1', caseId: 'c', kind: 'entry', label: '玄关' },
  { id: 'r2', caseId: 'c', kind: 'living', label: '客厅' },
]

const captures: Capture[] = [
  { id: 'cp1', roomId: 'r1', phase: 'move_in', takenAt: '2026-11-15T00:00:00.000Z', device: 't' },
  { id: 'cp2', roomId: 'r2', phase: 'move_in', takenAt: '2026-11-15T00:01:00.000Z', device: 't' },
]

const photos = [
  {
    id: 'p2',
    captureId: 'cp2',
    slot: 'floor',
    takenAt: '2026-11-15T10:01:00.000Z',
    sha256: 'bb',
    prevHash: 'x',
    chainHash: 'h2',
  },
  {
    id: 'p1',
    captureId: 'cp1',
    slot: 'door',
    takenAt: '2026-11-15T10:00:00.000Z',
    sha256: 'aa',
    prevHash: 'GENESIS',
    chainHash: 'h1',
  },
  {
    id: 'p3',
    captureId: 'cp2',
    slot: 'unknown-slot',
    takenAt: '2026-11-15T10:02:00.000Z',
    sha256: 'cc',
    prevHash: '',
    chainHash: '',
  },
]

const defects: Defect[] = [
  {
    id: 'd1',
    photoId: 'p2',
    bbox: [0.1, 0.1, 0.2, 0.2],
    phenomenon: 'stain',
    source: 'manual',
    confidence: 1,
    seq: 1,
  },
]

const ORDER = ['entry', 'living', 'bedroom', 'kitchen', 'bath', 'balcony']

describe('底稿装配', () => {
  it('案件编号取 id 前 8 位', () => {
    expect(caseNoOf(baseCase)).toBe('LD-abcdef12')
  })

  it('P 编号按拍摄时间全局递增；点位中文名从模板取', () => {
    const m = assembleDeed(baseCase, rooms, captures, photos, defects, ORDER)
    expect(m.photos.map((p) => p.pNo)).toEqual([1, 2, 3])
    expect(m.photos[0].id).toBe('p1')
    expect(m.photos[0].slotLabel).toBe('门与门锁')
    expect(m.photos[2].slotLabel).toBe('unknown-slot')
  })

  it('照片墙按房间分组，房间按固定顺序', () => {
    const m = assembleDeed(baseCase, rooms, captures, photos, defects, ORDER)
    expect(m.byRoom.map((g) => g.roomLabel)).toEqual(['玄关', '客厅'])
    expect(m.byRoom[0].photos.map((p) => p.pNo)).toEqual([1])
    expect(m.byRoom[1].photos.map((p) => p.pNo)).toEqual([2, 3])
  })

  it('瑕疵映射到照片 P 编号；未入链照片单独过滤', () => {
    const m = assembleDeed(baseCase, rooms, captures, photos, defects, ORDER)
    expect(m.defects).toHaveLength(1)
    expect(m.defects[0].pNo).toBe(2)
    expect(m.defects[0].roomLabel).toBe('客厅')
    expect(m.chained.map((p) => p.id)).toEqual(['p1', 'p2'])
  })

  it('孤儿瑕疵（照片不存在）被剔除', () => {
    const orphan: Defect = { ...defects[0], id: 'd9', photoId: 'nope', seq: 2 }
    const m = assembleDeed(baseCase, rooms, captures, photos, [defects[0], orphan], ORDER)
    expect(m.defects.map((d) => d.id)).toEqual(['d1'])
  })
})
