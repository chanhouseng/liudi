// functions/vision 的 node:test 单测：handleRequest 是纯逻辑，fetch 用注入替身。
'use strict'

const test = require('node:test')
const assert = require('node:assert')

const {
  handleRequest,
  sanitizeObservation,
  extractJson,
  rateLimit,
  SYSTEM_PROMPT,
} = require('./index.js')

const ENV = { DASHSCOPE_API_KEY: 'sk-test', ALLOWED_ORIGINS: 'https://liudi.example.com' }
const OK_ORIGIN = 'https://liudi.example.com'
const IMG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

function deps(fetchImpl, now) {
  return { hits: new Map(), fetchImpl, now: now || (() => 1_000_000) }
}

function req(overrides = {}) {
  return {
    method: 'POST',
    headers: { origin: OK_ORIGIN, 'x-forwarded-for': '1.2.3.4', ...overrides.headers },
    body: JSON.stringify({ images: [IMG, IMG] }),
    env: ENV,
    ...overrides,
  }
}

function upstreamReply(content, ok = true) {
  return async () => ({
    ok,
    json: async () => ({ choices: [{ message: { content } }] }),
  })
}

const VALID_OBS = {
  bbox: [0.1, 0.2, 0.6, 0.7],
  surface: 'wall',
  material: '乳胶漆',
  phenomenon: 'stain',
  description: '约 12×8cm 泛黄污渍，边缘不规则扩散。',
  severity: 'moderate',
  cause_hypothesis: '疑似渗水后干燥',
  confidence: 0.8,
  needs_rephoto: false,
}

test('OPTIONS 预检：白名单 origin 返回 204 + CORS 头', async () => {
  const out = await handleRequest({ method: 'OPTIONS', headers: { origin: OK_ORIGIN }, body: '', env: ENV }, deps())
  assert.equal(out.status, 204)
  assert.equal(out.headers['Access-Control-Allow-Origin'], OK_ORIGIN)
  assert.ok(out.headers['Access-Control-Allow-Methods'].includes('POST'))
})

test('非白名单 origin → 401', async () => {
  const out = await handleRequest(req({ headers: { origin: 'https://evil.example' } }), deps())
  assert.equal(out.status, 401)
  assert.deepEqual(JSON.parse(out.body), { ok: false, reason: 'unauthorized' })
})

test('非 POST 方法 → 405', async () => {
  const out = await handleRequest({ method: 'GET', headers: { origin: OK_ORIGIN }, body: '', env: ENV }, deps())
  assert.equal(out.status, 405)
})

test('限流：同 IP 第 21 次 → 429，隔窗后恢复', async () => {
  const hits = new Map()
  let t = 0
  const d = { hits, now: () => t, fetchImpl: upstreamReply(JSON.stringify({ observations: [VALID_OBS] })) }
  for (let i = 0; i < 20; i++) {
    const out = await handleRequest(req(), d)
    assert.equal(out.status, 200)
  }
  const blocked = await handleRequest(req(), d)
  assert.equal(blocked.status, 429)
  t = 80_000
  const ok = await handleRequest(req(), d)
  assert.equal(ok.status, 200)
})

test('限流按 IP 隔离', async () => {
  const d = deps(upstreamReply(JSON.stringify({ observations: [VALID_OBS] })))
  for (let i = 0; i < 20; i++) await handleRequest(req(), d)
  const other = await handleRequest(req({ headers: { origin: OK_ORIGIN, 'x-forwarded-for': '5.6.7.8' } }), d)
  assert.equal(other.status, 200)
})

test('body：3 张图 / 坏 dataURL / 非 JSON → 400', async () => {
  for (const bad of [
    JSON.stringify({ images: [IMG, IMG, IMG] }),
    JSON.stringify({ images: ['http://x/y.jpg'] }),
    'not-json',
    JSON.stringify({ images: [] }),
  ]) {
    const out = await handleRequest(req({ body: bad }), deps())
    assert.equal(out.status, 400, bad)
  }
})

test('缺密钥 → 500，密钥只从 env 取', async () => {
  const out = await handleRequest(req({ env: { ALLOWED_ORIGINS: OK_ORIGIN } }), deps())
  assert.equal(out.status, 500)
  assert.equal(JSON.parse(out.body).reason, 'server-misconfigured')
})

