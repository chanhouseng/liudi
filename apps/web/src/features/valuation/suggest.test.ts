import { describe, expect, it } from 'vitest'

import type { PriceItem } from '../../content/prices'
import type { DeductionItem } from '../../domain/types'
import { allowedNumbers, buildSuggestion, suggest, validateAiSentence, type SuggestCtx } from './suggest'

const price = (id: string, low: number, mid: number, high: number, life: number | null): PriceItem => ({
  id,
  label: id,
  unit: '处',
  low,
  mid,
  high,
  life,
  source: '',
  updatedAt: '2026-11-15',
  unverified: true,
})

const LOCK = price('lock-set', 15_000, 27_500, 45_000, 8)
const WALL = price('wall-patch', 15_000, 22_000, 35_000, 5)
const CLEAN = price('clean-deep-1br', 28_000, 42_000, 70_000, null)

function item(over: Partial<DeductionItem>): DeductionItem {
  return {
    id: 'V-01',
    caseId: 'c1',
    rawText: '',
    label: '门锁不好转，换锁',
    amount: 40_000,
    quantity: 1,
    estimate: { low: 0, mid: 0, high: 0 },
    depreciation: { years: 0, lifespan: 0, residualRatio: 1 },
    liableAmount: 0,
    status: 'disputed',
    reason: '',
    ...over,
  }
}

describe('buildSuggestion · 模板句（用「建议 / 最多」，不含判决式措辞）', () => {
  const cases: [string, SuggestCtx][] = [
    [
      '成立',
      {
        item: item({
          status: 'valid',
          liableAmount: 23_500,
          matchedPriceId: 'lock-set',
          estimate: { low: LOCK.low, mid: LOCK.mid, high: LOCK.high },
        }),
        price: LOCK,
        tenancyMonths: 14,
      },
    ],
    ['不成立·A/B', { item: item({ status: 'invalid', matchedPriceId: 'wall-patch' }), price: WALL, tenancyMonths: 14 }],
    ['不成立·加氟', { item: item({ status: 'invalid', matchedPriceId: 'ac-gas' }), price: CLEAN, tenancyMonths: 14 }],
    ['不成立·服务', { item: item({ status: 'invalid', matchedPriceId: 'clean-deep-1br' }), price: CLEAN, tenancyMonths: 14 }],
    ['争议·无参考价', { item: item({ status: 'disputed' }), price: null, tenancyMonths: 14 }],
    ['争议·无判定', { item: item({ status: 'disputed', matchedPriceId: 'lock-set' }), price: LOCK, tenancyMonths: 14 }],
  ]

  for (const [name, ctx] of cases) {
    it(`${name}：句内数字全部落在 allowedSet`, () => {
      const line = buildSuggestion(ctx)
      const allowed = allowedNumbers(ctx)
      for (const t of line.match(/\d[\d,]*(?:\.\d+)?/g) ?? []) {
        expect(allowed.has(t.replace(/,/g, '')), `「${t}」不在集合内：${line}`).toBe(true)
      }
      expect(line).not.toMatch(/应该|法院会判|一定能要回|必赢|保证/)
    })
  }

  it('成立句用「最多」并给出建议金额', () => {
    const line = buildSuggestion(cases[0][1])
    expect(line).toContain('最多付 ¥235')
  })

  it('争议无参考价句引用房东报价', () => {
    expect(buildSuggestion(cases[4][1])).toContain('¥400')
  })
})

describe('validateAiSentence（FR-508 数字回填校验）', () => {
  const ctx: SuggestCtx = {
    item: item({ status: 'valid', liableAmount: 23_500, matchedPriceId: 'lock-set' }),
    price: LOCK,
    tenancyMonths: 14,
  }

  it('集合内数字放行（¥、千分位归一）', () => {
    expect(
      validateAiSentence(ctx, '用了 14 个月，市场价 ¥150 到 450，这项建议最多付 235 元。'),
    ).not.toBeNull()
  })

  it('集合外金额整句拒绝', () => {
    expect(validateAiSentence(ctx, '按 8 年折旧，建议付 220 元。')).toBeNull()
  })

  it('小数不在集合内也拒绝（防止 AI 换算出集合外的数）', () => {
    expect(validateAiSentence(ctx, '折旧后约 234.9 元。')).toBeNull()
  })

  it('没有数字的句子放行', () => {
    expect(validateAiSentence(ctx, '这项建议按折旧承担。')).not.toBeNull()
  })
})

describe('suggest · 降级入口', () => {
  const ctx: SuggestCtx = {
    item: item({ status: 'valid', liableAmount: 23_500, matchedPriceId: 'lock-set' }),
    price: LOCK,
    tenancyMonths: 14,
  }

  it('AI 句合格则用 AI 句', () => {
    expect(suggest(ctx, '用了 14 个月，建议最多付 235 元。')).toBe('用了 14 个月，建议最多付 235 元。')
  })

  it('AI 句不合格或缺失，回退模板句', () => {
    expect(suggest(ctx, '法院会判你只付 235 元。')).toBe(buildSuggestion(ctx))
    expect(suggest(ctx)).toBe(buildSuggestion(ctx))
  })

  it('纯函数：两次一致，不改输入', () => {
    const snapshot = structuredClone(ctx)
    expect(suggest(ctx)).toEqual(suggest(ctx))
    expect(ctx).toEqual(snapshot)
  })
})
