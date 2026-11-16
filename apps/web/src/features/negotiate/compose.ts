// T24 信件组装（FR-601/602/603）：模板先行且必须完整，LLM 只重写说明段。
// 数字回填校验与建议层同一套（FR-602 = FR-508，domain/numcheck）；校验不过整段丢弃回退模板，用户无感。
import { findLegal } from '@/content/legal'
import {
  defaultSummary,
  renderLetter,
  subjectFor,
  type Channel,
  type LetterFacts,
  type Tone,
} from '@/content/letterTemplates'
import { findPrice } from '@/content/prices'
import { PHENOMENON_LABELS } from '@/content/vocab'
import { FORBIDDEN_PHRASES, allowedSetFor, numbersWithin } from '@/domain/numcheck'
import { findLinkedFindings, legalRefsFor } from '@/domain/valuation'
import type { Case, CaseValuation, DeductionItem, Finding } from '@/domain/types'
import { formatYuan } from '@/lib/format'

export const DEADLINE_DAYS = 7
export const POLISH_MAX_CHARS = 180

export interface ComposeInput {
  caseData: Case
  months: number
  valuation: CaseValuation
  findings: Finding[]
}

export interface LetterCitation {
  evidenceId: string
  caption: string
}

export interface ComposedLetter {
  subject: string
  body: string
  citations: LetterCitation[]
  polished: boolean
}

// FR-602：信里允许出现的数字全集（元字符串 / 计数）。分→元交给 numcheck；
// 35 是强硬语气结尾引用的《住房租赁条例》条号，属白名单事实。
export function letterAllowedSet(input: ComposeInput): Set<string> {
  const v = input.valuation
  const fens = [
    input.caseData.deposit,
    input.caseData.rentMonthly,
    v.claimedTotal,
    v.payable,
    v.notPayable,
    v.disputed,
    Math.max(0, input.caseData.deposit - v.payable),
  ]
  for (const i of v.items) {
    fens.push(i.amount, i.liableAmount, i.estimate.low, i.estimate.mid, i.estimate.high)
  }
  return allowedSetFor(new Set(), fens, [input.months, DEADLINE_DAYS, 35])
}

function itemVerdictLine(item: DeductionItem): string {
  const price = item.matchedPriceId ? (findPrice(item.matchedPriceId) ?? null) : null
  const refs = legalRefsFor(item, price)
  const law = refs.length > 0 ? `（${findLegal(refs[0])?.title ?? refs[0]}）` : ''
  if (item.status === 'valid') return `按市场价与折旧核算，这一项合理${law}。`
  if (item.status === 'invalid') return `这项不符合扣减条件，不应扣${law}。`
  return item.matchedPriceId
    ? `金额与市场参考价出入较大，暂记为争议${law}。`
    : `暂无市场参考价，先按房东报价暂记，愿逐项核对${law}。`
}

export function toFacts(input: ComposeInput): LetterFacts {
  const v = input.valuation
  return {
    alias: input.caseData.alias,
    months: input.months,
    deadlineDays: DEADLINE_DAYS,
    deposit: formatYuan(input.caseData.deposit),
    refund: formatYuan(Math.max(0, input.caseData.deposit - v.payable)),
    payableTotal: formatYuan(v.payable),
    disputedTotal: v.disputed > 0 ? formatYuan(v.disputed) : null,
    items: v.items.map((i) => ({
      label: i.label,
      claimed: formatYuan(i.amount),
      verdictLine: itemVerdictLine(i),
      payable: i.status === 'valid' && i.liableAmount > 0 ? formatYuan(i.liableAmount) : null,
    })),
  }
}

export function buildCitations(input: ComposeInput): LetterCitation[] {
  const seen = new Set<string>()
  const out: LetterCitation[] = []
  for (const item of input.valuation.items) {
    for (const f of findLinkedFindings(item.label, input.findings)) {
      if (seen.has(f.id)) continue
      seen.add(f.id)
      out.push({ evidenceId: f.id, caption: PHENOMENON_LABELS[f.phenomenon] })
    }
  }
  return out.slice(0, 8)
}

export function composeTemplate(input: ComposeInput, tone: Tone, channel: Channel): ComposedLetter {
  const facts = toFacts(input)
  return {
    subject: subjectFor(facts, channel),
    body: renderLetter(facts, tone, channel),
    citations: buildCitations(input),
    polished: false,
  }
}

const CITATION_RE = /\b[DF]-\d{1,3}\b/g

export function hasUnknownCitation(text: string, citations: LetterCitation[]): boolean {
  const known = new Set(citations.map((c) => c.evidenceId))
  for (const m of text.match(CITATION_RE) ?? []) {
    if (!known.has(m)) return true
  }
  return false
}

// LLM 只重写说明段（微信开头 / 正式函事由 / 调解申请争议事项），其余行模板定死。
// 任何校验失败都静默回退模板版（SCREENS S15：不弹窗，console.debug）。
export async function composeWithAi(
  input: ComposeInput,
  tone: Tone,
  channel: Channel,
  signal?: AbortSignal,
): Promise<ComposedLetter> {
  const base = composeTemplate(input, tone, channel)
  if ((import.meta.env.VITE_WORDING_API ?? '') === '') return base
  try {
    const { polishSection } = await import('@/lib/api/wording')
    const facts = toFacts(input)
    const section = await polishSection(
      {
        section: defaultSummary(tone),
        facts: [
          `${input.months} 个月租期`,
          `押金 ${facts.deposit}`,
          `合理扣款 ${facts.payableTotal}`,
          `应返还 ${facts.refund}`,
          ...(facts.disputedTotal ? [`争议 ${facts.disputedTotal}`] : []),
          `${DEADLINE_DAYS} 天内回复`,
        ],
        tone,
      },
      signal,
    )
    if (section === null) return base
    const ok =
      section.length <= POLISH_MAX_CHARS &&
      !FORBIDDEN_PHRASES.test(section) &&
      !hasUnknownCitation(section, base.citations) &&
      numbersWithin(section, letterAllowedSet(input))
    if (!ok) return base
    return { ...base, body: renderLetter(facts, tone, channel, section), polished: true }
  } catch (err) {
    console.debug('compose: polish fallback to template', err)
    return base
  }
}
