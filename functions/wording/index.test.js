// functions/wording 的 node:test 单测：handleRequest 纯逻辑，fetch 注入替身。
'use strict'

const test = require('node:test')
const assert = require('node:assert')

const {
  handleRequest,
  sanitizePolish,
  sanitizeLandlord,
  validatePolish,
  validateLandlord,
  extractJson,
  rateLimit,
  POLISH_SYSTEM_PROMPT,
  LANDLORD_SYSTEM_PROMPT,
} = require('./index.js')

const ENV = { DASHSCOPE_API_KEY: 'sk-test', ALLOWED_ORIGINS: 'https://liudi.example.com' }
const OK_ORIGIN = 'https://liudi.example.com'

function deps(fetchImpl, now) {
  return { hits: new Map(), fetchImpl, now: now || (() => 1_000_000) }
}

function req(overrides = {}) {
  return {
    method: 'POST',
    headers: { origin: OK_ORIGIN, 'x-forwarded-for': '1.2.3.4', ...overrides.headers },
    body: JSON.stringify({ task: 'polish', section: '房子已腾空。', facts: ['押金 ¥4,000'], tone: 'neutral' }),
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

test('polish：正常链路只回说明段文本，不带原始输出', async () => {
  const seen = {}
  const out = await handleRequest(req(), deps(async (url, init) => {
    seen.url = url
    seen.auth = init.headers.Authorization
    const sent = JSON.parse(init.body)
    seen.model = sent.model
    seen.system = sent.messages[0].content
    seen.user = sent.messages[1].content
    return upstreamReply('房子已按约定腾空，退租照片都在。押金的事想跟您逐项对一遍。')()
  }))
  assert.equal(out.status, 200)
  const parsed = JSON.parse(out.body)
  assert.deepEqual(parsed, {
    ok: true,
    task: 'polish',
    text: '房子已按约定腾空，退租照片都在。押金的事想跟您逐项对一遍。',
  })
  assert.equal(seen.model, 'qwen-plus')
  assert.ok(seen.user.includes('房子已腾空'))
  assert.ok(seen.user.includes('押金 ¥4,000'))
  assert.equal(seen.auth, 'Bearer sk-test')
  assert.ok(seen.url.includes('dashscope'))
  assert.ok(!out.body.includes('choices'))
})

test('polish：非法 body（缺 section / task 缺失 / 超 2000 字 / 非 JSON）→ 400', async () => {
  for (const bad of [
    JSON.stringify({ task: 'polish' }),
    JSON.stringify({ task: 'polish', section: '   ' }),
    JSON.stringify({ task: 'polish', section: '墙'.repeat(2001) }),
    JSON.stringify({ section: '没有 task' }),
    'not-json',
  ]) {
    const out = await handleRequest(req({ body: bad }), deps())
    assert.equal(out.status, 400, bad)
  }
})

test('polish：facts 截断到 12 条、每条 120 字；tone 非法回退 neutral', async () => {
  const body = {
    task: 'polish',
    section: '原文',
    tone: 'angry',
    facts: Array.from({ length: 20 }, (_, n) => `事实${n}`.padEnd(130, '字')),
  }
  const seen = {}
  const out = await handleRequest(req({ body: JSON.stringify(body) }), deps(async (_url, init) => {
    seen.user = JSON.parse(init.body).messages[1].content
    return upstreamReply('改写后的说明段。')()
  }))
  assert.equal(out.status, 200)
  assert.ok(seen.user.includes('事实11'))
  assert.ok(!seen.user.includes('事实12'))
  assert.ok(!seen.user.includes('字'.repeat(121)))
})

test('landlord：返回 {reply, flaw, stance}，不带原始输出', async () => {
  const content = '前言\n' + JSON.stringify({
    reply: '墙上这些印子我得整面重刷，1500 不多吧？',
    flaw: '你接受了整面墙的说法',
    stance: 'concede',
  }) + '\n后记'
  const seen = {}
  const body = {
    task: 'landlord',
    persona: 'pressure',
    round: 1,
    letterExcerpt: '合理扣款 ¥380，请返还押金 ¥3,620。',
    history: [{ role: 'landlord', text: '墙上有印子，1500。' }],
    tenantText: '有底稿照片，这处是入住就有的。',
  }
  const out = await handleRequest(req({ body: JSON.stringify(body) }), deps(async (_url, init) => {
    const sent = JSON.parse(init.body)
    seen.system = sent.messages[0].content
    seen.user = sent.messages[1].content
    return upstreamReply(content)()
  }))
  assert.equal(out.status, 200)
  const parsed = JSON.parse(out.body)
  assert.deepEqual(parsed, {
    ok: true,
    task: 'landlord',
    reply: '墙上这些印子我得整面重刷，1500 不多吧？',
    flaw: '你接受了整面墙的说法',
    stance: 'concede',
  })
  assert.ok(seen.user.includes('1500 不多吧？') || seen.user.includes('¥3,620'))
  assert.ok(seen.user.includes('有底稿照片'))
  assert.ok(seen.system.includes('pressure'))
  assert.ok(!out.body.includes('choices'))
})

test('landlord：非法 body（persona/round/history 越界）→ 400', async () => {
  for (const bad of [
    JSON.stringify({ task: 'landlord', persona: 'angry', round: 1, letterExcerpt: 'x', history: [], tenantText: 'y' }),
    JSON.stringify({ task: 'landlord', persona: 'pressure', round: 4, letterExcerpt: 'x', history: [], tenantText: 'y' }),
    JSON.stringify({ task: 'landlord', persona: 'pressure', round: 1, letterExcerpt: 'x', history: 'no', tenantText: 'y' }),
    JSON.stringify({ task: 'landlord', persona: 'pressure', round: 1, letterExcerpt: 'x', history: [], tenantText: '  ' }),
    JSON.stringify({ task: 'landlord', persona: 'pressure', round: 1, letterExcerpt: 'x', history: [{ role: 'boss', text: 'a' }], tenantText: 'y' }),
  ]) {
    const out = await handleRequest(req({ body: bad }), deps())
    assert.equal(out.status, 400, bad)
  }
})

test('landlord：模型没吐 JSON → 502；stance 非法回退 hold', async () => {
  const junk = await handleRequest(req({ body: JSON.stringify({ task: 'landlord', persona: 'stall', round: 2, letterExcerpt: '信', history: [], tenantText: '你说的不对。' }) }), deps(upstreamReply('我不同意，没得谈。')))
  assert.equal(junk.status, 502)
  const lax = await handleRequest(req({ body: JSON.stringify({ task: 'landlord', persona: 'stall', round: 2, letterExcerpt: '信', history: [], tenantText: '你说的不对。' }) }), deps(upstreamReply(JSON.stringify({ reply: '合同写了保持原样。', flaw: '', stance: 'whatever' }))))
  assert.equal(lax.status, 200)
  assert.equal(JSON.parse(lax.body).stance, 'hold')
})

test('缺密钥 → 500；上游 5xx → 502；上游超时 → 504', async () => {
  const nokey = await handleRequest(req({ env: { ALLOWED_ORIGINS: OK_ORIGIN } }), deps())
  assert.equal(nokey.status, 500)
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

test('提示词约束：polish 禁新增数字；landlord 禁法条、禁人身攻击、限 JSON', () => {
  assert.ok(POLISH_SYSTEM_PROMPT.includes('180 字'))
  assert.ok(POLISH_SYSTEM_PROMPT.includes('禁止新增任何数字'))
  assert.ok(POLISH_SYSTEM_PROMPT.includes('禁止出现「保证」'))
  assert.ok(LANDLORD_SYSTEM_PROMPT.includes('禁止引用任何法条'))
  assert.ok(LANDLORD_SYSTEM_PROMPT.includes('禁止人身攻击'))
  assert.ok(LANDLORD_SYSTEM_PROMPT.includes('"stance"'))
})

test('sanitizePolish / sanitizeLandlord：截断与拒绝', () => {
  assert.equal(sanitizePolish('   '), null)
  assert.equal(sanitizePolish(42), null)
  assert.equal(sanitizePolish('好'.repeat(500)).length, 400)
  assert.equal(sanitizeLandlord({ reply: '  ', flaw: 'x', stance: 'hold' }), null)
  const out = sanitizeLandlord({ reply: 'r'.repeat(700), flaw: 'f'.repeat(200), stance: 'shift' })
  assert.equal(out.reply.length, 600)
  assert.equal(out.flaw.length, 120)
  assert.equal(out.stance, 'shift')
  assert.equal(sanitizeLandlord(null), null)
})

test('validatePolish / validateLandlord：字段白名单与截断', () => {
  const p = validatePolish({ task: 'polish', section: '原文', tone: 'firm', facts: [] })
  assert.equal(p.task, 'polish')
  assert.equal(p.tone, 'firm')
  assert.equal(validatePolish({ task: 'polish', section: '' }), null)
  assert.equal(validatePolish({ task: 'extract', section: 'x' }), null)
  const l = validateLandlord({ task: 'landlord', persona: 'reasonable', round: 3, letterExcerpt: '信', history: [], tenantText: '各退一步？' })
  assert.deepEqual(l, { persona: 'reasonable', round: 3, letterExcerpt: '信', history: [], tenantText: '各退一步？' })
  assert.equal(validateLandlord({ task: 'landlord', persona: 'reasonable', round: 0, letterExcerpt: '信', history: [], tenantText: 'x' }), null)
})

test('extractJson 容忍围栏与夹话；rateLimit 滑窗', () => {
  assert.deepEqual(extractJson('好的{"a":1}请查收'), { a: 1 })
  assert.equal(extractJson('完全没有'), null)
  const hits = new Map()
  let t = 1000
  for (let i = 0; i < 20; i++) assert.equal(rateLimit(hits, 'a', t + i * 1000), true)
  assert.equal(rateLimit(hits, 'a', t + 21 * 1000), false)
})
