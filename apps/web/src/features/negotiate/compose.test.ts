// T24 compose 单测：9 组合渲染、语气换措辞数字不变（FR-603）、数字回填校验回退（FR-602）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LETTER_CLOSING, LETTER_DISCLAIMER, LETTER_DISCLAIMER_WECHAT } from '@/content/letterTemplates'
import { numberTokens } from '@/domain/numcheck'
import type { Case, CaseValuation, DeductionItem, Finding } from '@/domain/types'
import { buildCitations, composeTemplate, composeWithAi, hasUnknownCitation, letterAllowedSet, toFacts } from './compose'

vi.mock('@/lib/api/wording', () => ({ polishSection: vi.fn() }))

import { polishSection } from '@/lib/api/wording'

const baseCase: Case = {
  id: 'c1',
  alias: '文一西路 3 幢',
  city: 'hangzhou',
  addressMasked: '',
  rentMonthly: 400_000,
  deposit: 400_000,
  leaseStart: '2024-11-01',
  leaseEnd: '2025-11-01',
  landlordType: 'personal',
  createdAt: '2026-11-15T10:00:00Z',
}

const findings: Finding[] = [
  {
    id: 'F-01',
    roomId: 'r1',
    photoOutId: 'p1',
    bbox: [0, 0, 10, 10],
    phenomenon: 'stain',
    surface: 'wall',
    severity: 'moderate',
    needsRephoto: false,
  },
  {
    id: 'F-02',
    roomId: 'r1',
    photoOutId: 'p2',
    bbox: [0, 0, 10, 10],
    phenomenon: 'scratch',
    surface: 'floor',
    severity: 'light',
    needsRephoto: false,
  },
]

const items: DeductionItem[] = [
  {
    id: 'i1',
    caseId: 'c1',
    rawText: '墙面重刷 1400',
    label: '墙面重刷',
    amount: 140_000,
    matchedPriceId: 'wall-repaint-1',
    quantity: 1,
    estimate: { low: 20_000, mid: 32_000, high: 50_000 },
    depreciation: { years: 3, lifespan: 5, residualRatio: 0.4 },
    liableAmount: 12_800,
    status: 'valid',
    reason: '',
  },
  {
    id: 'i2',
    caseId: 'c1',
    rawText: '保洁 600',
    label: '保洁',
    amount: 60_000,
    quantity: 1,
    estimate: { low: 0, mid: 0, high: 0 },
    depreciation: { years: 0, lifespan: 0, residualRatio: 0 },
    liableAmount: 0,
    status: 'disputed',
    reason: '',
  },
]

function makeValuation(partial: Partial<CaseValuation> = {}): CaseValuation {
  return {
    deposit: 400_000,
    claimedTotal: 200_000,
    payable: 12_800,
    notPayable: 127_200,
    disputed: 60_000,
    items,
    ...partial,
  }
}

const input = { caseData: baseCase, months: 12, valuation: makeValuation(), findings }
const TONES = ['polite', 'neutral', 'firm'] as const
const CHANNELS = ['wechat', 'formal', 'mediation'] as const

describe('composeTemplate', () => {
  it('9 组合全部渲染：结尾句 / 免责 / 主题齐备', () => {
    for (const tone of TONES) {
      for (const channel of CHANNELS) {
        const letter = composeTemplate(input, tone, channel)
        expect(letter.subject.length).toBeGreaterThan(0)
        expect(letter.body).toContain(LETTER_CLOSING)
        expect(letter.body).not.toMatch(/保证退款|一定能要回|必赢|百分百/)
        if (channel === 'wechat') expect(letter.body).toContain(LETTER_DISCLAIMER_WECHAT)
        else expect(letter.body).toContain(LETTER_DISCLAIMER)
        expect(letter.polished).toBe(false)
      }
    }
  })

  it('FR-603：语气只换措辞，数字序列完全一致', () => {
    for (const channel of CHANNELS) {
      const seqs = TONES.map((tone) => numberTokens(composeTemplate(input, tone, channel).body))
      expect(seqs[1]).toEqual(seqs[0])
      expect(seqs[2]).toEqual(seqs[0])
    }
  })

  it('渠道格式（FR-604）：微信短句无称谓；正式函有事由落款；调解申请有双方占位', () => {
    const w = composeTemplate(input, 'neutral', 'wechat').body
    expect(w).toContain('算下来')
    expect(w).not.toContain('致')
    const f = composeTemplate(input, 'neutral', 'formal').body
    expect(f).toContain('事由：')
    expect(f).toContain('承租人：')
    const m = composeTemplate(input, 'neutral', 'mediation').body
    expect(m).toContain('申请人：')
    expect(m).toContain('被申请人：')
  })

  it('逐项行带判定结论、法条与建议金额；无争议时 disputedTotal 为空', () => {
    const facts = toFacts(input)
    expect(facts.refund).toBe('¥3,872')
    expect(facts.disputedTotal).toBe('¥600')
    expect(facts.items[0].verdictLine).toContain('《民法典》第 711 条')
    expect(facts.items[0].payable).toBe('¥128')
    expect(facts.items[1].verdictLine).toContain('暂无市场参考价')
    expect(facts.items[1].payable).toBeNull()
    const noDisputed = toFacts({ ...input, valuation: makeValuation({ disputed: 0 }) })
    expect(noDisputed.disputedTotal).toBeNull()
  })

  it('全部不合理时应付为 0、退款等于押金；headline 数字仍在白名单', () => {
    const zero = { ...input, valuation: makeValuation({ payable: 0, notPayable: 200_000, disputed: 0, items: [] }) }
    const facts = toFacts(zero)
    expect(facts.payableTotal).toBe('¥0')
    expect(facts.refund).toBe('¥4,000')
    const allowed = letterAllowedSet(zero)
    expect(allowed.has('4000')).toBe(true)
    expect(allowed.has('0')).toBe(true)
  })
})

