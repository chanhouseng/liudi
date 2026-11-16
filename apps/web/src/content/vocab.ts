// 现象 / 严重度 / 判定类别的 UI 中文名，与 CONTENT.md §3 判定表对应；改动需同步 CONTENT.md。
import type { JudgementClass, Phenomenon, Severity } from '@/domain/types'

export const PHENOMENON_LABELS = {
  stain: '污渍',
  scratch: '划痕',
  crack: '裂纹',
  chip: '掉漆',
  discolor: '泛黄',
  rust: '锈蚀',
  hole: '破洞',
  missing: '缺失',
  deform: '变形',
  dirt: '污渍',
} as const satisfies Record<Phenomenon, string>

export const SEVERITY_LABELS = {
  light: '轻度',
  moderate: '中度',
  severe: '重度',
} as const satisfies Record<Severity, string>

export const CLS_LABELS = {
  A: '入住即有',
  B: '正常损耗',
  C: '人为损坏',
} as const satisfies Record<JudgementClass, string>
