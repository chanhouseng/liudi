// 数据契约（PLAN.md §3）。金额一律为「分」的整数，展示时才除以 100。
export type ID = string

export type City = 'hangzhou'
export type LandlordType = 'personal' | 'agency' | 'sublet'

export interface Case {
  id: ID
  alias: string
  city: City
  addressMasked: string
  rentMonthly: number
  deposit: number
  leaseStart: string
  leaseEnd: string
  landlordType: LandlordType
  createdAt: string
}

export type RoomKind = 'bedroom' | 'living' | 'kitchen' | 'bath' | 'balcony' | 'entry'

export interface Room {
  id: ID
  caseId: ID
  kind: RoomKind
  label: string
}

export type CapturePhase = 'move_in' | 'move_out'

export interface Capture {
  id: ID
  roomId: ID
  phase: CapturePhase
  takenAt: string
  device: string
}

export type SlotId = string

export interface Photo {
  id: ID
  captureId: ID
  slot: SlotId
  blob: Blob
  thumb: Blob
  takenAt: string
  sha256: string
  prevHash: string
  chainHash: string
}

export type Phenomenon =
  | 'stain'
  | 'scratch'
  | 'crack'
  | 'chip'
  | 'discolor'
  | 'rust'
  | 'hole'
  | 'missing'
  | 'deform'
  | 'dirt'

export type BBox = [number, number, number, number]

export interface Defect {
  id: ID
  photoId: ID
  bbox: BBox
  phenomenon: Phenomenon
  source: 'manual' | 'ai'
  confidence: number
  // 案件内单调递增（已确认 2026-11-15）：编号 D-01 删除后不回收，靠它持久化
  seq: number
}

export type Surface =
  | 'wall'
  | 'floor'
  | 'ceiling'
  | 'door'
  | 'window'
  | 'furniture'
  | 'appliance'
  | 'fixture'

export type Severity = 'light' | 'moderate' | 'severe'

export interface Finding {
  id: ID
  roomId: ID
  photoInId?: ID
  photoOutId: ID
  bbox: BBox
  phenomenon: Phenomenon
  surface: Surface
  material?: string
  severity: Severity
  areaRatio?: number
  aiDescription?: string
  aiConfidence?: number
  needsRephoto: boolean
}

export type JudgementClass = 'A' | 'B' | 'C'

export interface Judgement {
  findingId: ID
  cls: JudgementClass
  ruleId: string
  reason: string
  legalRefs: string[]
  confidence: number
  overriddenByUser?: { cls: JudgementClass; note?: string; at: string }
}

// caseId 为 FR-103 级联删除补充的归属字段（2026-11-15 已确认）
export interface DeductionItem {
  id: ID
  caseId: ID
  rawText: string
  label: string
  amount: number
  matchedPriceId?: string
  quantity: number
  estimate: { low: number; mid: number; high: number }
  depreciation: { years: number; lifespan: number; residualRatio: number }
  liableAmount: number
  status: 'valid' | 'invalid' | 'disputed'
  reason: string
  inflatedRatio?: number
}

export interface CaseValuation {
  deposit: number
  claimedTotal: number
  payable: number
  notPayable: number
  disputed: number
  items: DeductionItem[]
}

export interface Letter {
  id: ID
  caseId: ID
  tone: 'polite' | 'neutral' | 'firm'
  channel: 'wechat' | 'formal' | 'mediation'
  subject: string
  body: string
  citations: { evidenceId: string; caption: string }[]
  createdAt: string
}
