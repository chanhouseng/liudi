// T20 扣款拆解 · 正则层（PLAN T20：先本地正则，失败才走 LLM）。
// 纯函数，Node 可测，不碰网络。LLM 编排在 lib/api/extract.ts 的调用方，
// LLM 结果必须过「金额总和 = statedTotalFen」校验，对不上回退本模块结果。

export interface ParsedDeduction {
  /** 原文片段（≤500 字，FR-501） */
  rawText: string
  /** 去掉编号与金额后的名目 */
  label: string
  /** 整数分 */
  amountFen: number
}

export interface ParseOutcome {
  items: ParsedDeduction[]
  /** 「一共 / 合计」行里的总数（分）；没写总数为 null，用于总和校验 */
  statedTotalFen: number | null
}

const MAX_ITEM_CHARS = 500
const MAX_ITEMS = 20
const MAX_LABEL_CHARS = 40
/** 100 万元（元），防把日期、编号当成金额 */
const MAX_AMOUNT_YUAN = 1_000_000

// 数词后跟这些字时不视为金额（量词/日期/编号）。块也在列：「3 块地板」不是 3 块钱。
const UNIT_FOLLOW = '个只条面扇樘张台件套间层楼号栋幢室厅年月日天号次遍点成%㎡平块'

// 「押金 4000 里扣 500」里的押金数不是扣款。
const NOT_AMOUNT_BEFORE = '(?<!押金\\s?|月租\\s?|租金\\s?|定金\\s?)'

// ¥1400 ｜ 1400元 ｜ 600块钱 ｜ 400块（块后不能是汉字，排除「3 块地板」）
const RE_MONEY = new RegExp(
  `(?:[¥￥]\\s*(\\d[\\d,]*(?:\\.\\d+)?))|${NOT_AMOUNT_BEFORE}(\\d[\\d,]*(?:\\.\\d+)?)\\s*(?:块钱|元|块(?![\\u4e00-\\u9fff]))`,
  'g',
)

// 裸数字：前后不贴数字/小数点/日期分隔；后一个非空白字符不是量词。
const RE_BARE = new RegExp(
  `(?<![\\d./-])${NOT_AMOUNT_BEFORE}(\\d[\\d,]*)(?![\\d./-])(?!\\s*[${UNIT_FOLLOW}])`,
  'g',
)

// 1. ｜ 2、｜ 3）｜ 一、 开头的序号
const RE_NUMBERING = /^[（(]?\s*(?:\d{1,2}|[一二三四五六七八九十]{1,3})\s*[.、，,)）：:]\s*/

const RE_TOTAL = /一共|合计|总共|总计/

function yuanToFen(raw: string): number | null {
  const n = Number(raw.replace(/,/g, ''))
  if (!Number.isFinite(n) || n < 1 || n > MAX_AMOUNT_YUAN) return null
  return Math.round(n * 100)
}

// 字符串拼正则：字符类里混排全半角标点，字面写容易踩未转义的 ]
const PUNCT_CLASS = '\\s，。、；：,.;:！!？?～~\\-—()（）\\[\\]【】<>《》“”\'"'
const RE_LEAD_PUNCT = new RegExp(`^[${PUNCT_CLASS}]+`)
const RE_TRAIL_PUNCT = new RegExp(`[${PUNCT_CLASS}]+$`)

function cleanLabel(s: string): string {
  const t = s
    .replace(/\s+/g, ' ')
    .trim()
    // 金额前常见的悬空动词：「……都不见了，算 500」→ 去掉「算」；先去动词再去标点
    .replace(/[算要加花扣收赔用值]$/, '')
    .replace(RE_TRAIL_PUNCT, '')
    .replace(RE_LEAD_PUNCT, '')
    .trim()
  if (t === '') return '未注明名目'
  return t.length > MAX_LABEL_CHARS ? `${t.slice(0, MAX_LABEL_CHARS - 1)}…` : t
}

interface Occurrence {
  start: number
  end: number
  amountFen: number
}

// 一行里先找带后缀的金额，再把落在其覆盖范围之外的裸数字也当金额。
function findAmounts(text: string): Occurrence[] {
  const occ: Occurrence[] = []
  RE_MONEY.lastIndex = 0
  for (const m of text.matchAll(RE_MONEY)) {
    const fen = yuanToFen(m[1] ?? m[2])
    if (fen === null) continue
    occ.push({ start: m.index, end: m.index + m[0].length, amountFen: fen })
  }
  RE_BARE.lastIndex = 0
  for (const m of text.matchAll(RE_BARE)) {
    const start = m.index
    const end = start + m[0].length
    if (occ.some((o) => start < o.end && end > o.start)) continue
    const fen = yuanToFen(m[1])
    if (fen === null) continue
    occ.push({ start, end, amountFen: fen })
  }
  return occ.sort((a, b) => a.start - b.start)
}

export function parseDeductions(text: string): ParseOutcome {
  const statedTotalFen: number[] = []
  const items: ParsedDeduction[] = []

  for (const line of text.split(/\n+/)) {
    const t = line.trim()
    if (t === '' || items.length >= MAX_ITEMS) continue

    if (RE_TOTAL.test(t)) {
      // 总数行取行内最后一个有效数字，不再拆条目
      const occ = findAmounts(t)
      if (occ.length > 0) statedTotalFen.push(occ[occ.length - 1].amountFen)
      continue
    }

    const stripped = t.replace(RE_NUMBERING, '')
    const stripLen = t.length - stripped.length
    let prevEnd = 0
    for (const o of findAmounts(stripped)) {
      const labelSrc = stripped.slice(prevEnd, o.start)
      const raw = t.slice(stripLen + prevEnd, stripLen + o.end)
      items.push({
        rawText: raw.slice(0, MAX_ITEM_CHARS),
        label: cleanLabel(labelSrc),
        amountFen: o.amountFen,
      })
      prevEnd = o.end
      if (items.length >= MAX_ITEMS) break
    }
  }

  return { items, statedTotalFen: statedTotalFen.length > 0 ? statedTotalFen[statedTotalFen.length - 1] : null }
}
