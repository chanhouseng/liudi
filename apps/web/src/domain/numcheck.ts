// 数字回填校验（FR-508 与 FR-602 是同一套，不是两套）。
// AI 产出里的每个数字都必须能在 allowedSet 里找到；有集合外数字 → 整段丢弃回退模板。
// 数字永远不经过 LLM：集合全部由确定性代码产出。

// 判决式 / 承诺式措辞是产品立场红线，AI 句里出现即整段拒绝。
export const FORBIDDEN_PHRASES = /法院会判|一定能要回|必赢|保证退款|百分百/

// 抽取正文里的数字字面：¥/￥ 前缀、千分位、小数都归一成「去掉符号的字符串」。
export function numberTokens(text: string): string[] {
  return (text.match(/[¥￥]?\s*\d[\d,]*(?:\.\d+)?/g) ?? []).map((t) =>
    t.replace(/[¥￥\s,]/g, ''),
  )
}

export function numbersWithin(text: string, allowed: Set<string>): boolean {
  return numberTokens(text).every((t) => allowed.has(t))
}

// 金额以「元」的字面入集（价格库本身整元口径）；数量 / 天数 / 月数直接入集。
export function allowedSetFor(allowed: Set<string>, fens: number[], counts: (number | string)[]): Set<string> {
  const out = new Set(allowed)
  for (const f of fens) out.add(String(f / 100))
  for (const c of counts) out.add(String(c))
  return out
}
