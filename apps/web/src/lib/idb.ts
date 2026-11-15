import Dexie, { type EntityTable } from 'dexie'

import { findSlot, getRoomTemplate } from '@/content/roomTemplates'
import { newId } from '@/domain/repo'
import {
  buildExportPayload,
  collectCaseTree,
  type CaseTreeSnapshot,
  type ExportPayload,
} from '@/domain/repo'
import type {
  BBox,
  Case,
  Capture,
  CapturePhase,
  DeductionItem,
  Defect,
  Finding,
  ID,
  Judgement,
  Letter,
  Phenomenon,
  Photo,
  Room,
  RoomKind,
} from '@/domain/types'
import { computeChainHash, GENESIS } from './hash'

export interface PhotoRecord extends Omit<Photo, 'thumb' | 'blob'> {
  blob: Blob | null
}

export interface ThumbRecord {
  id: ID
  blob: Blob
}

export class LiudiDB extends Dexie {
  cases!: EntityTable<Case, 'id'>
  rooms!: EntityTable<Room, 'id'>
  captures!: EntityTable<Capture, 'id'>
  photos!: EntityTable<PhotoRecord, 'id'>
  thumbs!: EntityTable<ThumbRecord, 'id'>
  defects!: EntityTable<Defect, 'id'>
  findings!: EntityTable<Finding, 'id'>
  judgements!: EntityTable<Judgement, 'findingId'>
  deductions!: EntityTable<DeductionItem, 'id'>
  letters!: EntityTable<Letter, 'id'>

  constructor() {
    super('liudi')
    this.version(1).stores({
      cases: 'id, createdAt',
      rooms: 'id, caseId',
      captures: 'id, roomId',
      photos: 'id, captureId, takenAt',
      thumbs: 'id',
      defects: 'id, photoId',
      findings: 'id, roomId',
      judgements: 'findingId',
      deductions: 'id, caseId',
      letters: 'id, caseId, createdAt',
    })
  }
}

export const db = new LiudiDB()

export async function putCase(c: Case): Promise<void> {
  await db.cases.put(c)
}

export async function getCase(id: ID): Promise<Case | undefined> {
  return db.cases.get(id)
}

export async function addRoom(room: Room): Promise<void> {
  await db.rooms.put(room)
}

export async function addCapture(capture: Capture): Promise<void> {
  await db.captures.put(capture)
}

export async function addPhoto(photo: Photo): Promise<void> {
  const row: PhotoRecord = {
    id: photo.id,
    captureId: photo.captureId,
    slot: photo.slot,
    takenAt: photo.takenAt,
    sha256: photo.sha256,
    prevHash: photo.prevHash,
    chainHash: photo.chainHash,
    blob: photo.blob,
  }
  await db.transaction('rw', [db.photos, db.thumbs], async () => {
    await db.photos.put(row)
    await db.thumbs.put({ id: photo.id, blob: photo.thumb })
  })
}

async function loadCaseSnapshot(caseId: ID): Promise<CaseTreeSnapshot> {
  const rooms = await db.rooms.where('caseId').equals(caseId).toArray()
  const roomIds = rooms.map((r) => r.id)
  const captures = roomIds.length
    ? await db.captures.where('roomId').anyOf(roomIds).toArray()
    : []
  const captureIds = captures.map((c) => c.id)
  const photos = captureIds.length
    ? await db.photos.where('captureId').anyOf(captureIds).toArray()
    : []
  const photoIds = photos.map((p) => p.id)
  const defects = photoIds.length
    ? await db.defects.where('photoId').anyOf(photoIds).toArray()
    : []
  const findings = roomIds.length
    ? await db.findings.where('roomId').anyOf(roomIds).toArray()
    : []
  const findingIds = findings.map((f) => f.id)
  const judgements = findingIds.length
    ? await db.judgements.where('findingId').anyOf(findingIds).toArray()
    : []
  const deductions = await db.deductions.where('caseId').equals(caseId).toArray()
  const letters = await db.letters.where('caseId').equals(caseId).toArray()
  return { rooms, captures, photos, defects, findings, judgements, deductions, letters }
}

