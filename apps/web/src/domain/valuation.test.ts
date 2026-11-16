import { describe, expect, it } from 'vitest'

import { PRICES, type PriceItem } from '../content/prices'
import type { ParsedDeduction } from './parse'
import type { Finding, Judgement, JudgementClass } from './types'
import {
  computeValuation,
  findLinkedFindings,
  legalRefsFor,
  matchPrice,
  parsedToItems,
  type ValuationInput,
} from './valuation'

const p = (label: string, amountFen: number): ParsedDeduction => ({
  rawText: `${label} ${amountFen / 100}`,
  label,
  amountFen,
})

// DEMO.md §1.1 五条扣款（拆解后的名目，金额单位分）
const DEMO_PARSED: ParsedDeduction[] = [
  p('墙面到处是印子和钉眼，要整面重新刷，材料加人工', 140_000),
  p('保洁没做干净，我另外请人打扫', 60_000),
  p('门锁不好转，换锁', 40_000),
  p('空调不制冷，加氟', 30_000),
  p('凉席、床单、热水壶都不见了', 50_000),
]

function finding(
  id: string,
  surface: Finding['surface'],
  phenomenon: Finding['phenomenon'],
): Finding {
  return {
    id,
    roomId: 'r1',
    photoOutId: 'p1',
    bbox: [0, 0, 0, 0],
    phenomenon,
    surface,
    severity: 'moderate',
    needsRephoto: false,
  }
}

function judged(
  findingId: string,
  cls: JudgementClass,
  confidence: number,
  override?: { cls: JudgementClass },
): Judgement {
  const j: Judgement = {
    findingId,
    cls,
    ruleId: 'T-00',
    reason: '测试',
    legalRefs: [],
    confidence,
  }
  if (override) j.overriddenByUser = { cls: override.cls, at: '2026-11-16T00:00:00.000Z' }
  return j
}

const price = (id: string, label: string, low: number, mid: number, high: number, life: number | null): PriceItem => ({
  id,
  label,
  unit: '处',
  low,
  mid,
  high,
  life,
  source: '',
  updatedAt: '2026-11-15',
  unverified: true,
})

// 待定项 #5 的对应方案：lock-set mid 275、新增卧具项（P4 核价后入库）。
// 这组数字让 FR-504 的 235 / 145 / 380 精确成立，用来证明公式与文档一致。
const FIXED_PRICES: PriceItem[] = [
  price('wall-patch', '墙面局部修补', 15_000, 22_000, 35_000, 5),
  price('lock-set', '门锁更换', 15_000, 27_500, 45_000, 8),
  price('bedding-set', '卧具补置', 12_000, 18_000, 26_000, 6),
  price('ac-gas', '空调加氟', 10_000, 16_000, 26_000, null),
  price('clean-deep-1br', '退租深度保洁（一居）', 28_000, 42_000, 70_000, null),
]

const input = (over: Partial<ValuationInput>): ValuationInput => ({
  caseId: 'demo',
  deposit: 400_000,
  tenancyMonths: 14,
  parsed: DEMO_PARSED,
  findings: [],
  judgements: [],
  ...over,
})

describe('matchPrice（FR-503 关键词 + 同义词）', () => {
  it('演示消息五条各就各位', () => {
    const labels = DEMO_PARSED.map((i) => i.label)
    expect(matchPrice(labels[0], PRICES)?.id).toBe('wall-patch')
    expect(matchPrice(labels[1], PRICES)?.id).toBe('clean-deep-1br')
    expect(matchPrice(labels[2], PRICES)?.id).toBe('lock-set')
    expect(matchPrice(labels[3], PRICES)?.id).toBe('ac-gas')
    expect(matchPrice(labels[4], PRICES)).toBeNull()
  })

  it('同义写法归到同一项', () => {
    expect(matchPrice('钉眼修补', PRICES)?.id).toBe('wall-nailhole')
    expect(matchPrice('保洁按小时算', PRICES)?.id).toBe('clean-hourly')
    expect(matchPrice('玻璃擦一擦', PRICES)?.id).toBe('clean-window')
    expect(matchPrice('玻璃碎了', PRICES)?.id).toBe('glass-pane')
    expect(matchPrice('天花板有一块掉皮', PRICES)?.id).toBe('ceiling-patch')
  })

  it('无关名目返回 null', () => {
    expect(matchPrice('违约金 2000', PRICES)).toBeNull()
    expect(matchPrice('其他费用', PRICES)).toBeNull()
  })

  it('价格库缺某项时向后匹配，最后落 null 而不是报错', () => {
    const partial = [price('wall-nailhole', '钉眼修补', 500, 1000, 2000, 5)]
    expect(matchPrice('墙面钉眼', partial)?.id).toBe('wall-nailhole')
    expect(matchPrice('墙面印子', partial)).toBeNull()
  })
})

