// lib/api/wording 单测：信封校验、重试、降级 null、房东法条白名单。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { landlordLawOk, polishSection, requestLandlordReply, wordingConfigured } from './wording'

function okBody(payload: Record<string, unknown>) {
  return new Response(JSON.stringify({ ok: true, ...payload }), { status: 200 })
}

beforeEach(() => {
  vi.stubEnv('VITE_WORDING_API', 'https://fc.test')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('polishSection', () => {
  it('正常返回文本，POST /api/wording，body 带 task=polish', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okBody({ task: 'polish', text: '改写后的说明段。' }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await polishSection({ section: '原文', facts: ['押金 ¥4,000'], tone: 'neutral' })
    expect(out).toBe('改写后的说明段。')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://fc.test/api/wording')
    const body = JSON.parse(init.body as string)
    expect(body.task).toBe('polish')
    expect(body.tone).toBe('neutral')
  })

  it('信封不合 schema → null；未配置端点 → null 不发请求', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okBody({ task: 'polish', text: '' })))
    expect(await polishSection({ section: 'x', facts: [], tone: 'firm' })).toBeNull()

    vi.stubEnv('VITE_WORDING_API', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await polishSection({ section: 'x', facts: [], tone: 'firm' })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('502 重试 1 次；两次都失败 → null', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 502 }))
      .mockResolvedValueOnce(okBody({ task: 'polish', text: '好了。' }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await polishSection({ section: 'x', facts: [], tone: 'polite' })).toBe('好了。')
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const always = vi.fn().mockResolvedValue(new Response('', { status: 502 }))
    vi.stubGlobal('fetch', always)
    expect(await polishSection({ section: 'x', facts: [], tone: 'polite' })).toBeNull()
    expect(always).toHaveBeenCalledTimes(2)
  })
})

describe('requestLandlordReply', () => {
  const req = {
    persona: 'pressure' as const,
    round: 1,
    letterExcerpt: '合理扣款 ¥128。',
    history: [],
    tenantText: '这处是入住就有的。',
  }

  it('正常返回 reply/flaw/stance', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okBody({ task: 'landlord', reply: '印子就得整面刷。', flaw: '你只谈这处，没否认整面脏。', stance: 'hold' }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const out = await requestLandlordReply(req)
    expect(out).toEqual({ reply: '印子就得整面刷。', flaw: '你只谈这处，没否认整面脏。', stance: 'hold' })
  })

  it('回复引用编造法条 → 拒收返回 null（S16 校验在客户端兜底）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okBody({ task: 'landlord', reply: '《物权法》第 99 条说了，我扣你有理。', flaw: '', stance: 'hold' }),
      ),
    )
    expect(await requestLandlordReply(req)).toBeNull()
  })

  it('信封坏 → null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okBody({ task: 'landlord', reply: '' })))
    expect(await requestLandlordReply(req)).toBeNull()
  })
})

describe('landlordLawOk', () => {
  it('真实法条放行（含《住房租赁条例》第 10 条带施行日期后缀）', () => {
    expect(landlordLawOk('《民法典》第 710 条不是你说的意思。')).toBe(true)
    expect(landlordLawOk('《住房租赁条例》第 10 条你自己看。')).toBe(true)
    expect(landlordLawOk('合同说了算，别拿法律吓我。')).toBe(true)
  })

  it('编造法条 / 真实法号但错法名 → 拒绝', () => {
    expect(landlordLawOk('《物权法》第 99 条说了算。')).toBe(false)
    expect(landlordLawOk('《民法典》第 999 条你得赔。')).toBe(false)
  })
})

describe('wordingConfigured', () => {
  it('跟随 VITE_WORDING_API', () => {
    expect(wordingConfigured()).toBe(true)
    vi.stubEnv('VITE_WORDING_API', '')
    expect(wordingConfigured()).toBe(false)
  })
})
