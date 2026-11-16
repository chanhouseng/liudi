// T20 /api/extract FC 代理（阿里云函数计算 · 自定义运行时 HTTP）
// 与 functions/vision 同一套安全模式；只拆条目，不下结论，不做金额计算。
//
// 环境变量：
//   DASHSCOPE_API_KEY        必填，百炼密钥，只存在这里
//   DASHSCOPE_MODEL_EXTRACT  选填，默认 qwen-plus
//   ALLOWED_ORIGINS          选填，逗号分隔；未配置只放行 localhost
//
// 行为约定（PLAN T20）：限流 20 次/分钟/IP；文本 ≤ 2000 字；上游超时 25s；
// 返回体只有 {label, amountFen}，永不含原始模型输出。金额在服务端换算成整数分。

'use strict'

const UPSTREAM_TIMEOUT_MS = 25000
const RATE_LIMIT = 20
const RATE_WINDOW_MS = 60000
const MAX_TEXT_CHARS = 2000
const MAX_ITEMS = 20
const MAX_AMOUNT_FEN = 100_000_000
const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4173',
]
const UPSTREAM_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'

const SYSTEM_PROMPT = [
  '你是记账助手，把房东发来的押金扣款消息拆成条目。',
  '',
  '规则：',
  '1. 只提取文字里明确写出的扣款项目和金额，不要推断、不要换算、不要补充。',
  '2. amount 是房东对该项目要扣的金额（元，数字）。',
  '3. 「一共 / 合计」后面的总数不是条目，不要输出。',
  '4. 禁止判断责任，禁止出现"应当""应该""该赔"这类措辞。',
  '5. 只输出 JSON：{"items":[{"label":"扣款名目","amount":1400}]}',
  '文字里没有可提取的条目时输出 {"items":[]}',
].join('\n')

const USER_TEXT = '把这条消息按系统规则拆成 JSON。'

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

// 元 → 整数分；越界/非有限数丢弃。LLM 只出元，分由这里定死。
function sanitizeItem(o) {
  if (!o || typeof o !== 'object') return null
  const label = cappedString(o.label, 60)
  if (label === null) return null
  const amount = o.amount
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0.01) return null
  const amountFen = Math.round(amount * 100)
  if (amountFen < 1 || amountFen > MAX_AMOUNT_FEN) return null
  return { label, amountFen }
}

function json(status, body, origin) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' }
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Vary'] = 'Origin'
  }
  return { status, headers, body: JSON.stringify(body) }
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
  if (Buffer.byteLength(body || '', 'utf8') > MAX_TEXT_CHARS * 4 + 64) {
    return json(413, { ok: false, reason: 'payload-too-large' }, origin.origin)
  }

  let text
  try {
    const parsed = JSON.parse(body || '')
    text = parsed && parsed.text
  } catch {
    text = null
  }
  if (typeof text !== 'string' || text.trim().length === 0 || text.length > MAX_TEXT_CHARS) {
    return json(400, { ok: false, reason: 'invalid-body' }, origin.origin)
  }
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
        model: env.DASHSCOPE_MODEL_EXTRACT || 'qwen-plus',
        temperature: 0.1,
        max_tokens: 1024,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: USER_TEXT + '\n\n' + text },
        ],
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
  const parsed = extractJson(content)
  const raw = parsed && Array.isArray(parsed.items) ? parsed.items : []
  const items = raw
    .map(sanitizeItem)
    .filter(Boolean)
    .slice(0, MAX_ITEMS)
  return json(200, { ok: true, items }, origin.origin)
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
exports.sanitizeItem = sanitizeItem
exports.extractJson = extractJson
exports.rateLimit = rateLimit
exports.SYSTEM_PROMPT = SYSTEM_PROMPT
