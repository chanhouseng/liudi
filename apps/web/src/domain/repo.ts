// 纯逻辑：级联删除计划、导出/导入载荷。不得 import React / Dexie / fetch / 浏览器 API。
import type {
  Case,
  Capture,
  DeductionItem,
  Defect,
  Finding,
  ID,
  Judgement,
  Letter,
  Room,
} from './types'

export function newId(): ID {
  return crypto.randomUUID()
}

export interface CaseTreeSnapshot {
  rooms: { id: ID; caseId: ID }[]
  captures: { id: ID; roomId: ID }[]
  photos: { id: ID; captureId: ID }[]
  defects: { id: ID; photoId: ID }[]
  findings: { id: ID; roomId: ID }[]
  judgements: { findingId: ID }[]
  deductions: { id: ID; caseId: ID }[]
  letters: { id: ID; caseId: ID }[]
}

export interface CaseTreeIds {
  roomIds: ID[]
  captureIds: ID[]
  photoIds: ID[]
  defectIds: ID[]
  findingIds: ID[]
  judgementKeys: ID[]
  deductionIds: ID[]
  letterIds: ID[]
}

export function collectCaseTree(caseId: ID, snap: CaseTreeSnapshot): CaseTreeIds {
  const rooms = snap.rooms.filter((r) => r.caseId === caseId)
  const roomIds = rooms.map((r) => r.id)
  const roomSet = new Set(roomIds)

  const captures = snap.captures.filter((c) => roomSet.has(c.roomId))
  const captureIds = captures.map((c) => c.id)
  const captureSet = new Set(captureIds)

  const photos = snap.photos.filter((p) => captureSet.has(p.captureId))
  const photoIds = photos.map((p) => p.id)
  const photoSet = new Set(photoIds)

  const defects = snap.defects.filter((d) => photoSet.has(d.photoId))

  const findings = snap.findings.filter((f) => roomSet.has(f.roomId))
  const findingIds = findings.map((f) => f.id)
  const findingSet = new Set(findingIds)

  const judgements = snap.judgements.filter((j) => findingSet.has(j.findingId))

  const deductions = snap.deductions.filter((d) => d.caseId === caseId)
  const letters = snap.letters.filter((l) => l.caseId === caseId)

  return {
    roomIds,
    captureIds,
    photoIds,
    defectIds: defects.map((d) => d.id),
    findingIds,
    judgementKeys: judgements.map((j) => j.findingId),
    deductionIds: deductions.map((d) => d.id),
    letterIds: letters.map((l) => l.id),
  }
}

export interface PhotoExportRow {
  id: ID
  captureId: ID
  slot: string
  takenAt: string
  sha256: string
  prevHash: string
  chainHash: string
}

export interface ExportPayload {
  version: 1
  exportedAt: string
  cases: Case[]
  rooms: Room[]
  captures: Capture[]
  photos: PhotoExportRow[]
  defects: Defect[]
  findings: Finding[]
  judgements: Judgement[]
  deductions: DeductionItem[]
  letters: Letter[]
}

export interface ExportInput {
  cases: Case[]
  rooms: Room[]
  captures: Capture[]
  photos: PhotoExportRow[]
  defects: Defect[]
  findings: Finding[]
  judgements: Judgement[]
  deductions: DeductionItem[]
  letters: Letter[]
}

export function buildExportPayload(input: ExportInput, exportedAt: string): ExportPayload {
  return {
    version: 1,
    exportedAt,
    cases: input.cases,
    rooms: input.rooms,
    captures: input.captures,
    photos: input.photos.map((p) => ({
      id: p.id,
      captureId: p.captureId,
      slot: p.slot,
      takenAt: p.takenAt,
      sha256: p.sha256,
      prevHash: p.prevHash,
      chainHash: p.chainHash,
    })),
    defects: input.defects,
    findings: input.findings,
    judgements: input.judgements,
    deductions: input.deductions,
    letters: input.letters,
  }
}

export type ImportResult =
  | { ok: true; payload: ExportPayload; missingPhotos: boolean }
  | { ok: false; reason: string }

export function parseImportPayload(raw: string): ImportResult {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return { ok: false, reason: '不是有效的 JSON' }
  }
  if (typeof data !== 'object' || data === null) {
    return { ok: false, reason: '格式不对，缺少字段' }
  }
  const version = (data as { version?: unknown }).version
  if (version !== 1) {
    return { ok: false, reason: '不支持的导出版本' }
  }
  const payload = data as ExportPayload
  const missingPhotos = Array.isArray(payload.photos) && payload.photos.length > 0
  return { ok: true, payload, missingPhotos }
}
