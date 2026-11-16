// T24/T25 /api/wording FC 代理（阿里云函数计算 · 自定义运行时 HTTP）
// 与 functions/vision、functions/extract 同一套安全模式。
// 两个任务，服务端只做措辞，不做任何金额计算、不下责任结论：
//   polish   —— 重写信件说明段（T24，FR-601）
//   landlord —— 扮演房东练习谈判（T25，FR-605）
//
// 环境变量：
//   DASHSCOPE_API_KEY        必填，百炼密钥，只存在这里
//   DASHSCOPE_MODEL_WORDING  选填，默认 qwen-plus
//   ALLOWED_ORIGINS          选填，逗号分隔；未配置只放行 localhost
//
// 行为约定：限流 20 次/分钟/IP；上游超时 25s；返回体不含原始模型输出之外的字段。

'use strict'

const UPSTREAM_TIMEOUT_MS = 25000
const RATE_LIMIT = 20
const RATE_WINDOW_MS = 60000
const MAX_BODY_BYTES = 16384
const POLISH_MAX_CHARS = 2000
const POLISH_OUT_MAX = 400
const FACTS_MAX = 12
const FACT_ITEM_MAX = 120
const EXCERPT_MAX = 2000
const TURN_MAX = 6
const TURN_TEXT_MAX = 600
const REPLY_OUT_MAX = 600
const FLAW_OUT_MAX = 120
const TONES = ['polite', 'neutral', 'firm']
const PERSONAS = ['pressure', 'stall', 'reasonable']
const STANCES = ['hold', 'concede', 'shift']
const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4173',
]
const UPSTREAM_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'

const POLISH_SYSTEM_PROMPT = [
  '你在帮租客改写押金沟通信的「说明段」。只改写这一段，其余内容由程序负责。',
  '',
  '规则：',
  '1. 只输出改写后的说明段正文：不要标题、不要列表、不要引号、不要任何解释。',
  '2. 不超过 180 字。',
  '3. 只能使用「已知信息」里出现的数字与事实。禁止新增任何数字、金额、天数、日期、法条。',
  '4. 语气：polite=客气礼貌；neutral=平实直接；firm=明确坚定。语气可以变，事实与数字一个都不能变。',
  '5. 禁止出现「保证」「一定能」「必赢」「百分百」这类承诺，禁止威胁性表达。',
].join('\n')

const LANDLORD_SYSTEM_PROMPT = [
  '你在扮演收押金的房东，和租客练习押金谈判。这只是演练，不会真的发出去。',
  '',
  '人格：',
  '- pressure（压价型）：咬住总价不放，动辄「整面重刷」「全部换新」，嫌租客计较。',
  '- stall（耍赖型）：拿「合同写了保持原样」当挡箭牌，把「原状」说成「全新」，回避具体条款。',
  '- reasonable（讲理型）：愿意讲道理，但表达模糊，不主动给具体项目和金额。',
  '',
  '规则：',
  '1. 每次回复不超过 120 字，口语化，只站在房东立场。',
  '2. 可以引用租客信里出现过的金额和项目名，禁止编造新的金额数字。',
  '3. 禁止引用任何法条（不要出现《民法典》《住房租赁条例》第几条）——你是房东，不是律师。',
  '4. 禁止人身攻击、威胁、脏话。',
  '5. 只输出 JSON：{"reply":"房东的话","flaw":"租客最后一句话的破绽","stance":"hold|concede|shift"}',
  '   - flaw：点评租客最后一句暴露了什么（如「你承认了整面墙都需要处理」），一句话不超过 40 字；若这句站得住，写「这句站得住，继续盯具体项目和数字」。',
  '   - stance：租客最后一句是守住立场（hold）、让出了立场（concede）、还是转移话题（shift）。',
].join('\n')

function parseAllowedOrigins(env) {
  const raw = (env && env.ALLOWED_ORIGINS) || ''
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return list.length > 0 ? list : DEFAULT_ORIGINS
}

