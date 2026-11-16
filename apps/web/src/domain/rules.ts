// 判定规则引擎（FR-403）。事实来源：CONTENT.md §3（判定表 / 置信度公式）。
// 纯函数：不 import React / Dexie / fetch / 浏览器 API，同一输入必得同一输出。
// AI 永远不下责任结论——责任分类只在这里发生。
import type { BBox, Defect, Finding, Judgement, JudgementClass } from './types'

export interface JudgeInput {
  finding: Finding
  /** 该点位存在入住照片（可比对） */
  hasMoveInEvidence: boolean
  /** 入住底稿里与本区域 IoU > 0.35 的瑕疵（调用方用 iouBBoxes 算好） */
  matchedDefect?: Defect
  tenancyMonths: number
}

// PLAN §6 的 ctx（contractClause）未实现：合同条款效力不判定（CONTENT §3.4），
// 且现有规则没有任何一条用到 ctx，不保留空参数。

// A-01 的同位置判定由调用方完成；这里只提供几何工具并约定阈值。
export const MATCH_IOU_THRESHOLD = 0.35

export function iouBBoxes(a: BBox, b: BBox): number {
  const ix1 = Math.max(a[0], b[0])
  const iy1 = Math.max(a[1], b[1])
  const ix2 = Math.min(a[2], b[2])
  const iy2 = Math.min(a[3], b[3])
  const iw = ix2 - ix1
  const ih = iy2 - iy1
  if (iw <= 0 || ih <= 0) return 0
  const inter = iw * ih
  const areaA = (a[2] - a[0]) * (a[3] - a[1])
  const areaB = (b[2] - b[0]) * (b[3] - b[1])
  const union = areaA + areaB - inter
  return union <= 0 ? 0 : inter / union
}

function defectLabel(d: Defect): string {
  return `D-${String(d.seq).padStart(2, '0')}`
}

// 现象描述里的确定性线索。只匹配可见事实的措辞，不做任何责任推断。
const RE_SPLASH = /泼洒|泼溅|溅洒|溅上|边缘锐利|边界清晰/
const RE_SEEP = /渗水|渗漏|水渍|受潮|起鼓|剥落/
const RE_MOLD = /霉|扩散|受潮|潮斑/
const RE_TEAR = /撕扯|撕下|胶带|海报|贴纸|粘贴|残胶/
const RE_NAIL = /钉眼|钉痕|钉子|挂钩|挂钉|膨胀钉/
const RE_PATCH = /成片|大片|密集/
const RE_DIAMETER = /(\d+(?:\.\d+)?)\s*(?:mm|毫米)/i

function parseDiameterMm(text: string): number | null {
  const m = RE_DIAMETER.exec(text)
  if (!m) return null
  const v = Number.parseFloat(m[1])
  return Number.isFinite(v) ? v : null
}

// confidence = base(rule) × evidenceFactor × aiFactor（CONTENT §3.3）
function baseOf(ruleId: string, cls: JudgementClass): number {
  if (ruleId === 'A-01') return 0.95
  if (ruleId === 'X-01') return 0.4
  if (ruleId === 'C-99') return 0.5
  return cls === 'B' ? 0.75 : 0.7
}

function makeJudgement(
  finding: Finding,
  input: JudgeInput,
  cls: JudgementClass,
  ruleId: string,
  reason: string,
  legalRefs: string[],
): Judgement {
  const evidence = input.hasMoveInEvidence ? 1.0 : 0.6
  const ai =
    finding.aiConfidence === undefined || finding.aiConfidence === null
      ? 0.7
      : 0.6 + 0.4 * finding.aiConfidence
  const confidence = baseOf(ruleId, cls) * evidence * ai
  return {
    findingId: finding.id,
    cls,
    ruleId,
    reason,
    legalRefs,
    confidence,
  }
}

