// 建议层措辞（FR-508）。模板句优先；AI 措辞只在该句全部数字落在 allowedSet 时放行，
// 否则整句丢弃回退模板——数字永远不经过 LLM。校验与信件共用 domain/numcheck（FR-508 = FR-602）。
import type { PriceItem } from '@/content/prices'
import type { DeductionItem } from '@/domain/types'

import { FORBIDDEN_PHRASES, numbersWithin } from '@/domain/numcheck'
import { invalidKindOf } from '@/domain/valuation'
import { formatYuan } from '@/lib/format'

export interface SuggestCtx {
  item: DeductionItem
  price: PriceItem | null
  tenancyMonths: number
}

export function buildSuggestion(ctx: SuggestCtx): string {
  const { item, price } = ctx
  if (item.status === 'valid') {
    return `按市场价和折旧，这项建议最多付 ${formatYuan(item.liableAmount)}。`
  }
  if (item.status === 'invalid') {
    if (!price) return '这项建议不付。'
    const kind = invalidKindOf(price)
    if (kind === 'gas') return '制冷剂属正常消耗，维修义务在出租人，这项建议不付。'
    if (kind === 'service') return '房东没随消息给凭证，这项建议不付；他补了凭证再议。'
    return '这项判为入住即有或正常损耗，建议不付。'
  }
  if (!price) {
    return `这项暂时没有参考价，先按 ${formatYuan(item.amount)} 记入争议，谈判时再定。`
  }
  return '这项有市场价但没有照片判定，先谈，谈得拢再算。'
}

// 允许出现在建议句里的数字：市场区间、建议价、主张额（元），以及月数 / 年限 / 数量。
// 金额一律以「元」的字面形式入集，价格库本身就是整元口径。
export function allowedNumbers(ctx: SuggestCtx): Set<string> {
  const s = new Set<string>()
  const { item, price } = ctx
  if (price) {
    for (const v of [price.low, price.mid, price.high]) s.add(String(v / 100))
    if (price.life !== null) s.add(String(price.life))
  }
  s.add(String(item.amount / 100))
  s.add(String(item.liableAmount / 100))
  s.add(String(ctx.tenancyMonths))
  s.add(String(item.quantity))
  return s
}

export function validateAiSentence(ctx: SuggestCtx, ai: string): string | null {
  if (FORBIDDEN_PHRASES.test(ai)) return null
  return numbersWithin(ai, allowedNumbers(ctx)) ? ai : null
}

export function suggest(ctx: SuggestCtx, ai?: string): string {
  if (ai === undefined) return buildSuggestion(ctx)
  return validateAiSentence(ctx, ai) ?? buildSuggestion(ctx)
}
