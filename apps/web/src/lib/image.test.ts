import { afterEach, describe, expect, it, vi } from 'vitest'

import { FINGERPRINT_ERROR, processImage } from './image'

describe('BUG-07 指纹守卫', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('拿不到 crypto.subtle 时抛错，绝不返回空哈希', async () => {
    vi.stubGlobal('crypto', { subtle: undefined })
    await expect(processImage(new Blob(['x']))).rejects.toThrow(FINGERPRINT_ERROR)
  })

  it('subtle 可用时守卫放行（Node 里后续解码会因缺 canvas 失败，但错误不该是指纹错误）', async () => {
    const err = await processImage(new Blob(['x'])).then(
      () => null,
      (e: unknown) => e as Error,
    )
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).not.toBe(FINGERPRINT_ERROR)
  })
})
