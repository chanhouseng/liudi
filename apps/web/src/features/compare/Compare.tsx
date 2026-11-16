import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'

import { findSlot } from '@/content/roomTemplates'
import type { Defect, Finding } from '@/domain/types'
import { newId } from '@/domain/repo'
import { iouBBoxes, judge, MATCH_IOU_THRESHOLD } from '@/domain/rules'
import { monthsBetween } from '@/lib/format'
import {
  db,
  listPhotoDefects,
  replaceSlotFindings,
  type ConfirmFindingItem,
} from '@/lib/idb'
import type { RegionAi } from '@/lib/api/vision'
import { requestRegionAi, visionConfigured } from '@/lib/api/vision'
import type { DiffRegion } from '@/lib/diff'
import { diffImages } from '@/lib/diff'
import { getSlotPhotoByPhase } from '@/lib/idb'
import { blobToImageData, warpAffineImageData } from '@/lib/image'
import { loadOpenCV, registerPair, warpTo } from '@/lib/register'
import { Button } from '@/ui/Button'
import { Rule } from '@/ui/Rule'
import { Skeleton } from '@/ui/Skeleton'
import { CasePageShell } from '../case/CasePageShell'
import { useCase } from '../case/useCase'
import CompareResult, { type PendingItem } from './CompareResult'
import ManualAlign from './ManualAlign'

type Seg = 'wait' | 'run' | 'done' | 'fail'

type View =
  | { kind: 'boot' }
  | { kind: 'media-error' }
  | { kind: 'no-move-in' }
  | { kind: 'processing' }
  | { kind: 'manual' }
  | {
      kind: 'result'
      regions: DiffRegion[]
      crops: string[]
      aspect: { w: number; h: number }
      ai: (RegionAi | null)[]
    }
  | { kind: 'failed' }

interface Media {
  inUrl: string
  outUrl: string
  inImg: ImageData
  outImg: ImageData
  inPhotoId?: string
  outPhotoId: string
}

function cropUrl(img: ImageData, bbox: [number, number, number, number]): string {
  const x = Math.round(bbox[0] * img.width)
  const y = Math.round(bbox[1] * img.height)
  const w = Math.max(1, Math.round(bbox[2] * img.width))
  const h = Math.max(1, Math.round(bbox[3] * img.height))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) return ''
  ctx.putImageData(img, -x, -y)
  return c.toDataURL('image/jpeg', 0.85)
}