export async function deleteCaseCascade(caseId: ID): Promise<void> {
  await db.transaction(
    'rw',
    [
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
    ],
    async () => {
      const snap = await loadCaseSnapshot(caseId)
      const ids = collectCaseTree(caseId, snap)
      await db.thumbs.bulkDelete(ids.photoIds)
      await db.photos.bulkDelete(ids.photoIds)
      await db.defects.bulkDelete(ids.defectIds)
      await db.captures.bulkDelete(ids.captureIds)
      await db.judgements.bulkDelete(ids.judgementKeys)
      await db.findings.bulkDelete(ids.findingIds)
      await db.rooms.bulkDelete(ids.roomIds)
      await db.deductions.bulkDelete(ids.deductionIds)
      await db.letters.bulkDelete(ids.letterIds)
      await db.cases.delete(caseId)
    },
  )
}

export async function exportAll(): Promise<ExportPayload> {
  const [cases, rooms, captures, photos, defects, findings, judgements, deductions, letters] =
    await Promise.all([
      db.cases.toArray(),
      db.rooms.toArray(),
      db.captures.toArray(),
      db.photos.toArray(),
      db.defects.toArray(),
      db.findings.toArray(),
      db.judgements.toArray(),
      db.deductions.toArray(),
      db.letters.toArray(),
    ])
  return buildExportPayload(
    { cases, rooms, captures, photos, defects, findings, judgements, deductions, letters },
    new Date().toISOString(),
  )
}

export async function importAll(payload: ExportPayload): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.cases,
      db.rooms,
      db.captures,
      db.photos,
      db.defects,
      db.findings,
      db.judgements,
      db.deductions,
      db.letters,
    ],
    async () => {
      await db.cases.bulkPut(payload.cases)
      await db.rooms.bulkPut(payload.rooms)
      await db.captures.bulkPut(payload.captures)
      await db.photos.bulkPut(payload.photos.map((p) => ({ ...p, blob: null })))
      await db.defects.bulkPut(payload.defects)
      await db.findings.bulkPut(payload.findings)
      await db.judgements.bulkPut(payload.judgements)
      await db.deductions.bulkPut(payload.deductions)
      await db.letters.bulkPut(payload.letters)
    },
  )
}

export interface CaseProgress {
  capture: boolean
  compare: boolean
  value: boolean
  negotiate: boolean
}

export async function getCaseProgress(caseId: ID): Promise<CaseProgress> {
  const rooms = await db.rooms.where('caseId').equals(caseId).toArray()
  const roomIds = rooms.map((r) => r.id)
  const captures = roomIds.length
    ? await db.captures.where('roomId').anyOf(roomIds).toArray()
    : []
  const captureIds = captures.map((c) => c.id)
  const photoCount = captureIds.length
    ? await db.photos.where('captureId').anyOf(captureIds).count()
    : 0
  const findingCount = roomIds.length
    ? await db.findings.where('roomId').anyOf(roomIds).count()
    : 0
  const deductionCount = await db.deductions.where('caseId').equals(caseId).count()
  const letterCount = await db.letters.where('caseId').equals(caseId).count()
  return {
    capture: photoCount > 0,
    compare: findingCount > 0,
    value: deductionCount > 0,
    negotiate: letterCount > 0,
  }
}

export interface CaseSummary {
  data: Case
  progress: CaseProgress
}

export async function listCaseSummaries(limit = 3): Promise<CaseSummary[]> {
  const cases = await db.cases.orderBy('createdAt').reverse().limit(limit).toArray()
  return Promise.all(
    cases.map(async (c) => ({ data: c, progress: await getCaseProgress(c.id) })),
  )
}

const ROOM_ORDER: RoomKind[] = ['entry', 'living', 'bedroom', 'kitchen', 'bath', 'balcony']

export async function listRooms(caseId: ID): Promise<Room[]> {
  const rooms = await db.rooms.where('caseId').equals(caseId).toArray()
  const order = new Map(ROOM_ORDER.map((k, i) => [k, i]))
  return rooms.sort(
    (a, b) => (order.get(a.kind) ?? 99) - (order.get(b.kind) ?? 99),
  )
}