describe('letterAllowedSet', () => {
  it('包含押金/租金/三数/退款/每项金额与估价（元）与计数', () => {
    const allowed = letterAllowedSet(input)
    for (const n of ['4000', '2000', '128', '3872', '600', '12', '7', '35']) {
      expect(allowed.has(n), n).toBe(true)
    }
    expect(allowed.has('1400')).toBe(true)
    expect(allowed.has('500')).toBe(true)
    expect(allowed.has('2001')).toBe(false)
  })
})

describe('citations', () => {
  it('按扣款名目关联 findings，编号 + 现象名', () => {
    const citations = buildCitations(input)
    expect(citations).toContainEqual({ evidenceId: 'F-01', caption: '污渍' })
    expect(citations.find((c) => c.evidenceId === 'F-02')).toBeUndefined()
  })

  it('hasUnknownCitation：信里出现的 [DF]-xx 必须在引用清单里', () => {
    const citations = buildCitations(input)
    expect(hasUnknownCitation('详见 F-01 底稿。', citations)).toBe(false)
    expect(hasUnknownCitation('详见 D-03 底稿。', citations)).toBe(true)
    expect(hasUnknownCitation('没有引用任何编号。', citations)).toBe(false)
  })
})

describe('composeWithAi', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.mocked(polishSection).mockReset()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('未配置端点：直接返回模板版，不发起请求', async () => {
    vi.stubEnv('VITE_WORDING_API', '')
    const letter = await composeWithAi(input, 'neutral', 'wechat')
    expect(letter.polished).toBe(false)
    expect(letter.body).toBe(composeTemplate(input, 'neutral', 'wechat').body)
    expect(polishSection).not.toHaveBeenCalled()
  })

  it('润色成功：说明段被替换，数字全部在白名单内', async () => {
    vi.stubEnv('VITE_WORDING_API', 'https://w.test')
    vi.mocked(polishSection).mockResolvedValueOnce('房子已腾空，押金 ¥4,000，合理扣款 ¥128，请返还 ¥3,872，盼 7 天内回复。')
    const letter = await composeWithAi(input, 'neutral', 'wechat')
    expect(letter.polished).toBe(true)
    expect(letter.body).toContain('盼 7 天内回复')
    expect(letter.body).toContain('合理扣款')
  })

  it('FR-602：LLM 返回集合外数字 → 整段丢弃回退模板，用户无感', async () => {
    vi.stubEnv('VITE_WORDING_API', 'https://w.test')
    vi.mocked(polishSection).mockResolvedValueOnce('房东要扣 9999 元，我方只认合理部分。')
    const letter = await composeWithAi(input, 'neutral', 'wechat')
    expect(letter.polished).toBe(false)
    expect(letter.body).toBe(composeTemplate(input, 'neutral', 'wechat').body)
    expect(letter.body).not.toContain('9999')
  })

  it('禁语 / 超长 / 幽灵引用 → 同样回退模板', async () => {
    vi.stubEnv('VITE_WORDING_API', 'https://w.test')
    const mock = vi.mocked(polishSection)
    for (const bad of [
      '法院会判你只付 ¥128。',
      '长'.repeat(181),
      '底稿 D-03 可以证明这点。',
      null,
    ]) {
      mock.mockResolvedValueOnce(bad)
      const letter = await composeWithAi(input, 'neutral', 'wechat')
      expect(letter.polished).toBe(false)
      expect(letter.body).toBe(composeTemplate(input, 'neutral', 'wechat').body)
    }
  })
})
