// T15 FC 代理（阿里云函数计算 · 自定义运行时 HTTP）
// 逻辑集中在 handleRequest（依赖注入、可 node:test），底部 handler 只做 http 装配。
//
// 环境变量：
//   DASHSCOPE_API_KEY   必填，百炼密钥，只存在这里，前端永不接触
//   DASHSCOPE_MODEL     选填，默认 qwen-vl-max
//   ALLOWED_ORIGINS     选填，逗号分隔的站点域名；未配置时只放行 localhost（开发用）
//
// 行为约定（PRD FR-401 / PLAN T15）：
//   未在白名单的 origin → 401；限流 20 次/分钟/IP → 429；≤ 2 张图；上游超时 25s；
//   返回体只有校验过的结构化字段，永不含原始模型输出。

'use strict'

const PHENOMENONS = ['stain', 'scratch', 'crack', 'chip', 'discolor', 'rust', 'hole', 'missing', 'deform', 'dirt']
const SURFACES = ['wall', 'floor', 'ceiling', 'door', 'window', 'furniture', 'appliance', 'fixture']
const SEVERITIES = ['light', 'moderate', 'severe']

const UPSTREAM_TIMEOUT_MS = 25000
const RATE_LIMIT = 20
const RATE_WINDOW_MS = 60000
const MAX_IMAGES = 2
const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const MAX_BODY_BYTES = 4 * 1024 * 1024
const MAX_OBSERVATIONS = 6
const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4173',
]
const UPSTREAM_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'

// PLAN.md §7 观察层提示词；裁切图输入版。
const SYSTEM_PROMPT = [
  '你是房屋状态记录的观察员，不是裁判。',
  '',
  '这两张图是同一处差异区域的裁切：第一张入住时，第二张退租时。',
  '只描述你能看见的差异。禁止判断"谁的责任""该不该赔""值多少钱"。',
  '',
  '对每一处差异输出：',
  '- bbox: [x1,y1,x2,y2] 归一化到 0-1',
  '- surface: wall|floor|ceiling|door|window|furniture|appliance|fixture',
  '- material: 你的猜测（不确定写 null）',
  '- phenomenon: stain|scratch|crack|chip|discolor|rust|hole|missing|deform|dirt',
  '- description: 一句中文，含尺寸估计、形状、边缘特征、颜色',
  '- severity: light|moderate|severe',
  '- cause_hypothesis: 可能的成因（"疑似…"），不确定写 null',
  '- confidence: 0-1',
  '- needs_rephoto: 如果裁切图看不清该处，为 true',
  '',
  '规则：',
  '1. 光照变化、角度差异、阴影、反光，不算差异。',
  '2. 看不清就说看不清，不要猜。',
  '3. 最多 6 条，按明显程度排序。',
  '4. 只输出 JSON：{"observations":[...]}',
].join('\n')

const USER_TEXT = '对比这两张裁切图，按系统规则输出 JSON。'

function parseAllowedOrigins(env) {
  const raw = (env && env.ALLOWED_ORIGINS) || ''
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return list.length > 0 ? list : DEFAULT_ORIGINS
}

// 无 Origin 头（同源/服务端调用）放行，但响应不带 CORS 头；有 Origin 则必须命中白名单。
function resolveOrigin(headers, env) {
  const origin = headers.origin
  if (!origin) return { present: false, allowed: true }
  const allowed = parseAllowedOrigins(env).includes(origin)
  return { present: true, allowed, origin }
}

// 滑窗限流：hits 是 Map<ip, number[]>，原地更新，返回是否放行。
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

const DATA_URL_RE = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/

function validateImages(images) {
  if (!Array.isArray(images) || images.length < 1 || images.length > MAX_IMAGES) return false
  for (const s of images) {
    if (typeof s !== 'string') return false
    const m = DATA_URL_RE.exec(s)
    if (!m) return false
    if (Buffer.byteLength(m[2], 'base64') > MAX_IMAGE_BYTES) return false
  }
  return true
}

// 模型可能包 ```json 围栏或夹话，取首尾大括号之间的内容再解析。
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

function inRange(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
}

function cappedString(v, max) {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s === '' ? null : s.slice(0, max)
}

// 逐条校验：任何字段不合法整条丢弃（FR-402），只保留白名单字段——原始文本出不去。
function sanitizeObservation(o) {
  if (!o || typeof o !== 'object') return null
  const bbox = o.bbox
  if (
    !Array.isArray(bbox) ||
    bbox.length !== 4 ||
    !bbox.every(inRange) ||
    !(bbox[0] < bbox[2]) ||
    !(bbox[1] < bbox[3])
  ) {
    return null
  }
  if (!PHENOMENONS.includes(o.phenomenon)) return null
  if (!SURFACES.includes(o.surface)) return null
  if (!SEVERITIES.includes(o.severity)) return null
  if (typeof o.description !== 'string' || o.description.trim() === '') return null
  if (!inRange(o.confidence)) return null
  return {
    bbox: [bbox[0], bbox[1], bbox[2], bbox[3]],
    surface: o.surface,
    material: cappedString(o.material, 40),
    phenomenon: o.phenomenon,
    description: o.description.trim().slice(0, 300),
    severity: o.severity,
    cause_hypothesis: cappedString(o.cause_hypothesis, 120),
    confidence: o.confidence,
    needs_rephoto: o.needs_rephoto === true,
  }
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
  if (Buffer.byteLength(body || '', 'utf8') > MAX_BODY_BYTES) {
    return json(413, { ok: false, reason: 'payload-too-large' }, origin.origin)
  }

  let images
  try {
    const parsed = JSON.parse(body || '')
    images = parsed && parsed.images
  } catch {
    images = null
  }
  if (!validateImages(images)) {
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
        model: env.DASHSCOPE_MODEL || 'qwen-vl-max',
        temperature: 0.1,
        max_tokens: 1024,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: USER_TEXT },
              ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
            ],
          },
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
  const raw = parsed && Array.isArray(parsed.observations) ? parsed.observations : []
  const observations = raw
    .map(sanitizeObservation)
    .filter(Boolean)
    .slice(0, MAX_OBSERVATIONS)
  return json(200, { ok: true, observations }, origin.origin)
}

// —— FC 自定义运行时装配 ——

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
exports.sanitizeObservation = sanitizeObservation
exports.extractJson = extractJson
exports.rateLimit = rateLimit
exports.SYSTEM_PROMPT = SYSTEM_PROMPT
