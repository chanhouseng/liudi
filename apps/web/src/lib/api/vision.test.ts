import { afterEach, beforeEach, expect, vi } from 'vitest'
import { describe, it } from 'vitest'

import { isDirtyText, requestRegionAi, visionConfigured } from './vision'

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

function okBody(observations: unknown[]) {
  return new Response(JSON.stringify({ ok: true, observations }), { status: 200 })
}

beforeEach(() => {
  vi.stubEnv('VITE_VISION_API', 'https://fc.test')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('requestRegionAi', () => {
  it('正常返回：映射 RegionAi 字段，只调一次', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okBody([VALID_OBS]))
    vi.stubGlobal('fetch', fetchMock)
    const ai = await requestRegionAi('a', 'b')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(ai).not.toBeNull()
    expect(ai?.phenomenon).toBe('stain')
    expect(ai?.severity).toBe('moderate')
    expect(ai?.description).toContain('泛黄污渍')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://fc.test/api/vision')
    expect(JSON.stringify(JSON.parse(init.body as string))).toContain('"images":["a","b"]')
  })

  it('脏条目被丢弃：判责措辞不算观察', async () => {
    const dirty = {
      ...VALID_OBS,
      description: '墙皮脱落，房东责任，应当赔偿全部损失。',
    }
    const fetchMock = vi.fn().mockResolvedValue(okBody([dirty, VALID_OBS]))
    vi.stubGlobal('fetch', fetchMock)
    const ai = await requestRegionAi('a', 'b')
    expect(ai?.description).toContain('泛黄污渍')
  })

  it('全部是脏数据 → null（不编造结果）', async () => {
    const dirty = { ...VALID_OBS, cause_hypothesis: '房东责任' }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okBody([dirty])))
    expect(await requestRegionAi('a', 'b')).toBeNull()
  })

  it('字段缺失 / bbox 越界的那条被丢弃，好的留下', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okBody([
        { ...VALID_OBS, confidence: 1.7 },
        { ...VALID_OBS, bbox: [0, 0, 0, 0] },
        { ...VALID_OBS, phenomenon: 'responsibility' },
        VALID_OBS,
      ]),
    )
    vi.stubGlobal('fetch', fetchMock)
    const ai = await requestRegionAi('a', 'b')
    expect(ai?.description).toContain('泛黄污渍')
  })

  it('模型没吐 JSON（FC 给空）→ null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okBody([])))
    expect(await requestRegionAi('a', 'b')).toBeNull()
  })

  it('502 重试 1 次后成功', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 502 }))
      .mockResolvedValueOnce(okBody([VALID_OBS]))
    vi.stubGlobal('fetch', fetchMock)
    const ai = await requestRegionAi('a', 'b')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(ai?.phenomenon).toBe('stain')
  })

  it('两次都 502 → null', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 502 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await requestRegionAi('a', 'b')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('400 不重试', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 400 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await requestRegionAi('a', 'b')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
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
    expect(await requestRegionAi('a', 'b', ac.signal)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('未配置端点 → 直接 null，不发请求', async () => {
    vi.stubEnv('VITE_VISION_API', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(visionConfigured()).toBe(false)
    expect(await requestRegionAi('a', 'b')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('isDirtyText', () => {
  it('命中判责措辞', () => {
    expect(isDirtyText('房东应当赔偿 500 元')).toBe(true)
    expect(isDirtyText('这是租客责任')).toBe(true)
  })
  it('正常观察不误伤', () => {
    expect(isDirtyText('约 12×8cm 泛黄污渍，边缘不规则扩散，疑似渗水后干燥')).toBe(false)
  })
})