// 同一点位允许多条照片（重拍保留旧图，不替换），这里返回每个点位的最新一条。
export async function getRoomShotMap(roomId: ID): Promise<Map<string, PhotoRecord>> {
  const captures = await db.captures.where('roomId').equals(roomId).toArray()
  const captureIds = captures.filter((c) => c.phase === 'move_in').map((c) => c.id)
  if (captureIds.length === 0) return new Map()
  const photos = await db.photos.where('captureId').anyOf(captureIds).toArray()
  const latest = new Map<string, PhotoRecord>()
  for (const p of photos) {
    const cur = latest.get(p.slot)
    if (!cur || p.takenAt > cur.takenAt) latest.set(p.slot, p)
  }
  return latest
}

export interface SlotPhotoInput {
  blob: Blob
  thumb: Blob
  sha256: string
}

export async function addSlotPhoto(
  roomId: ID,
  slotId: string,
  input: SlotPhotoInput,
  phase: CapturePhase = 'move_in',
): Promise<void> {
  const takenAt = new Date().toISOString()
  // 哈希在事务外算：WebCrypto 的原生 promise 不受 Dexie 事务区管理，事务内 await 可能导致提前提交。
  // prev 取同案件里最新一条已入链照片（chainHash 非空）；哈希算不出时存空串，照片不入链，流程不断。
  const room = await db.rooms.get(roomId)
  let prevHash = GENESIS
  if (room) {
    const rooms = await db.rooms.where('caseId').equals(room.caseId).toArray()
    const captures = rooms.length
      ? await db.captures.where('roomId').anyOf(rooms.map((r) => r.id)).toArray()
      : []
    const photos = captures.length
      ? await db.photos.where('captureId').anyOf(captures.map((c) => c.id)).toArray()
      : []
    const chained = photos.filter((p) => p.chainHash).sort(bySavedOrder)
    const last = chained[chained.length - 1]
    if (last) prevHash = last.chainHash
  }
  let chainHash = ''
  try {
    chainHash = await computeChainHash(prevHash, input.sha256, takenAt)
  } catch {
    chainHash = ''
    prevHash = ''
  }
  await db.transaction('rw', [db.captures, db.photos, db.thumbs], async () => {
    const captures = await db.captures.where('roomId').equals(roomId).toArray()
    let capture = captures.find((c) => c.phase === phase)
    if (!capture) {
      capture = {
        id: newId(),
        roomId,
        phase,
        takenAt,
        device: 'browser',
      }
      await db.captures.put(capture)
    }
    const photoId = newId()
    await db.photos.put({
      id: photoId,
      captureId: capture.id,
      slot: slotId,
      takenAt,
      sha256: input.sha256,
      prevHash,
      chainHash,
      blob: input.blob,
    })
    await db.thumbs.put({ id: photoId, blob: input.thumb })
  })
}

// 取某房间某点位指定相（入住/退租）的最新一张；没有则 undefined。
export async function getSlotPhotoByPhase(
  roomId: ID,
  slotId: string,
  phase: CapturePhase,
): Promise<PhotoRecord | undefined> {
  const captures = await db.captures.where('roomId').equals(roomId).toArray()
  const captureIds = captures.filter((c) => c.phase === phase).map((c) => c.id)
  if (captureIds.length === 0) return undefined
  const photos = await db.photos.where('captureId').anyOf(captureIds).toArray()
  const forSlot = photos.filter((p) => p.slot === slotId).sort(bySavedOrder)
  return forSlot[forSlot.length - 1]
}

export interface CompareSlotRow {
  roomId: ID
  roomLabel: string
  slotId: string
  slotLabel: string
  hasMoveIn: boolean
  hasMoveOut: boolean
}

