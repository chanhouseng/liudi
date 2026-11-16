import { afterEach, beforeEach, expect, vi } from 'vitest'
import { describe, it } from 'vitest'

import { extractConfigured, requestExtract } from './extract'

function okBody(items: unknown[]) {
  return new Response(JSON.stringify({ ok: true, items }), { status: 200 })
}

beforeEach(() => {
  vi.stubEnv('VITE_EXTRACT_API', 'https://fc.test')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('requestExtract', () => {
  it('正常返回：label + 整数分，只调一次', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okBody([
        { label: '墙面重刷', amountFen: 140_000 },
        { label: '保洁', amountFen: 60_000 },
      ]),
    )
    vi.stubGlobal('fetch', fetchMock)
    const items = await requestExtract('墙面重刷 1400，保洁 600')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(items).not.toBeNull()
    expect(items).toHaveLength(2)
    expect(items?.[0]).toEqual({ label: '墙面重刷', amountFen: 140_000 })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://fc.test/api/extract')
    expect(JSON.parse(init.body as string).text).toContain('保洁 600')
  })

  it('坏条目被丢弃，好的留下', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okBody([
        { label: '', amountFen: 100 },
        { label: '墙面', amountFen: 1.5 },
        { label: '保洁', amountFen: -5 },
        { label: '门锁', amountFen: 40_000 },
      ]),
    )
    vi.stubGlobal('fetch', fetchMock)
    const items = await requestExtract('x')
    expect(items).toEqual([{ label: '门锁', amountFen: 40_000 }])
  })

  it('全部坏 / FC 给空 → 空数组（调用方回退）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okBody([])))
    expect(await requestExtract('x')).toEqual([])
  })

  it('信封不合 schema → null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false }), { status: 200 })),
    )
    expect(await requestExtract('x')).toBeNull()
  })

  it('502 重试 1 次后成功', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 502 }))
      .mockResolvedValueOnce(okBody([{ label: '门锁', amountFen: 40_000 }]))
    vi.stubGlobal('fetch', fetchMock)
    const items = await requestExtract('x')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(items).not.toBeNull()
  })

  it('两次都 502 → null；400 不重试', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 502 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await requestExtract('x')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const fetch400 = vi.fn().mockResolvedValue(new Response('', { status: 400 }))
    vi.stubGlobal('fetch', fetch400)
    expect(await requestExtract('x')).toBeNull()
    expect(fetch400).toHaveBeenCalledTimes(1)
  })

  it('外层 signal 中止 → 立即放弃', async () => {
    const fetchMock = vi.fn(
      () =>
        new Promise((_resolve, reject) => {
          const e = new Error('aborted')
          e.name = 'AbortError'
          reject(e)
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const ac = new AbortController()
    ac.abort()
    expect(await requestExtract('x', ac.signal)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('未配置端点 → 直接 null，不发请求', async () => {
    vi.stubEnv('VITE_EXTRACT_API', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(extractConfigured()).toBe(false)
    expect(await requestExtract('x')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
