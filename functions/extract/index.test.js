// functions/extract 的 node:test 单测：handleRequest 纯逻辑，fetch 注入替身。
'use strict'

const test = require('node:test')
const assert = require('node:assert')

const {
  handleRequest,
  sanitizeItem,
  extractJson,
  rateLimit,
  SYSTEM_PROMPT,
} = require('./index.js')

const ENV = { DASHSCOPE_API_KEY: 'sk-test', ALLOWED_ORIGINS: 'https://liudi.example.com' }
const OK_ORIGIN = 'https://liudi.example.com'
const DEMO_TEXT = '1. 墙面重刷 1400\n2. 保洁 600\n一共 3200'

function deps(fetchImpl, now) {
  return { hits: new Map(), fetchImpl, now: now || (() => 1_000_000) }
}

function req(overrides = {}) {
  return {
    method: 'POST',
    headers: { origin: OK_ORIGIN, 'x-forwarded-for': '1.2.3.4', ...overrides.headers },
    body: JSON.stringify({ text: DEMO_TEXT }),
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

test('OPTIONS 预检：白名单 origin 返回 204 + CORS 头', async () => {
  const out = await handleRequest({ method: 'OPTIONS', headers: { origin: OK_ORIGIN }, body: '', env: ENV }, deps())
  assert.equal(out.status, 204)
  assert.equal(out.headers['Access-Control-Allow-Origin'], OK_ORIGIN)
})

test('非白名单 origin → 401；非 POST → 405', async () => {
  const denied = await handleRequest(req({ headers: { origin: 'https://evil.example' } }), deps())
  assert.equal(denied.status, 401)
  const get = await handleRequest({ method: 'GET', headers: { origin: OK_ORIGIN }, body: '', env: ENV }, deps())
  assert.equal(get.status, 405)
})

test('限流 20/分钟/IP，按 IP 隔离', async () => {
  const d = deps(upstreamReply(JSON.stringify({ items: [] })))
  for (let i = 0; i < 20; i++) await handleRequest(req(), d)
  const blocked = await handleRequest(req(), d)
  assert.equal(blocked.status, 429)
  const other = await handleRequest(req({ headers: { origin: OK_ORIGIN, 'x-forwarded-for': '5.6.7.8' } }), d)
  assert.equal(other.status, 200)
})

test('body：缺 text / 空 text / 超 2000 字 / 非 JSON → 400', async () => {
  for (const bad of [
    JSON.stringify({}),
    JSON.stringify({ text: '   ' }),
    JSON.stringify({ text: '墙'.repeat(2001) }),
    'not-json',
  ]) {
    const out = await handleRequest(req({ body: bad }), deps())
    assert.equal(out.status, 400, bad)
  }
})

test('缺密钥 → 500', async () => {
  const out = await handleRequest(req({ env: { ALLOWED_ORIGINS: OK_ORIGIN } }), deps())
  assert.equal(out.status, 500)
  assert.equal(JSON.parse(out.body).reason, 'server-misconfigured')
})

test('正常链路：条目换算成整数分，字段白名单，不带原始输出', async () => {
  const content = '```json\n' + JSON.stringify({
    items: [
      { label: '墙面重刷', amount: 1400 },
      { label: '保洁', amount: 600.4 },
      { label: '', amount: 100 },
      { label: '坏条目' },
      { label: '负数', amount: -5 },
    ],
  }) + '\n```'
  const seen = {}
  const out = await handleRequest(req(), deps(async (url, init) => {
    seen.url = url
    seen.auth = init.headers.Authorization
    seen.model = JSON.parse(init.body).model
    seen.userText = JSON.parse(init.body).messages[1].content
    return upstreamReply(content)()
  }))
  assert.equal(out.status, 200)
  const parsed = JSON.parse(out.body)
  assert.equal(parsed.ok, true)
  assert.deepEqual(parsed.items, [
    { label: '墙面重刷', amountFen: 140_000 },
    { label: '保洁', amountFen: 60_040 },
  ])
  assert.equal(seen.model, 'qwen-plus')
  assert.ok(seen.userText.includes(DEMO_TEXT))
  assert.equal(seen.auth, 'Bearer sk-test')
  assert.ok(seen.url.includes('dashscope'))
  assert.ok(!out.body.includes('content'))
})

test('系统提示词禁判责、禁总数条目', () => {
  assert.ok(SYSTEM_PROMPT.includes('禁止判断责任'))
  assert.ok(SYSTEM_PROMPT.includes('不要输出'))
})

test('上游 5xx → 502；上游超时 → 504', async () => {
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

test('模型没吐 JSON → 空 items；超 20 条截断', async () => {
  const junk = await handleRequest(req(), deps(upstreamReply('这段没看懂，无法拆解')))
  assert.deepEqual(JSON.parse(junk.body).items, [])
  const many = Array.from({ length: 25 }, (_, n) => ({ label: `项目${n}`, amount: 100 + n }))
  const capped = await handleRequest(req(), deps(upstreamReply(JSON.stringify({ items: many }))))
  assert.equal(JSON.parse(capped.body).items.length, 20)
})

test('sanitizeItem：label 空/超长、金额出界拒绝；amountFen 为整数分', () => {
  assert.equal(sanitizeItem({ label: '  ', amount: 100 }), null)
  assert.equal(sanitizeItem({ label: '墙面', amount: 0 }), null)
  assert.equal(sanitizeItem({ label: '墙面', amount: 999_999_999 }), null)
  const ok = sanitizeItem({ label: 'x'.repeat(80), amount: 600.45 })
  assert.equal(ok.label.length, 60)
  assert.equal(ok.amountFen, 60_045)
  assert.ok(Number.isInteger(ok.amountFen))
})

test('extractJson 容忍围栏与夹话；rateLimit 滑窗', () => {
  assert.deepEqual(extractJson('好的{"a":1}请查收'), { a: 1 })
  assert.equal(extractJson('完全没有'), null)
  const hits = new Map()
  let t = 1000
  for (let i = 0; i < 20; i++) assert.equal(rateLimit(hits, 'a', t + i * 1000), true)
  assert.equal(rateLimit(hits, 'a', t + 21 * 1000), false)
})
