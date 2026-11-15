import { findSlot, getRoomTemplate } from '@/content/roomTemplates'
import type { Case, Capture, Defect, ID, Room } from '@/domain/types'

export interface PhotoLike {
  id: ID
  captureId: ID
  slot: string
  takenAt: string
  sha256: string
  prevHash: string
  chainHash: string
}

export interface DeedPhoto extends PhotoLike {
  pNo: number
  roomLabel: string
  slotLabel: string
}

export interface DeedDefect {
  id: ID
  seq: number
  phenomenon: Defect['phenomenon']
  bbox: Defect['bbox']
  pNo: number
  roomLabel: string
  slotLabel: string
}

export interface DeedModel {
  caseNo: string
  photos: DeedPhoto[]
  byRoom: { roomLabel: string; photos: DeedPhoto[] }[]
  defects: DeedDefect[]
  chained: DeedPhoto[]
}

export function caseNoOf(c: Case): string {
  return `LD-${c.id.slice(0, 8)}`
}

function bySavedOrder(a: PhotoLike, b: PhotoLike): number {
  if (a.takenAt !== b.takenAt) return a.takenAt < b.takenAt ? -1 : 1
  return a.id < b.id ? -1 : 1
}

// 底稿数据装配（纯函数，Node 可测）：P 编号按拍摄顺序全局递增且永不重排（照片不删）。
export function assembleDeed(
  caseData: Case,
  rooms: Room[],
  captures: Pick<Capture, 'id' | 'roomId'>[],
  photos: PhotoLike[],
  defects: Defect[],
  roomOrder: string[],
): DeedModel {
  const roomById = new Map(rooms.map((r) => [r.id, r]))
  const captureRoom = new Map(captures.map((c) => [c.id, c.roomId]))
  const sorted = [...photos].sort(bySavedOrder)
  const all: DeedPhoto[] = sorted.map((p, i) => {
    const roomId = captureRoom.get(p.captureId)
    const room = roomId ? roomById.get(roomId) : undefined
    const slot = room ? safeSlot(room.kind, p.slot) : undefined
    return {
      ...p,
      pNo: i + 1,
      roomLabel: room?.label ?? '未知房间',
      slotLabel: slot?.label ?? p.slot,
    }
  })
  const order = new Map(roomOrder.map((k, i) => [k, i]))
  const grouped = new Map<string, DeedPhoto[]>()
  for (const p of all) {
    const list = grouped.get(p.roomLabel) ?? []
    list.push(p)
    grouped.set(p.roomLabel, list)
  }
  const roomLabels = [...grouped.keys()].sort(
    (a, b) => (order.get(roomKindOf(a, rooms)) ?? 99) - (order.get(roomKindOf(b, rooms)) ?? 99),
  )
  const photoById = new Map(all.map((p) => [p.id, p]))
  const defectRows: DeedDefect[] = defects
    .map((d) => {
      const p = photoById.get(d.photoId)
      if (!p) return null
      return {
        id: d.id,
        seq: d.seq,
        phenomenon: d.phenomenon,
        bbox: d.bbox,
        pNo: p.pNo,
        roomLabel: p.roomLabel,
        slotLabel: p.slotLabel,
      }
    })
    .filter((d): d is DeedDefect => d !== null)
    .sort((a, b) => a.seq - b.seq)
  return {
    caseNo: caseNoOf(caseData),
    photos: all,
    byRoom: roomLabels.map((label) => ({ roomLabel: label, photos: grouped.get(label)! })),
    defects: defectRows,
    chained: all.filter((p) => p.chainHash),
  }
}

function roomKindOf(label: string, rooms: Room[]): string {
  return rooms.find((r) => r.label === label)?.kind ?? ''
}

function safeSlot(kind: Room['kind'], slotId: string) {
  try {
    getRoomTemplate(kind)
    return findSlot(kind, slotId)
  } catch {
    return undefined
  }
}