export default function Compare() {
  const { id, roomId, slotId } = useParams()
  const navigate = useNavigate()
  const caseState = useCase(id)

  const [view, setView] = useState<View>({ kind: 'boot' })
  const [media, setMedia] = useState<Media | null>(null)
  const mediaRef = useRef<Media | null>(null)
  mediaRef.current = media

  const [alignSeg, setAlignSeg] = useState<Seg>('wait')
  const [diffSeg, setDiffSeg] = useState<Seg>('wait')
  const [aiSeg, setAiSeg] = useState<Seg>('wait')
  const [ocvRatio, setOcvRatio] = useState<number | null>(null)
  const [slowSeg, setSlowSeg] = useState<'align' | 'diff' | 'ai' | null>(null)

  // 递增使旧 pipeline 的 setState 全部失效
  const runRef = useRef(0)
  // AI 段的待确认上下文与中止柄：跳过时要拿当前 diff 结果直接进结果页
  const aiAbortRef = useRef<AbortController | null>(null)
  const lastDiffRef = useRef<{
    inImg: ImageData
    warped: ImageData
    regions: DiffRegion[]
  } | null>(null)

  useEffect(() => {
    if (id === 'demo') navigate('/case/demo/compare', { replace: true })
  }, [id, navigate])

  useEffect(() => {
    return () => {
      // 故意在卸载时刻读取：要的就是“最后一次”递增，提前捕获反而会让卸载后的异步拿到旧 token
      // eslint-disable-next-line react-hooks/exhaustive-deps
      runRef.current++
      const m = mediaRef.current
      if (m) {
        URL.revokeObjectURL(m.inUrl)
        URL.revokeObjectURL(m.outUrl)
      }
    }
  }, [])

  function enterResult(
    inImg: ImageData,
    warped: ImageData,
    regions: DiffRegion[],
    ai: (RegionAi | null)[],
  ) {
    lastDiffRef.current = null
    setView({
      kind: 'result',
      regions,
      crops: regions.map((r) => cropUrl(warped, r.bbox)),
      aspect: { w: inImg.width, h: inImg.height },
      ai,
    })
  }

  function skipAi() {
    aiAbortRef.current?.abort()
    aiAbortRef.current = null
    runRef.current++
    setSlowSeg(null)
    setAiSeg('fail')
    const d = lastDiffRef.current
    if (d) enterResult(d.inImg, d.warped, d.regions, d.regions.map(() => null))
  }

  async function runPipeline(inImg: ImageData, outImg: ImageData) {
    const run = ++runRef.current
    const alive = () => runRef.current === run
    setView({ kind: 'processing' })
    setAlignSeg('run')
    setDiffSeg('wait')
    setAiSeg('wait')
    setOcvRatio(null)
    setSlowSeg(null)
    aiAbortRef.current = null
    lastDiffRef.current = null

    // 段 1：对齐（OpenCV 13MB 只在这时才开始下载，显示真实进度）
    let slowT = window.setTimeout(() => {
      if (alive()) setSlowSeg('align')
    }, 8000)
    let H: number[] | null = null
    try {
      await loadOpenCV((r) => {
        if (alive()) setOcvRatio(r)
      })
      const reg = await registerPair(inImg, outImg)
      if (reg.ok) H = reg.H
    } catch {
      // 加载/配准失败都不弹错，走手动对齐
    }
    clearTimeout(slowT)
    if (!alive()) return
    setOcvRatio(null)
    setSlowSeg(null)
    if (!H) {
      setAlignSeg('fail')
      setView({ kind: 'manual' })
      return
    }
    setAlignSeg('done')

    // 段 2：找不同
    setDiffSeg('run')
    slowT = window.setTimeout(() => {
      if (alive()) setSlowSeg('diff')
    }, 8000)
    try {
      const warped = await warpTo(outImg, H, inImg.width, inImg.height)
      const regions = diffImages(inImg, warped)
      clearTimeout(slowT)
      if (!alive()) return
      setDiffSeg('done')
      setSlowSeg(null)

      // 段 3：AI 看一眼（VLM 只描述可见事实；失败/跳过 → 该条「AI 未能识别」，流程不断）
      if (regions.length === 0) {
        setAiSeg('done')
        enterResult(inImg, warped, regions, [])
        return
      }
      if (!visionConfigured()) {
        setAiSeg('fail')
        enterResult(inImg, warped, regions, regions.map(() => null))
        return
      }
      setAiSeg('run')
      lastDiffRef.current = { inImg, warped, regions }
      const abort = new AbortController()
      aiAbortRef.current = abort
      slowT = window.setTimeout(() => {
        if (alive()) setSlowSeg('ai')
      }, 8000)
      const results = await Promise.all(
        regions.map((r) =>
          requestRegionAi(cropUrl(inImg, r.bbox), cropUrl(warped, r.bbox), abort.signal),
        ),
      )
      clearTimeout(slowT)
      if (!alive()) return
      aiAbortRef.current = null
      setAiSeg('done')
      setSlowSeg(null)
      enterResult(inImg, warped, regions, results)
    } catch {
      clearTimeout(slowT)
      if (!alive()) return
      setDiffSeg('fail')
      setSlowSeg(null)
      setView({ kind: 'failed' })
    }
  }

  const bootstrap = useCallback(async () => {
    if (!id || !roomId || !slotId) {
      setView({ kind: 'media-error' })
      return
    }
    const run = ++runRef.current
    setView({ kind: 'boot' })
    try {
      const inRec = await getSlotPhotoByPhase(roomId, slotId, 'move_in')
      const outRec = await getSlotPhotoByPhase(roomId, slotId, 'move_out')
      if (runRef.current !== run) return
      if (!outRec?.blob) {
        setView({ kind: 'media-error' })
        return
      }
      if (!inRec?.blob) {
        setView({ kind: 'no-move-in' })
        return
      }
      const [inImg, outImg] = await Promise.all([
        blobToImageData(inRec.blob),
        blobToImageData(outRec.blob),
      ])
      if (runRef.current !== run) return
      const m: Media = {
        inUrl: URL.createObjectURL(inRec.blob),
        outUrl: URL.createObjectURL(outRec.blob),
        inImg,
        outImg,
        inPhotoId: inRec.id,
        outPhotoId: outRec.id,
      }
      const prev = mediaRef.current
      if (prev) {
        URL.revokeObjectURL(prev.inUrl)
        URL.revokeObjectURL(prev.outUrl)
      }
      setMedia(m)
      void runPipeline(inImg, outImg)
    } catch {
      if (runRef.current !== run) return
      setView({ kind: 'media-error' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, roomId, slotId])

  useEffect(() => {
    if (id !== 'demo') void bootstrap()
  }, [bootstrap, id])

  function retryPipeline() {
    const m = mediaRef.current
    if (m) void runPipeline(m.inImg, m.outImg)
    else void bootstrap()
  }

  function onManualConfirm(H: number[]) {
    const m = mediaRef.current
    if (!m) return
    try {
      const warped = warpAffineImageData(m.outImg, H, m.inImg.width, m.inImg.height)
      // 手动对齐路径不做 AI 段：用户已亲手核对位置，Sheet 里可手选现象
      const regions = diffImages(m.inImg, warped)
      enterResult(m.inImg, warped, regions, regions.map(() => null))
    } catch {
      setView({ kind: 'failed' })
    }
  }

  // 逐条确认：现象 + 点位表面 → finding；与入住底稿瑕疵按 IoU > 0.35 匹配后交规则引擎判定。
  async function confirmFindings(items: PendingItem[]) {
    const m = mediaRef.current
    if (!m || !roomId || !slotId) return
    const room = await db.rooms.get(roomId)
    const slotSurface = room ? findSlot(room.kind, slotId)?.surface : undefined
    const moveInDefects = m.inPhotoId ? await listPhotoDefects(m.inPhotoId) : []
    const c = id ? await db.cases.get(id) : undefined
    const months = c ? monthsBetween(c.leaseStart, c.leaseEnd) : 0
    const out: ConfirmFindingItem[] = items.map((it) => {
      const finding: Finding = {
        id: newId(),
        roomId,
        photoInId: m.inPhotoId,
        photoOutId: m.outPhotoId,
        bbox: it.bbox,
        phenomenon: it.phenomenon,
        surface: it.surface ?? slotSurface ?? 'wall',
        material: it.material ?? undefined,
        severity: it.severity ?? 'moderate',
        areaRatio: it.areaRatio,
        aiDescription: it.aiDescription,
        aiConfidence: it.aiConfidence,
        needsRephoto: it.needsRephoto ?? false,
      }
      let matched: Defect | undefined
      let best = MATCH_IOU_THRESHOLD
      for (const d of moveInDefects) {
        const v = iouBBoxes(d.bbox, it.bbox)
        if (v > best) {
          best = v
          matched = d
        }
      }
      const judgement = judge({
        finding,
        hasMoveInEvidence: Boolean(m.inPhotoId),
        matchedDefect: matched,
        tenancyMonths: months,
      })
      return { finding, judgement }
    })
    await replaceSlotFindings(roomId, slotId, out)
    navigate(`/case/${id}/judge`)
  }

  return (
    <CasePageShell
      state={caseState}
      step={2}
      stepName="对比"
      backTo={`/case/${id}/compare`}
      backLabel="点位清单"
    >
      {view.kind === 'boot' && (
        <div className="space-y-4">
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {view.kind === 'media-error' && (
        <div>
          <p className="text-[15px] text-ink-2">照片读取失败，可能是这张照片没有存上。</p>
          <Button variant="secondary" className="mt-4" onClick={() => void bootstrap()}>
            重试
          </Button>
        </div>
      )}

      {view.kind === 'no-move-in' && (
        <div>
          <p className="text-[15px] text-ink-2">
            这个点位没有入住照片，没法对比。先去取证补一张入住底稿。
          </p>
          <Button className="mt-4" onClick={() => navigate(`/case/${id}/capture/${roomId}`)}>
            去取证
          </Button>
        </div>
      )}

      {view.kind === 'processing' && (
        <div>
          <SegRow
            n="01"
            label="正在对齐两张照片…"
            seg={alignSeg}
            extra={ocvRatio !== null ? `${Math.round(ocvRatio * 100)}%` : null}
            slow={slowSeg === 'align'}
            onSkip={() => {
              runRef.current++
              setSlowSeg(null)
              setAlignSeg('fail')
              setView({ kind: 'manual' })
            }}
          />
          <SegRow
            n="02"
            label="正在找不同…"
            seg={diffSeg}
            slow={slowSeg === 'diff'}
            onSkip={() => {
              runRef.current++
              setSlowSeg(null)
              setDiffSeg('fail')
              setView({ kind: 'failed' })
            }}
          />
          <SegRow
            n="03"
            label="正在让 AI 看一眼…"
            seg={aiSeg}
            slow={slowSeg === 'ai'}
            onSkip={skipAi}
          />
        </div>
      )}

      {view.kind === 'failed' && (
        <div>
          <p className="text-[15px] text-ink-2">自动对比没成功，你可以手动圈出变化的地方。</p>
          <div className="mt-4 flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={retryPipeline}>
              再试一次
            </Button>
            <Button className="flex-1" onClick={() => setView({ kind: 'manual' })}>
              手动对齐
            </Button>
          </div>
        </div>
      )}

      {view.kind === 'manual' && media && (
        <ManualAlign inUrl={media.inUrl} outUrl={media.outUrl} onConfirm={onManualConfirm} />
      )}

      {view.kind === 'result' && media && (
        <CompareResult
          regions={view.regions}
          crops={view.crops}
          ai={view.ai}
          inUrl={media.inUrl}
          outUrl={media.outUrl}
          aspect={view.aspect}
          onBack={() => navigate(`/case/${id}/compare`)}
          onConfirm={confirmFindings}
        />
      )}
    </CasePageShell>
  )
}

function SegRow({
  n,
  label,
  seg,
  extra,
  slow,
  onSkip,
}: {
  n: string
  label: string
  seg: Seg
  extra?: string | null
  slow?: boolean
  onSkip?: () => void
}) {
  return (
    <div className="py-3">
      <Rule />
      <div className="flex items-baseline justify-between pt-3">
        <p className="text-[15px]">
          <span className="mr-2 font-mono text-[13px] text-ink-3">[ {n} ]</span>
          {label}
          {seg === 'run' && extra && (
            <span className="ml-2 font-mono text-[13px] text-ink-3">{extra}</span>
          )}
        </p>
        <span className={`text-[13px] ${seg === 'fail' ? 'text-alert' : 'text-ink-3'}`}>
          {seg === 'done' ? '完成' : seg === 'fail' ? '没做成' : ''}
        </span>
      </div>
      {slow && onSkip && (
        <div className="mt-1 flex items-center justify-between">
          <p className="text-[13px] text-ink-2">这一步有点慢，可以跳过。</p>
          <button type="button" className="text-[13px] text-accent" onClick={onSkip}>
            跳过
          </button>
        </div>
      )}
    </div>
  )
}