function resolveOrigin(headers, env) {
  const origin = headers.origin
  if (!origin) return { present: false, allowed: true }
  const allowed = parseAllowedOrigins(env).includes(origin)
  return { present: true, allowed, origin }
}

function rateLimit(hits, ip, now) {
  const arr = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS)
  if (arr.length >= RATE_LIMIT) {
    hits.set(ip, arr)
    return false
  }
  arr.push(now)
  hits.set(ip, arr)
  return true
}

function extractJson(text) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

function cappedString(v, max) {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s === '' ? null : s.slice(0, max)
}

function validatePolish(body) {
  if (!body || typeof body !== 'object' || body.task !== 'polish') return null
  if (
    typeof body.section !== 'string' ||
    body.section.trim() === '' ||
    body.section.length > POLISH_MAX_CHARS
  ) {
    return null
  }
  const section = body.section.trim()
  const tone = TONES.includes(body.tone) ? body.tone : 'neutral'
  let facts = body.facts
  if (!Array.isArray(facts)) facts = []
  facts = facts
    .filter((f) => typeof f === 'string' && f.trim() !== '')
    .slice(0, FACTS_MAX)
    .map((f) => f.trim().slice(0, FACT_ITEM_MAX))
  return { task: 'polish', section, tone, facts }
}

function validateLandlord(body) {
  if (!body || typeof body !== 'object' || body.task !== 'landlord') return null
  if (!PERSONAS.includes(body.persona)) return null
  const round = body.round
  if (!Number.isInteger(round) || round < 1 || round > 3) return null
  const excerpt = cappedString(body.letterExcerpt, EXCERPT_MAX)
  if (excerpt === null) return null
  const tenantText = cappedString(body.tenantText, TURN_TEXT_MAX)
  if (tenantText === null) return null
  let history = body.history
  if (!Array.isArray(history)) return null
  history = history.slice(-TURN_MAX).map((t) => {
    if (!t || typeof t !== 'object') return null
    const role = t.role === 'landlord' || t.role === 'tenant' ? t.role : null
    const text = cappedString(t.text, TURN_TEXT_MAX)
    return role && text ? { role, text } : null
  })
  if (history.some((t) => t === null)) return null
  return { persona: body.persona, round, letterExcerpt: excerpt, history, tenantText }
}

function json(status, body, origin) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' }
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Vary'] = 'Origin'
  }
  return { status, headers, body: JSON.stringify(body) }
}

function buildMessages(validated) {
  if (validated.task === 'polish') {
    const facts = validated.facts.length > 0 ? validated.facts.map((f) => `- ${f}`).join('\n') : '-（无）'
    return [
      { role: 'system', content: POLISH_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `已知信息：\n${facts}\n\n原文：\n${validated.section}\n\n按系统规则改写。`,
      },
    ]
  }
  const history = validated.history
    .map((t) => `${t.role === 'landlord' ? '房东' : '租客'}：${t.text}`)
    .join('\n')
  return [
    { role: 'system', content: LANDLORD_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `租客的信件摘要：\n${validated.letterExcerpt}\n\n对话记录：\n${history}\n\n租客说：${validated.tenantText}\n\n按系统规则回应。`,
    },
  ]
}

function sanitizePolish(text) {
  const s = typeof text === 'string' ? text.trim() : ''
  if (s === '') return null
  return s.slice(0, POLISH_OUT_MAX)
}

function sanitizeLandlord(parsed) {
  if (!parsed || typeof parsed !== 'object') return null
  const reply = cappedString(parsed.reply, REPLY_OUT_MAX)
  if (reply === null) return null
  const flawRaw = parsed.flaw
  const flaw = typeof flawRaw === 'string' ? flawRaw.trim().slice(0, FLAW_OUT_MAX) : ''
  const stance = STANCES.includes(parsed.stance) ? parsed.stance : 'hold'
  return { reply, flaw, stance }
}

