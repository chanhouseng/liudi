// T20 /api/extract 客户端：正则拆解失败或不一致时才调用（FR-502）。
// 返回 null 表示「AI 未能识别」，调用方回退正则结果或转手动添加，流程不断。

import { z } from 'zod'

const itemSchema = z.object({
  label: z.string().min(1).max(60),
  amountFen: z.number().int().min(1).max(100_000_000),
})

const envelopeSchema = z.object({
  ok: z.literal(true),
  items: z.array(z.unknown()).max(24),
})

export interface ExtractedDeduction {
  label: string
  amountFen: number
}

const TIMEOUT_MS = 25000
const ATTEMPTS = 2

// FC 端点部署后才确定；函数读保持可测（vi.stubEnv 可注入）。
const apiBase = (): string => import.meta.env.VITE_EXTRACT_API ?? ''

export function extractConfigured(): boolean {
  return apiBase() !== ''
}

class ExtractHttpError extends Error {
  constructor(readonly status: number) {
    super(`extract-http-${status}`)
  }
}

async function postOnce(base: string, text: string, signal: AbortSignal): Promise<unknown[]> {
  const res = await fetch(`${base}/api/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal,
  })
  if (!res.ok) throw new ExtractHttpError(res.status)
  const parsed = envelopeSchema.safeParse(await res.json())
  if (!parsed.success) throw new Error('extract-schema')
  return parsed.data.items
}

// 失败重试 1 次：网络错误 / 5xx / 429 / 超时可重试；其余 4xx 不重试。
// 任何失败都返回 null，不抛——降级是常态路径，不是异常。
export async function requestExtract(
  text: string,
  signal?: AbortSignal,
): Promise<ExtractedDeduction[] | null> {
  const base = apiBase()
  if (!base) return null
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const onOuterAbort = () => controller.abort()
    signal?.addEventListener('abort', onOuterAbort)
    try {
      const raw = await postOnce(base, text, controller.signal)
      const valid = raw
        .map((o) => itemSchema.safeParse(o))
        .filter((p) => p.success)
        .map((p) => p.data)
      return valid
    } catch (err) {
      const status = err instanceof ExtractHttpError ? err.status : undefined
      const retryable = status === undefined || status === 429 || status >= 500
      if (!retryable || attempt === ATTEMPTS - 1 || signal?.aborted) return null
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onOuterAbort)
    }
  }
  return null
}