// 执行顺序 = CONTENT §3.2 表序，仅一处例外：A-02（表序 #2）按字面排在专属规则之前，
// 会让 #3–#16 在「有入住照片」时全部不可达（B 类规则变死代码），与表格自身矛盾；
// 故置于专属规则与 C-99 之后、X-01 之前执行。已在交付里上报。
export function judge(input: JudgeInput): Judgement {
  const { finding: f, hasMoveInEvidence, matchedDefect, tenancyMonths } = input
  const text = f.aiDescription ?? ''

  // 1 · A-01 底稿有同位置瑕疵（IoU > 0.35）
  if (matchedDefect) {
    return makeJudgement(
      f,
      input,
      'A',
      'A-01',
      `这处在入住底稿 ${defectLabel(matchedDefect)} 中已存在，属交付时状态`,
      ['civil-733', 'reg-10'],
    )
  }
  // 2 · B-01 dirt 污渍 wall/floor，非集中泼洒
  if (f.phenomenon === 'dirt' && (f.surface === 'wall' || f.surface === 'floor') && !RE_SPLASH.test(text)) {
    return makeJudgement(f, input, 'B', 'B-01', '日常使用形成的表面污渍，属正常损耗', ['civil-710'])
  }
  // 3 · B-02 discolor 泛黄 wall，无霉斑、无剥落
  if (f.phenomenon === 'discolor' && f.surface === 'wall' && !RE_MOLD.test(text) && !RE_SEEP.test(text)) {
    return makeJudgement(f, input, 'B', 'B-02', '乳胶漆自然老化泛黄，属正常损耗', ['civil-710'])
  }
  // 4 · B-03 scratch 划痕 floor/furniture，light
  if (f.phenomenon === 'scratch' && (f.surface === 'floor' || f.surface === 'furniture') && f.severity === 'light') {
    return makeJudgement(f, input, 'B', 'B-03', '轻微表面划痕，未破坏材质结构', ['civil-710'])
  }
  // 5 · B-04 crack 裂纹 wall，light/moderate，租期 ≥ 24 月
  if (
    f.phenomenon === 'crack' &&
    f.surface === 'wall' &&
    (f.severity === 'light' || f.severity === 'moderate') &&
    tenancyMonths >= 24
  ) {
    return makeJudgement(f, input, 'B', 'B-04', '长期使用下的腻子/涂料细裂，属自然老化', [
      'civil-710',
      'civil-733',
    ])
  }
  // 6 · B-05 crack 裂纹 wall，有渗水/受潮迹象 → 维修义务在出租人
  if (f.phenomenon === 'crack' && f.surface === 'wall' && RE_SEEP.test(text)) {
    return makeJudgement(f, input, 'B', 'B-05', '开裂伴随受潮迹象，可能与房屋防水有关，维修义务在出租人', [
      'civil-712',
    ])
  }
  // 7 · B-06 rust 锈蚀 fixture/appliance，表面氧化
  if (f.phenomenon === 'rust' && (f.surface === 'fixture' || f.surface === 'appliance')) {
    return makeJudgement(f, input, 'B', 'B-06', '金属件正常氧化', ['civil-710'])
  }
  // 8 · B-07 hole 钉眼 wall，数量少、直径小、分布零散（描述含钉眼措辞且未写明大尺寸）
  if (
    f.phenomenon === 'hole' &&
    f.surface === 'wall' &&
    RE_NAIL.test(text) &&
    !RE_PATCH.test(text)
  ) {
    const d = parseDiameterMm(text)
    if (d === null || d < 8) {
      return makeJudgement(f, input, 'B', 'B-07', '悬挂日常物品留下的钉眼，属正常使用', ['civil-710'])
    }
  }
  // 9 · C-01 hole 破洞 wall/door，直径 ≥ 20mm 或成片
  if (f.phenomenon === 'hole' && (f.surface === 'wall' || f.surface === 'door')) {
    const d = parseDiameterMm(text)
    if (RE_PATCH.test(text) || (d !== null && d >= 20)) {
      return makeJudgement(f, input, 'C', 'C-01', '破损超出正常使用范围', ['civil-711'])
    }
  }
  // 10 · C-02 stain 污渍 wall/floor，泼洒特征
  if (f.phenomenon === 'stain' && (f.surface === 'wall' || f.surface === 'floor') && RE_SPLASH.test(text)) {
    return makeJudgement(f, input, 'C', 'C-02', '呈泼洒特征，非日常使用形成', ['civil-711'])
  }
  // 11 · B-08 stain 污渍 wall/ceiling，霉斑/扩散 → 倾向房屋原因
  if (f.phenomenon === 'stain' && (f.surface === 'wall' || f.surface === 'ceiling') && RE_MOLD.test(text)) {
    return makeJudgement(f, input, 'B', 'B-08', '呈受潮扩散特征，倾向房屋原因', ['civil-712'])
  }
  // 12 · C-03 chip 掉漆 wall，撕扯痕迹
  if (f.phenomenon === 'chip' && f.surface === 'wall' && RE_TEAR.test(text)) {
    return makeJudgement(f, input, 'C', 'C-03', '边缘呈撕扯状，疑为粘贴物移除所致', ['civil-711'])
  }
  // 13 · C-04 missing 缺失，底稿存在而退租时不见
  if (f.phenomenon === 'missing' && hasMoveInEvidence) {
    return makeJudgement(f, input, 'C', 'C-04', '物品缺失，按折旧后价值协商', ['civil-711'])
  }
  // 14 · C-05 deform 变形 furniture
  if (f.phenomenon === 'deform' && f.surface === 'furniture') {
    return makeJudgement(f, input, 'C', 'C-05', '非正常使用导致的结构变形', ['civil-711'])
  }
  // 15 · B-09 dirt 污渍 appliance，可清洁油垢
  if (f.phenomenon === 'dirt' && f.surface === 'appliance') {
    return makeJudgement(f, input, 'B', 'B-09', '可清洁的表面油垢，不构成损坏', ['civil-710'])
  }
  // 16 · C-99 severe 且非上述
  if (f.severity === 'severe') {
    return makeJudgement(f, input, 'C', 'C-99', '程度较重，建议协商', ['civil-711'])
  }
  // 17 · A-02 底稿有该表面照片但未标此瑕疵（执行位见函数头说明）
  if (hasMoveInEvidence) {
    return makeJudgement(f, input, 'C', 'A-02', '入住底稿记录了该表面，未见此处问题', ['civil-711'])
  }
  // 18 · X-01 无入住底稿、无法比对 → 保守
  return makeJudgement(f, input, 'C', 'X-01', '无入住记录可比对，建议按现状协商', ['reg-35'])
}

/** UI 低置信度告警线：低于它必须显示「这条需要你自己确认」。 */
export const CONFIDENCE_WARN = 0.55