// deps: { hits: Map, fetchImpl: typeof fetch, now: () => number }
async function handleRequest({ method, headers, body, env }, deps) {
  const fetchImpl = deps.fetchImpl || global.fetch
  const now = deps.now || (() => Date.now())
  const origin = resolveOrigin(headers, env)

  if (method === 'OPTIONS') {
    if (!origin.allowed || !origin.present) return { status: 204, headers: {}, body: '' }
    return { status: 204, headers: {
      'Access-Control-Allow-Origin': origin.origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    }, body: '' }
  }
  if (method !== 'POST') return json(405, { ok: false, reason: 'method-not-allowed' }, null)
  if (!origin.allowed) return json(401, { ok: false, reason: 'unauthorized' }, null)

  const ip = (headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown'
  if (!rateLimit(deps.hits, ip, now())) {
    return json(429, { ok: false, reason: 'rate-limited' }, origin.origin)
  }
  if (Buffer.byteLength(body || '', 'utf8') > MAX_BODY_BYTES) {
    return json(413, { ok: false, reason: 'payload-too-large' }, origin.origin)
  }

  let parsed
  try {
    parsed = JSON.parse(body || '')
  } catch {
    parsed = null
  }
  const task = parsed && parsed.task
  const validated = task === 'polish' ? validatePolish(parsed) : validateLandlord(parsed)
  if (!validated) return json(400, { ok: false, reason: 'invalid-body' }, origin.origin)
  const apiKey = env.DASHSCOPE_API_KEY
  if (!apiKey) return json(500, { ok: false, reason: 'server-misconfigured' }, origin.origin)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  let res
  try {
    res = await fetchImpl(UPSTREAM_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.DASHSCOPE_MODEL_WORDING || 'qwen-plus',
        temperature: task === 'polish' ? 0.3 : 0.7,
        max_tokens: task === 'polish' ? 512 : 1024,
        messages: buildMessages(validated),
      }),
    })
  } catch {
    return json(504, { ok: false, reason: 'upstream-timeout' }, origin.origin)
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) return json(502, { ok: false, reason: 'upstream' }, origin.origin)

  let payload
  try {
    payload = await res.json()
  } catch {
    return json(502, { ok: false, reason: 'upstream' }, origin.origin)
  }
  const content =
    payload && payload.choices && payload.choices[0] && payload.choices[0].message
      ? payload.choices[0].message.content
      : null
  if (typeof content !== 'string') {
    return json(502, { ok: false, reason: 'upstream' }, origin.origin)
  }

  if (task === 'polish') {
    const text = sanitizePolish(content)
    if (text === null) return json(502, { ok: false, reason: 'upstream' }, origin.origin)
    return json(200, { ok: true, task, text }, origin.origin)
  }
  const out = sanitizeLandlord(extractJson(content))
  if (out === null) return json(502, { ok: false, reason: 'upstream' }, origin.origin)
  return json(200, { ok: true, task, ...out }, origin.origin)
}

const hits = new Map()

async function handler(req, res) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const body = Buffer.concat(chunks).toString('utf8')
  const out = await handleRequest(
    { method: req.method, headers: req.headers, body, env: process.env },
    { hits },
  )
  res.statusCode = out.status
  for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v)
  res.end(out.body)
}

exports.handler = handler
exports.handleRequest = handleRequest
exports.sanitizePolish = sanitizePolish
exports.sanitizeLandlord = sanitizeLandlord
exports.extractJson = extractJson
exports.rateLimit = rateLimit
exports.validatePolish = validatePolish
exports.validateLandlord = validateLandlord
exports.POLISH_SYSTEM_PROMPT = POLISH_SYSTEM_PROMPT
exports.LANDLORD_SYSTEM_PROMPT = LANDLORD_SYSTEM_PROMPT
