// T24/T25 /api/wording 客户端：信件说明段润色（polish）与房东模拟（landlord）。
// 模式与 lib/api/extract 一致：zod 留在本懒加载块、25s 超时、重试 1 次、任何失败返回 null。
import { LEGAL_REFS } from '@/content/legal'
import { z } from 'zod'

const TIMEOUT_MS = 25000
const ATTEMPTS = 2

// FC 端点部署后才确定；函数读保持可测（vi.stubEnv 可注入）。
const apiBase = (): string => import.meta.env.VITE_WORDING_API ?? ''

export function wordingConfigured(): boolean {
  return apiBase() !== ''
}

class WordingHttpError extends Error {
  constructor(readonly status: number) {
    super(`wording-http-${status}`)
  }
}

async function postOnce<T>(base: string, body: unknown, envelope: z.ZodType<T>, signal: AbortSignal): Promise<T> {
  const res = await fetch(`${base}/api/wording`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw new WordingHttpError(res.status)
  const parsed = envelope.safeParse(await res.json())
  if (!parsed.success) throw new Error('wording-schema')
  return parsed.data
}

// 失败重试 1 次：网络错误 / 5xx / 429 / 超时可重试；其余 4xx 不重试。
// 任何失败都返回 null，不抛——降级是常态路径，不是异常。
async function postWithRetry<T>(body: unknown, envelope: z.ZodType<T>, signal?: AbortSignal): Promise<T | null> {
  const base = apiBase()
  if (!base) return null
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const onOuterAbort = () => controller.abort()
    signal?.addEventListener('abort', onOuterAbort)
    try {
      return await postOnce(base, body, envelope, controller.signal)
    } catch (err) {
      const status = err instanceof WordingHttpError ? err.status : undefined
      const retryable = status === undefined || status === 429 || status >= 500
      if (!retryable || attempt === ATTEMPTS - 1 || signal?.aborted) return null
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onOuterAbort)
    }
  }
  return null
}

export type Tone = 'polite' | 'neutral' | 'firm'

const polishEnvelope = z.object({
  ok: z.literal(true),
  task: z.literal('polish'),
  text: z.string().min(1).max(400),
})

export interface PolishRequest {
  section: string
  facts: string[]
  tone: Tone
}

// 返回 null 表示「AI 未能润色」，调用方回退模板说明段，流程不断。
export async function polishSection(req: PolishRequest, signal?: AbortSignal): Promise<string | null> {
  const out = await postWithRetry({ task: 'polish', ...req }, polishEnvelope, signal)
  return out?.text ?? null
}

export type Persona = 'pressure' | 'stall' | 'reasonable'

const landlordEnvelope = z.object({
  ok: z.literal(true),
  task: z.literal('landlord'),
  reply: z.string().min(1).max(600),
  flaw: z.string().max(120),
  stance: z.enum(['hold', 'concede', 'shift']),
})

export interface LandlordTurn {
  role: 'landlord' | 'tenant'
  text: string
}

export interface LandlordRequest {
  persona: Persona
  round: number
  letterExcerpt: string
  history: LandlordTurn[]
  tenantText: string
}

export interface LandlordReply {
  reply: string
  flaw: string
  stance: 'hold' | 'concede' | 'shift'
}

const LAW_CITE_RE = /《[^》]{2,20}》\s*第\s*\d+\s*条/g

// S16：AI 房东不得编造法条。回复里出现的《XX》第 N 条必须在 content/legal.ts 里存在。
export function landlordLawOk(text: string): boolean {
  const known = new Set(
    LEGAL_REFS.map((l) => l.title.replace(/（[^）]*）/g, '').replace(/\s+/g, '')),
  )
  for (const m of text.match(LAW_CITE_RE) ?? []) {
    if (!known.has(m.replace(/\s+/g, ''))) return false
  }
  return true
}

// 返回 null 表示「AI 未能回应」或回应未过法条校验，调用方显示失败态并可重试。
export async function requestLandlordReply(
  req: LandlordRequest,
  signal?: AbortSignal,
): Promise<LandlordReply | null> {
  const out = await postWithRetry({ task: 'landlord', ...req }, landlordEnvelope, signal)
  if (!out) return null
  if (!landlordLawOk(out.reply)) return null
  return { reply: out.reply, flaw: out.flaw, stance: out.stance }
}