test('正常链路：围栏 JSON 混入坏条目 → 只留合法条，字段白名单', async () => {
  const content = '```json\n' + JSON.stringify({ observations: [VALID_OBS, { phenomenon: 'stain', surface: 'wall', severity: 'light', description: '缺 bbox 和 confidence' }] }) + '\n```'
  const seen = {}
  const out = await handleRequest(req(), deps(async (url, init) => {
    seen.url = url
    seen.auth = init.headers.Authorization
    seen.images = JSON.parse(init.body).messages[1].content.filter((p) => p.type === 'image_url').length
    return upstreamReply(content)()
  }))
  assert.equal(out.status, 200)
  const parsed = JSON.parse(out.body)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.observations.length, 1)
  assert.equal(seen.auth, 'Bearer sk-test')
  assert.equal(seen.images, 2)
  assert.ok(seen.url.includes('dashscope'))
  assert.deepEqual(Object.keys(parsed.observations[0]).sort(), [
    'bbox', 'cause_hypothesis', 'confidence', 'description',
    'material', 'needs_rephoto', 'phenomenon', 'severity', 'surface',
  ])
  assert.equal(parsed.observations[0].description, VALID_OBS.description)
  assert.ok(!out.body.includes('raw'))
})

test('系统提示词含"不是裁判"与禁判责约束', () => {
  assert.ok(SYSTEM_PROMPT.includes('不是裁判'))
  assert.ok(SYSTEM_PROMPT.includes('禁止判断'))
})

test('上游 5xx → 502；上游超时 → 504；返回体不含模型文本', async () => {
  const bad = await handleRequest(req(), deps(upstreamReply('x', false)))
  assert.equal(bad.status, 502)
  const hang = async () => new Promise((_, reject) => {
    const e = new Error('The operation was aborted')
    e.name = 'AbortError'
    reject(e)
  })
  const timeout = await handleRequest(req(), deps(hang))
  assert.equal(timeout.status, 504)
})

test('observations 超 6 条截断；模型没吐 JSON → 空 observations', async () => {
  const many = Array.from({ length: 9 }, () => VALID_OBS)
  const out = await handleRequest(req(), deps(upstreamReply(JSON.stringify({ observations: many }))))
  assert.equal(JSON.parse(out.body).observations.length, 6)
  const junk = await handleRequest(req(), deps(upstreamReply('我觉得房东应该赔偿全部损失')))
  const parsed = JSON.parse(junk.body)
  assert.deepEqual(parsed.observations, [])
})

test('extractJson 容忍围栏与前后夹话', () => {
  assert.deepEqual(extractJson('好的{"a":1}请查收'), { a: 1 })
  assert.deepEqual(extractJson('```json\n{"a":[1,2]}\n```'), { a: [1, 2] })
  assert.equal(extractJson('完全没有'), null)
})

test('sanitizeObservation 拒绝：bbox 越界 / confidence 出界 / 脏 phenomenon', () => {
  assert.equal(sanitizeObservation({ ...VALID_OBS, bbox: [-0.1, 0, 0.5, 0.5] }), null)
  assert.equal(sanitizeObservation({ ...VALID_OBS, confidence: 1.5 }), null)
  assert.equal(sanitizeObservation({ ...VALID_OBS, phenomenon: 'responsibility' }), null)
  assert.equal(sanitizeObservation({ ...VALID_OBS, severity: 'extreme' }), null)
  assert.equal(sanitizeObservation({ ...VALID_OBS, description: '  ' }), null)
  const ok = sanitizeObservation({ ...VALID_OBS, material: undefined, needs_rephoto: true })
  assert.equal(ok.material, null)
  assert.equal(ok.needs_rephoto, true)
})

test('rateLimit：窗口内滑出旧时间戳', () => {
  const hits = new Map()
  let t = 1000
  for (let i = 0; i < 20; i++) assert.equal(rateLimit(hits, 'a', t + i * 1000), true)
  assert.equal(rateLimit(hits, 'a', t + 21 * 1000), false)
  t = 1000 + 61_000
  assert.equal(rateLimit(hits, 'a', t), true)
})