describe('findLinkedFindings', () => {
  const wall = finding('f-wall', 'wall', 'stain')
  const door = finding('f-door', 'door', 'deform')

  it('按部位关联', () => {
    expect(findLinkedFindings('门锁不好转，换锁', [wall, door])).toEqual([door])
    expect(findLinkedFindings('墙面印子', [wall, door])).toEqual([wall])
  })

  it('缺失类按现象关联', () => {
    const missing = finding('f-m', 'furniture', 'missing')
    expect(findLinkedFindings('凉席床单不见了', [wall, missing])).toEqual([missing])
  })
})

describe('computeValuation · 现行价格库 + 低置信判定（演示现状）', () => {
  // 演示案例的两条判定与判定页一致：F-01 C（A-02 兜底，置信 0.42）、F-02 B（0.525），都不驱动金额
  const v = computeValuation(
    input({
      findings: [finding('f-wall', 'wall', 'stain'), finding('f-floor', 'floor', 'scratch')],
      judgements: [judged('f-wall', 'C', 0.42), judged('f-floor', 'B', 0.525)],
    }),
    PRICES,
  )

  it('主张总额 3200 元', () => {
    expect(v.claimedTotal).toBe(320_000)
  })

  it('低置信判定不驱动金额：墙面进争议，应付 0', () => {
    expect(v.items[0].status).toBe('disputed')
    expect(v.payable).toBe(0)
  })

  it('保洁 / 加氟按类判不成立，缺失与门锁无判定进争议', () => {
    expect(v.items.map((i) => i.status)).toEqual([
      'disputed',
      'invalid',
      'disputed',
      'invalid',
      'disputed',
    ])
  })

  it('三数口径（FR-506）：应付 + 不应付 + 争议 = 主张总额', () => {
    expect(v.payable + v.notPayable + v.disputed).toBe(v.claimedTotal)
    expect(v.disputed).toBe(230_000)
    expect(v.notPayable).toBe(90_000)
  })

  it('虚高标记（FR-505）：1400 对局部修补上限 350 为 4.0 倍', () => {
    expect(v.items[0].matchedPriceId).toBe('wall-patch')
    expect(v.items[0].inflatedRatio).toBeCloseTo(4.0, 5)
    expect(v.items[2].inflatedRatio).toBeUndefined()
  })

  it('每条带法条（FR-507）', () => {
    expect(legalRefsFor(v.items[1], PRICES.find((x) => x.id === 'clean-deep-1br'))).toEqual(['reg-10'])
    expect(legalRefsFor(v.items[3], PRICES.find((x) => x.id === 'ac-gas'))).toEqual(['civil-712'])
    expect(legalRefsFor(v.items[0], null)).toEqual(['reg-35'])
  })

  it('金额字段全部是整数分', () => {
    for (const i of v.items) {
      expect(Number.isInteger(i.amount)).toBe(true)
      expect(Number.isInteger(i.liableAmount)).toBe(true)
      for (const k of ['low', 'mid', 'high'] as const) {
        expect(Number.isInteger(i.estimate[k])).toBe(true)
      }
    }
  })
})

describe('computeValuation · 修正价格库 + 已确认判定（FR-504 / DEMO §1.2 复现）', () => {
  const v = computeValuation(
    input({
      findings: [
        finding('f-wall', 'wall', 'scratch'),
        finding('f-missing', 'furniture', 'missing'),
        finding('f-door', 'door', 'deform'),
      ],
      judgements: [
        judged('f-wall', 'B', 0.9),
        judged('f-missing', 'C', 0.9),
        judged('f-door', 'C', 0.9),
      ],
    }),
    FIXED_PRICES,
  )

  it('门锁：260→275 后 round(275 × (1 − 14/96)) = 235 元（FR-504）', () => {
    expect(v.items[2].matchedPriceId).toBe('lock-set')
    expect(v.items[2].status).toBe('valid')
    expect(v.items[2].liableAmount).toBe(23_500)
    expect(v.items[2].depreciation.lifespan).toBe(8)
    expect(v.items[2].depreciation.years).toBeCloseTo(14 / 12, 10)
    expect(v.items[2].depreciation.residualRatio).toBeCloseTo(82 / 96, 10)
  })

  it('卧具：180 × (1 − 14/72) = 145 元（FR-504）', () => {
    expect(v.items[4].matchedPriceId).toBe('bedding-set')
    expect(v.items[4].liableAmount).toBe(14_500)
  })

  it('合计 380，不应付 2820，争议 0（DEMO §1.2）', () => {
    expect(v.payable).toBe(38_000)
    expect(v.notPayable).toBe(282_000)
    expect(v.disputed).toBe(0)
  })

  it('部分成立的主张：超出建议价的部分自动进不应付', () => {
    // 门锁房东要 400，建议 235，差 165 并进不应付（2820 里含它）
    expect(v.items[2].amount - v.items[2].liableAmount).toBe(16_500)
  })

  it('成立项带 711 条', () => {
    expect(legalRefsFor(v.items[2], FIXED_PRICES[1])).toEqual(['civil-711'])
  })
})

