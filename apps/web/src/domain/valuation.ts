// 定损引擎（FR-503…508）。事实来源：CONTENT.md §4（价格 / 折旧 / 责任）。
// 纯函数：不 import React / Dexie / fetch / 浏览器 API，同一输入必得同一输出。
// 责任结论只从上游 judgements 读入；这里不做任何视觉或责任判断。
import type { PriceItem } from '@/content/prices'

import type { ParsedDeduction } from './parse'
import { CONFIDENCE_WARN } from './rules'
import type { CaseValuation, DeductionItem, Finding, Judgement, JudgementClass } from './types'

// 匹配表按「损伤 / 服务」定向，不跟房东提出的处理方式走（FR-503：墙面印子整面重刷
// 仍应落到局部修补，FR-505 的虚高倍数才成立）。顺序即优先级：先具体（家电 / 保洁服务），
// 后一般（墙面 / 地面 / 兜底）。id 在价格库缺失时继续向后匹配，最后落 unmatched。
const MATCHERS: readonly (readonly [RegExp, string])[] = [
  [/加氟|氟利昂|制冷剂|不制冷/, 'ac-gas'],
  [/空调[^，。;；]{0,6}(?:清洗|滤网)|滤网/, 'ac-clean'],
  [/洗衣机[^，。;；]{0,6}清洗/, 'washer-clean'],
  [/冰箱[^，。;；]{0,6}(?:清洗|除味|除霜)|除味|除霜/, 'fridge-clean'],
  [/热水器[^，。;；]{0,6}清洗|水垢/, 'heater-clean'],
  [/油烟机[^，。;；]{0,6}(?:清洗|油杯)|油杯/, 'hood-clean'],
  [/下水道|疏通|堵了/, 'drain-unclog'],
  [/除霉|霉斑|发霉/, 'wall-mold'],
  [/印子|印痕|污渍|脏|补漆/, 'wall-patch'],
  [/钉眼|钉孔/, 'wall-nailhole'],
  [/全屋[^，。;；]{0,8}(?:刷|漆|翻新)|整屋|墙面[^，。;；]{0,4}翻新/, 'wall-repaint-all'],
  [/顶面|天花板|吊顶/, 'ceiling-patch'],
  [/整面|重新刷|重刷|粉刷|刷漆|滚涂/, 'wall-repaint-1'],
  [/美缝/, 'floor-grout'],
  [/地板[^，。;；]{0,6}(?:打磨|翻新)/, 'floor-sanding'],
  [/瓷砖|地砖/, 'floor-tile-piece'],
  [/地毯/, 'carpet-clean'],
  [/床垫/, 'mattress-15'],
  [/沙发/, 'sofa-clean'],
  [/柜门|衣柜/, 'wardrobe-door'],
  [/纱窗/, 'screen-window'],
  [/玻璃[^，。;；]{0,4}(?:洗|擦)/, 'clean-window'],
  [/保洁[^，。;；]{0,4}小时|按小时/, 'clean-hourly'],
  [/保洁|打扫|开荒|深度清洁|清洁/, 'clean-deep-1br'],
  [/室内门|房门|换门|破门/, 'door-indoor'],
  [/锁|锁芯/, 'lock-set'],
  [/门套|门框/, 'door-frame'],
  [/玻璃/, 'glass-pane'],
  [/木地板|地板/, 'floor-wood-piece'],
  [/桌|椅|家具|床(?!单|品|垫)/, 'furniture-repair'],
  [/凉席|床单|被褥|枕/, 'bedding-set'],
  [/墙|漆/, 'wall-patch'],
]

export function matchPrice(label: string, prices: PriceItem[]): PriceItem | null {
  for (const [re, id] of MATCHERS) {
    if (!re.test(label)) continue
    const price = prices.find((p) => p.id === id)
    if (price) return price
  }
  return null
}

// 扣款项 ↔ 照片判定的关联：按名目关键词找同部位 / 同现象的 findings。
// 关联结果只用于展开行的「现象」展示，金额状态一律以判定结果为准。
const LINK_RULES: readonly (readonly [
  RegExp,
  'surface' | 'phenomenon',
  string,
])[] = [
  [/钉眼|印子|污渍|印痕|霉|刷|漆|墙/, 'surface', 'wall'],
  [/顶|吊顶/, 'surface', 'ceiling'],
  [/地板|地面|地砖|瓷砖|美缝/, 'surface', 'floor'],
  [/锁|门套|门框|室内门|房门/, 'surface', 'door'],
  [/窗|玻璃|纱窗/, 'surface', 'window'],
  [/空调|氟|制冷|洗衣机|冰箱|热水器|油烟机/, 'surface', 'appliance'],
  [/床垫|沙发|衣柜|柜|桌|椅|床/, 'surface', 'furniture'],
  [/凉席|床单|被褥|枕|水壶|不见了|缺失|少了|找不到/, 'phenomenon', 'missing'],
]

export function findLinkedFindings(label: string, findings: Finding[]): Finding[] {
  const ids = new Set<string>()
  for (const [re, field, value] of LINK_RULES) {
    if (!re.test(label)) continue
    for (const f of findings) {
      if (f[field] === value) ids.add(f.id)
    }
  }
  return findings.filter((f) => ids.has(f.id))
}

export interface ValuationInput {
  caseId: string
  deposit: number
  tenancyMonths: number
  parsed: ParsedDeduction[]
  findings: Finding[]
  judgements: Judgement[]
}

