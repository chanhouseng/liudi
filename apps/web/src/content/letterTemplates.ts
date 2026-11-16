// 信件模板（T24 / FR-603 / FR-604）。3 语气 × 3 渠道 = 9 个，全部可独立渲染成功。
// 语气只换措辞，事实与数字完全一致（FR-603）；金额由 compose 传格式化好的字符串，
// 模板不接触数字计算。话术口径同 CONTENT.md §6（禁威胁、禁虚张声势）。

export type Tone = 'polite' | 'neutral' | 'firm'
export type Channel = 'wechat' | 'formal' | 'mediation'

export interface LetterItemLine {
  label: string
  claimed: string
  verdictLine: string
  payable: string | null
}

export interface LetterFacts {
  alias: string
  months: number
  deadlineDays: number
  deposit: string
  refund: string
  payableTotal: string
  disputedTotal: string | null
  items: LetterItemLine[]
}

export const LETTER_TONES: { value: Tone; label: string }[] = [
  { value: 'polite', label: '客气' },
  { value: 'neutral', label: '中性' },
  { value: 'firm', label: '强硬' },
]

export const LETTER_CHANNELS: { value: Channel; label: string }[] = [
  { value: 'wechat', label: '微信' },
  { value: 'formal', label: '正式函' },
  { value: 'mediation', label: '调解申请' },
]

// SCREENS S15：结尾固定句
export const LETTER_CLOSING = '以上依据如有不同意见，我们可以只谈有分歧的部分。'
export const LETTER_DISCLAIMER = '附注：本函由留底工具辅助整理，不构成法律意见。'
export const LETTER_DISCLAIMER_WECHAT = '（本工具不构成法律意见。）'

const OPENING: Record<Tone, string> = {
  polite: '您好。房子我已按约定时间腾空并做了保洁，退租照片都在。关于押金，想把下面几项跟您对一遍。',
  neutral: '房子已按约定腾空，退租照片与底稿在案。押金扣款我逐项对比如下。',
  firm: '房子已按约定腾空，退租照片、底稿与哈希记录齐全。以下扣款主张，逐项答复如下。',
}

const ASK: Record<Tone, string> = {
  polite: '麻烦您收到后 {days} 天内回复，不耽误您几分钟。',
  neutral: '请收到后 {days} 天内回复。',
  // 不写条号：FR-603 要求三种语气的数字序列完全一致，条号数字会多出来
  firm: '请收到后 {days} 天内答复；逾期未复，我将申请调解。',
}

function askLine(tone: Tone, days: number): string {
  return ASK[tone].replace('{days}', String(days))
}

function itemLines(facts: LetterFacts): string[] {
  return facts.items.map(
    (i) =>
      `${i.label}：房东主张 ${i.claimed}。${i.verdictLine}${i.payable ? `建议承担 ${i.payable}。` : ''}`,
  )
}

function disputedLine(facts: LetterFacts): string | null {
  if (facts.disputedTotal === null) return null
  return `另有争议部分合计 ${facts.disputedTotal}，我愿意提供照片与逐项判定材料，和您当面核对。`
}

export function subjectFor(facts: LetterFacts, channel: Channel): string {
  if (channel === 'formal') return `关于${facts.alias}退租押金返还的函`
  if (channel === 'mediation') return `住房租赁押金返还调解申请（${facts.alias}）`
  return '押金对一下'
}

// 说明段：微信版开头 / 正式函事由 / 调解申请争议事项。默认取 OPENING[tone]，
// LLM 润色时可整体替换（T24：LLM 只重写这一段，其余行模板定死）。
export function defaultSummary(tone: Tone): string {
  return OPENING[tone]
}

export function wechatBody(facts: LetterFacts, tone: Tone, summary: string = OPENING[tone]): string {
  return [
    summary,
    ...itemLines(facts),
    disputedLine(facts),
    `算下来，合理的扣款是 ${facts.payableTotal}，请返还押金 ${facts.refund}。`,
    askLine(tone, facts.deadlineDays),
    LETTER_CLOSING,
    LETTER_DISCLAIMER_WECHAT,
  ]
    .filter((s): s is string => s !== null)
    .join('\n')
}

export function formalBody(facts: LetterFacts, tone: Tone, summary: string = defaultSummary(tone)): string {
  return [
    `致${facts.alias}出租人：`,
    `事由：${summary}`,
    '',
    '一、逐项说明',
    ...itemLines(facts),
    disputedLine(facts),
    '',
    '二、诉求',
    `认可的合理扣款合计 ${facts.payableTotal}，请于收到本函后 ${facts.deadlineDays} 日内返还剩余押金 ${facts.refund}。`,
    askLine(tone, facts.deadlineDays),
    LETTER_CLOSING,
    '',
    LETTER_DISCLAIMER,
    '',
    '承租人：（签名为准）',
    '日期：（寄出日期）',
  ]
    .filter((s): s is string => s !== null)
    .join('\n')
}

export function mediationBody(facts: LetterFacts, tone: Tone, summary: string = defaultSummary(tone)): string {
  return [
    '申请人：（你的姓名／联系电话）',
    `被申请人：（房东姓名或主体名称，房屋：${facts.alias}）`,
    '',
    '一、争议事项',
    summary,
    '',
    '二、逐项说明',
    ...itemLines(facts),
    disputedLine(facts),
    '',
    '三、请求事项',
    `认可的合理扣款合计 ${facts.payableTotal}，请求调解由被申请人返还剩余押金 ${facts.refund}。`,
    askLine(tone, facts.deadlineDays),
    LETTER_CLOSING,
    '',
    LETTER_DISCLAIMER,
  ]
    .filter((s): s is string => s !== null)
    .join('\n')
}

export function renderLetter(facts: LetterFacts, tone: Tone, channel: Channel, summary?: string): string {
  if (channel === 'wechat') return wechatBody(facts, tone, summary)
  if (channel === 'formal') return formalBody(facts, tone, summary)
  return mediationBody(facts, tone, summary)
}