// 对比页槽位清单：房间按模板序，点位按模板序；hasMoveIn/hasMoveOut 驱动每行状态。
export async function listCompareSlots(caseId: ID): Promise<CompareSlotRow[]> {
  const rooms = await listRooms(caseId)
  const rows: CompareSlotRow[] = []
  for (const room of rooms) {
    const slots = getRoomTemplate(room.kind).slots
    const captures = await db.captures.where('roomId').equals(room.id).toArray()
    const idsByPhase = (phase: CapturePhase) =>
      captures.filter((c) => c.phase === phase).map((c) => c.id)
    const moveInIds = idsByPhase('move_in')
    const moveOutIds = idsByPhase('move_out')
    const slotsWith = async (captureIds: ID[]): Promise<Set<string>> => {
      if (captureIds.length === 0) return new Set()
      const photos = await db.photos.where('captureId').anyOf(captureIds).toArray()
      return new Set(photos.map((p) => p.slot))
    }
    const [moveInSlots, moveOutSlots] = await Promise.all([slotsWith(moveInIds), slotsWith(moveOutIds)])
    for (const s of slots) {
      rows.push({
        roomId: room.id,
        roomLabel: room.label,
        slotId: s.id,
        slotLabel: findSlot(room.kind, s.id)?.label ?? s.id,
        hasMoveIn: moveInSlots.has(s.id),
        hasMoveOut: moveOutSlots.has(s.id),
      })
    }
  }
  return rows
}

function bySavedOrder(a: { takenAt: string; id: ID }, b: { takenAt: string; id: ID }): number {
  if (a.takenAt !== b.takenAt) return a.takenAt < b.takenAt ? -1 : 1
  return a.id < b.id ? -1 : 1
}

export async function listPhotoDefects(photoId: ID): Promise<Defect[]> {
  const defects = await db.defects.where('photoId').equals(photoId).toArray()
  return defects.sort((a, b) => a.seq - b.seq)
}

export interface DefectInput {
  bbox: BBox
  phenomenon: Phenomenon
}

export async function addDefect(photoId: ID, input: DefectInput): Promise<Defect> {
  return db.transaction('rw', [db.defects, db.photos, db.captures, db.rooms], async () => {
    const photo = await db.photos.get(photoId)
    if (!photo) throw new Error('照片不存在')
    const capture = await db.captures.get(photo.captureId)
    const room = capture ? await db.rooms.get(capture.roomId) : undefined
    const rooms = room
      ? await db.rooms.where('caseId').equals(room.caseId).toArray()
      : []
    const captures = rooms.length
      ? await db.captures.where('roomId').anyOf(rooms.map((r) => r.id)).toArray()
      : []
    const photos = captures.length
      ? await db.photos.where('captureId').anyOf(captures.map((c) => c.id)).toArray()
      : []
    const caseDefects = photos.length
      ? await db.defects.where('photoId').anyOf(photos.map((p) => p.id)).toArray()
      : []
    const seq = caseDefects.reduce((m, d) => Math.max(m, d.seq), 0) + 1
    const defect: Defect = {
      id: newId(),
      photoId,
      bbox: input.bbox,
      phenomenon: input.phenomenon,
      source: 'manual',
      confidence: 1,
      seq,
    }
    await db.defects.put(defect)
    return defect
  })
}

export async function deleteDefect(id: ID): Promise<void> {
  await db.defects.delete(id)
}

export async function setDefectPhenomenon(id: ID, phenomenon: Phenomenon): Promise<void> {
  await db.defects.update(id, { phenomenon })
}

export async function addRoomToCase(caseId: ID, kind: RoomKind): Promise<Room> {
  const existing = await db.rooms.where('caseId').equals(caseId).toArray()
  const sameKindCount = existing.filter((r) => r.kind === kind).length
  const base = getRoomTemplate(kind).label
  const room: Room = {
    id: newId(),
    caseId,
    kind,
    label: sameKindCount === 0 ? base : `${base} ${sameKindCount + 1}`,
  }
  await db.rooms.put(room)
  return room
}

export async function createCaseWithRooms(c: Case, kinds: RoomKind[]): Promise<void> {
  await db.transaction('rw', [db.cases, db.rooms], async () => {
    await db.cases.put(c)
    await db.rooms.bulkPut(
      kinds.map((kind) => ({
        id: newId(),
        caseId: c.id,
        kind,
        label: getRoomTemplate(kind).label,
      })),
    )
  })
}