// 低置信且未经用户确认的判定不驱动金额（与判定页 0.55 待确认线一致）：这类条目进争议。
function drivingClasses(
  linked: Finding[],
  judgements: Judgement[],
): JudgementClass[] {
  const byFinding = new Map(judgements.map((j) => [j.findingId, j]))
  const out: JudgementClass[] = []
  for (const f of linked) {
    const j = byFinding.get(f.id)
    if (!j) continue
    if (j.overriddenByUser) {
      const cls = j.overriddenByUser.cls
      if (!out.includes(cls)) out.push(cls)
      continue
    }
    if (j.confidence < CONFIDENCE_WARN) continue
    if (!out.includes(j.cls)) out.push(j.cls)
  }
  return out
}

function wearReason(driving: JudgementClass[]): string {
  const hasA = driving.includes('A')
  const hasB = driving.includes('B')
  if (hasA && hasB) return '照片判定为入住即有或正常损耗，不用扣。'
  if (hasA) return '照片判定为入住即有，不用扣。'
  return '照片判定为正常损耗，不用扣。'
}

export function computeValuation(input: ValuationInput, prices: PriceItem[]): CaseValuation {
  const items = input.parsed.map((p, i) => {
    const price = matchPrice(p.label, prices)
    const linked = findLinkedFindings(p.label, input.findings)
    const driving = drivingClasses(linked, input.judgements)
    const hasC = driving.includes('C')
    const hasAB = driving.includes('A') || driving.includes('B')

    let status: DeductionItem['status']
    let reason: string
    let liableAmount = 0
    let estimate = { low: 0, mid: 0, high: 0 }
    let depreciation = { years: 0, lifespan: 0, residualRatio: 1 }

    if (price === null) {
      status = 'disputed'
      reason = '暂时没有这项的参考价，先按房东报价记入争议。'
    } else {
      estimate = { low: price.low, mid: price.mid, high: price.high }
      depreciation =
        price.life === null
          ? { years: 0, lifespan: 0, residualRatio: 1 }
          : {
              years: input.tenancyMonths / 12,
              lifespan: price.life,
              residualRatio: 1 - Math.min(1, input.tenancyMonths / (12 * price.life)),
            }
      if (hasC) {
        status = 'valid'
        // CONTENT §4.7：liable = round(mid × residual × responsibilityRatio)。
        // 价格口径是元，在元上取整后存分，避免假精度；C 类责任比例取 1。
        const base = price.mid * depreciation.residualRatio
        liableAmount = Math.min(Math.round(base / 100) * 100, p.amountFen)
        reason = '有同位置照片判定为人为损坏，按市场价折旧后承担。'
      } else if (hasAB) {
        status = 'invalid'
        reason = wearReason(driving)
      } else if (price.id === 'ac-gas') {
        status = 'invalid'
        reason = '制冷剂属自然消耗，加氟是出租人的维修义务。'
      } else if (price.life === null) {
        status = 'invalid'
        reason = '房东未随消息提供凭证或报价单，这项按无依据处理。'
      } else {
        status = 'disputed'
        reason = '有市场参考价，但没有同位置的照片判定，先记为争议。'
      }
    }

    const item: DeductionItem = {
      id: `V-${String(i + 1).padStart(2, '0')}`,
      caseId: input.caseId,
      rawText: p.rawText,
      label: p.label,
      amount: p.amountFen,
      quantity: 1,
      estimate,
      depreciation,
      liableAmount,
      status,
      reason,
    }
    if (price) item.matchedPriceId = price.id
    // FR-505：主张价高于市场价上限两倍即标记虚高，倍数对市场价上限。
    if (price && p.amountFen > price.high * 2) item.inflatedRatio = p.amountFen / price.high
    return item
  })

  const claimedTotal = items.reduce((s, i) => s + i.amount, 0)
  const payable = items.reduce((s, i) => s + (i.status === 'valid' ? i.liableAmount : 0), 0)
  const disputed = items.reduce((s, i) => s + (i.status === 'disputed' ? i.amount : 0), 0)
  // 每条主张要么进应付（超出折旧价的部分算不应付），要么整条进不应付 / 争议，
  // 因此应付 + 不应付 + 争议恒等于主张总额（FR-506）。
  const notPayable = claimedTotal - payable - disputed

  return { deposit: input.deposit, claimedTotal, payable, notPayable, disputed, items }
}

// 拆解结果入库形态：只存解析产物，估值字段留零值——定损页每次用最新判定现算，
// 判定改了不需要重新拆解，建议层也就没有回写判定的入口。
export function parsedToItems(caseId: string, parsed: ParsedDeduction[]): DeductionItem[] {
  return parsed.map((p, i) => ({
    id: `V-${String(i + 1).padStart(2, '0')}`,
    caseId,
    rawText: p.rawText,
    label: p.label,
    amount: p.amountFen,
    quantity: 1,
    estimate: { low: 0, mid: 0, high: 0 },
    depreciation: { years: 0, lifespan: 0, residualRatio: 1 },
    liableAmount: 0,
    status: 'disputed' as const,
    reason: '',
  }))
}

export type InvalidKind = 'ab' | 'gas' | 'service'

// 无依据的三种来路：照片判了 A/B；加氟（维修义务）；保洁 / 清洗类服务（凭证未随消息提供）。
export function invalidKindOf(price: PriceItem | null | undefined): InvalidKind {
  if (price?.id === 'ac-gas') return 'gas'
  if (price && price.life === null) return 'service'
  return 'ab'
}

export function legalRefsFor(item: DeductionItem, price: PriceItem | null | undefined): string[] {
  if (item.status === 'valid') return ['civil-711']
  if (item.status === 'invalid') {
    const kind = invalidKindOf(price)
    if (kind === 'gas') return ['civil-712']
    if (kind === 'service') return ['reg-10']
    return ['civil-710', 'civil-733']
  }
  return ['reg-35']
}
