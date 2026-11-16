// T16 VLM 客户端：走 FC 代理（T15），客户端做最后一道 schema 校验 + 脏词过滤。
// 返回 null 一律表示「AI 未能识别」，调用方据此给 10 类手选控件，流程不断（FR-401 / PRD §7）。

import { z } from 'zod'

import type { Phenomenon, Severity, Surface } from '@/domain/types'

const SURFACES = ['wall', 'floor', 'ceiling', 'door', 'window', 'furniture', 'appliance', 'fixture'] as const
const SEVERITIES = ['light', 'moderate', 'severe'] as const
const PHENOMENONS = [
  'stain', 'scratch', 'crack', 'chip', 'discolor', 'rust', 'hole', 'missing', 'deform', 'dirt',
] as const

const bboxSchema = z
  .tuple([z.number(), z.number(), z.number(), z.number()])
  .refine(
    ([x1, y1, x2, y2]) =>
      [x1, y1, x2, y2].every((v) => v >= 0 && v <= 1) && x1 < x2 && y1 < y2,
  )

const observationSchema = z.object({
  bbox: bboxSchema,
  surface: z.enum(SURFACES),
  material: z.string().max(40).nullable(),
  phenomenon: z.enum(PHENOMENONS),
  description: z.string().min(1).max(300),
  severity: z.enum(SEVERITIES),
  cause_hypothesis: z.string().max(120).nullable(),
  confidence: z.number().min(0).max(1),
  needs_rephoto: z.boolean(),
})

// 逐条校验：一条坏只丢一条（FR-402），不连坐整个数组。
const envelopeSchema = z.object({
  ok: z.literal(true),
  observations: z.array(z.unknown()).max(12),
})

export interface RegionAi {
  phenomenon: Phenomenon
  surface: Surface
  material: string | null
  description: string
  severity: Severity
  confidence: number
  needsRephoto: boolean
  causeHypothesis: string | null
}

const TIMEOUT_MS = 25000
const ATTEMPTS = 2

// 判责措辞 = 脏数据，整条丢弃（T16 卡：只描述不判责）。
const DIRTY_RE =
  /应当赔偿|应该赔偿|需要赔偿|该赔偿|房东责任|租客责任|责任在房东|责任在租客|全额扣除/

export function isDirtyText(text: string): boolean {
  return DIRTY_RE.test(text)
}

// FC 端点部署后才确定；用函数读保持可测（vi.stubEnv 可注入）。
const apiBase = (): string => import.meta.env.VITE_VISION_API ?? ''

export function visionConfigured(): boolean {
  return apiBase() !== ''
}

class VisionHttpError extends Error {
  constructor(readonly status: number) {
    super(`vision-http-${status}`)
  }
}

async function postOnce(
  base: string,
  inCrop: string,
  outCrop: string,
  signal: AbortSignal,
): Promise<unknown[]> {
  const res = await fetch(`${base}/api/vision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ images: [inCrop, outCrop] }),
    signal,
  })
  if (!res.ok) throw new VisionHttpError(res.status)
  const parsed = envelopeSchema.safeParse(await res.json())
  if (!parsed.success) throw new Error('vision-schema')
  return parsed.data.observations
}

// 失败重试 1 次：网络错误 / 5xx / 429 / 超时可重试；其余 4xx 不重试。
// 任何失败都返回 null，不抛——降级是常态路径，不是异常。
export async function requestRegionAi(
  inCrop: string,
  outCrop: string,
  signal?: AbortSignal,
): Promise<RegionAi | null> {
  const base = apiBase()
  if (!base) return null
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const onOuterAbort = () => controller.abort()
    signal?.addEventListener('abort', onOuterAbort)
    try {
      const raw = await postOnce(base, inCrop, outCrop, controller.signal)
      const valid = raw
        .map((o) => observationSchema.safeParse(o))
        .filter((p) => p.success)
        .map((p) => p.data)
      const clean = valid.find(
        (o) =>
          !isDirtyText(o.description) &&
          !(o.cause_hypothesis !== null && isDirtyText(o.cause_hypothesis)),
      )
      if (!clean) return null
      return {
        phenomenon: clean.phenomenon,
        surface: clean.surface,
        material: clean.material,
        description: clean.description,
        severity: clean.severity,
        confidence: clean.confidence,
        needsRephoto: clean.needs_rephoto,
        causeHypothesis: clean.cause_hypothesis,
      }
    } catch (err) {
      const status = err instanceof VisionHttpError ? err.status : undefined
      const retryable = status === undefined || status === 429 || status >= 500
      if (!retryable || attempt === ATTEMPTS - 1 || signal?.aborted) return null
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onOuterAbort)
    }
  }
  return null
}