describe('computeValuation · 折旧边界与改判', () => {
  const doorFinding = finding('f-door', 'door', 'deform')
  const lockOnly = [p('门锁不好转，换锁', 40_000)]

  it('用满设计年限：残值 0，建议付 0 但仍是成立项', () => {
    const v = computeValuation(
      input({
        tenancyMonths: 96,
        parsed: lockOnly,
        findings: [doorFinding],
        judgements: [judged('f-door', 'C', 0.9)],
      }),
      FIXED_PRICES,
    )
    expect(v.items[0].status).toBe('valid')
    expect(v.items[0].liableAmount).toBe(0)
  })

  it('建议价不会被抬过房东主张：封顶到主张额', () => {
    const v = computeValuation(
      input({
        parsed: [p('门锁不好转，换锁', 10_000)],
        findings: [doorFinding],
        judgements: [judged('f-door', 'C', 0.9)],
      }),
      FIXED_PRICES,
    )
    expect(v.items[0].liableAmount).toBe(10_000)
    expect(v.payable).toBe(10_000)
  })

  it('低置信 C 被用户确认为 C 后驱动金额', () => {
    const v = computeValuation(
      input({
        parsed: lockOnly,
        findings: [doorFinding],
        judgements: [judged('f-door', 'C', 0.42, { cls: 'C' })],
      }),
      FIXED_PRICES,
    )
    expect(v.items[0].status).toBe('valid')
    expect(v.items[0].liableAmount).toBe(23_500)
  })

  it('用户改判 C → B 后按不成立处理', () => {
    const v = computeValuation(
      input({
        parsed: lockOnly,
        findings: [doorFinding],
        judgements: [judged('f-door', 'C', 0.9, { cls: 'B' })],
      }),
      FIXED_PRICES,
    )
    expect(v.items[0].status).toBe('invalid')
    expect(v.items[0].liableAmount).toBe(0)
    expect(v.payable).toBe(0)
  })

  it('改判文案区分入住即有与正常损耗', () => {
    const v = computeValuation(
      input({
        parsed: [p('墙面印子', 50_000)],
        findings: [finding('f-wall', 'wall', 'stain')],
        judgements: [judged('f-wall', 'A', 0.9)],
      }),
      FIXED_PRICES,
    )
    expect(v.items[0].reason).toContain('入住即有')
    expect(legalRefsFor(v.items[0], FIXED_PRICES[0])).toEqual(['civil-710', 'civil-733'])
  })
})

describe('parsedToItems（入库形态）', () => {
  it('只存解析产物，估值字段留零值', () => {
    const rows = parsedToItems('c1', DEMO_PARSED)
    expect(rows).toHaveLength(5)
    expect(rows[0]).toMatchObject({
      id: 'V-01',
      caseId: 'c1',
      label: DEMO_PARSED[0].label,
      amount: 140_000,
      quantity: 1,
      liableAmount: 0,
      status: 'disputed',
      reason: '',
    })
    expect(rows[0].matchedPriceId).toBeUndefined()
  })
})

describe('纯函数（30-domain 规则）', () => {
  it('同一输入两次调用结果一致，且不改输入', () => {
    const findings = [finding('f-door', 'door', 'deform')]
    const judgements = [judged('f-door', 'C', 0.9)]
    const snapshot = structuredClone({ findings, judgements, parsed: DEMO_PARSED })
    const inp = input({ findings, judgements })
    const a = computeValuation(inp, FIXED_PRICES)
    const b = computeValuation(inp, FIXED_PRICES)
    expect(a).toEqual(b)
    expect({ findings, judgements, parsed: DEMO_PARSED }).toEqual(snapshot)
  })
})
