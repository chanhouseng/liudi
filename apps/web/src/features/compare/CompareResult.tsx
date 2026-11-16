import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'

import type { BBox, Phenomenon, Severity, Surface } from '@/domain/types'
import type { DiffRegion } from '@/lib/diff'
import type { RegionAi } from '@/lib/api/vision'
import { PHENOMENON_LABELS, SEVERITY_LABELS } from '@/content/vocab'
import { Button } from '@/ui/Button'
import { Rule } from '@/ui/Rule'
import { Sheet } from '@/ui/Sheet'
import { toast } from '@/ui/Toast'

// 逐条确认时交给上层的最小数据；surface/severity 缺省由上层按点位模板补齐。
export interface PendingItem {
  bbox: BBox
  areaRatio: number
  phenomenon: Phenomenon
  surface?: Surface
  severity?: Severity
  material?: string | null
  aiDescription?: string
  aiConfidence?: number
  needsRephoto?: boolean
}

interface CompareResultProps {
  regions: DiffRegion[]
  crops: string[]
  ai: (RegionAi | null)[]
  inUrl: string
  outUrl: string
  aspect: { w: number; h: number }
  onBack: () => void
  onConfirm?: (items: PendingItem[]) => Promise<void>
}

const PHENOMENON_KEYS = Object.keys(PHENOMENON_LABELS) as Phenomenon[]

// S10 对比结果：滑块对比（60fps，直接写 style 不走 setState）+ 差异框 + 卡片。
// AI 观察只描述现象；失败/未配置的条目给 10 类手选控件，流程不断。
export default function CompareResult({
  regions,
  crops,
  ai,
  inUrl,
  outUrl,
  aspect,
  onBack,
  onConfirm,
}: CompareResultProps) {
  const [mode, setMode] = useState<'slider' | 'side'>('slider')
  const [armed, setArmed] = useState(false)
  const [sheet, setSheet] = useState<number | null>(null)
  const [picked, setPicked] = useState<Record<number, Phenomenon>>({})
  const [confirming, setConfirming] = useState(false)

  const clipRef = useRef<HTMLImageElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const pos = useRef(50)
  const dragging = useRef(false)

  // 扫描线 600ms 后差异框按 120ms 逐个亮起；reduced-motion 由 tokens.css 全局规则关掉动画
  useEffect(() => {
    const t = window.setTimeout(() => setArmed(true), 600)
    return () => window.clearTimeout(t)
  }, [])

  function applyPos() {
    const p = pos.current
    if (clipRef.current) clipRef.current.style.clipPath = `inset(0 ${100 - p}% 0 0)`
    if (barRef.current) barRef.current.style.left = `${p}%`
  }

  function updateFromClient(clientX: number) {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    pos.current = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100))
    applyPos()
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    dragging.current = true
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // 老浏览器不支持捕获也能拖
    }
    updateFromClient(e.clientX)
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging.current) return
    updateFromClient(e.clientX)
  }

  function onPointerUp() {
    dragging.current = false
  }

  function onBarKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    pos.current = Math.min(100, Math.max(0, pos.current + (e.key === 'ArrowLeft' ? -2 : 2)))
    applyPos()
  }

  const fmt = (n: number) => String(n).padStart(2, '0')

  // S10 底部主按钮：逐条确认。每个区域必须有现象（AI 或手选），不许留空（FR-305）。
  async function handleConfirm() {
    if (!onConfirm) return
    const missing = regions.findIndex((_, i) => !ai[i] && !picked[i])
    if (missing >= 0) {
      setSheet(missing)
      toast(`先给 F-${fmt(missing + 1)} 选个现象`)
      return
    }
    setConfirming(true)
    try {
      await onConfirm(
        regions.map((r, i): PendingItem => {
          const a = ai[i]
          if (a) {
            return {
              bbox: r.bbox,
              areaRatio: r.bbox[2] * r.bbox[3],
              phenomenon: a.phenomenon,
              surface: a.surface,
              severity: a.severity,
              material: a.material,
              aiDescription: a.description,
              aiConfidence: a.confidence,
              needsRephoto: a.needsRephoto,
            }
          }
          return {
            bbox: r.bbox,
            areaRatio: r.bbox[2] * r.bbox[3],
            phenomenon: picked[i],
          }
        }),
      )
    } catch {
      toast('没存上，再试一次')
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-ink-2">左退租 · 右入住，拖中间的线对比</p>
        <button
          type="button"
          className="text-[13px] text-ink-2"
          onClick={() => setMode(mode === 'slider' ? 'side' : 'slider')}
        >
          {mode === 'slider' ? '并排看' : '滑块看'}
        </button>
      </div>

      {mode === 'slider' ? (
        <div
          ref={wrapRef}
          className="relative mt-3 w-full touch-none overflow-hidden border border-rule"
          style={{ aspectRatio: `${aspect.w} / ${aspect.h}` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <img src={inUrl} alt="入住照片" draggable={false} className="absolute inset-0 h-full w-full object-cover select-none" />
          <img
            ref={clipRef}
            src={outUrl}
            alt="退租照片"
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover select-none"
            style={{ clipPath: 'inset(0 50% 0 0)' }}
          />
          {!armed && <div aria-hidden className="scanline absolute inset-x-0 h-px bg-accent" />}
          {regions.map((r, i) => (
            <button
              key={i}
              type="button"
              aria-label={`差异 ${fmt(i + 1)}`}
              onClick={(e) => {
                e.stopPropagation()
                setSheet(i)
              }}
              className="absolute border border-accent bg-accent/5 text-left transition-opacity duration-300"
              style={{
                left: `${r.bbox[0] * 100}%`,
                top: `${r.bbox[1] * 100}%`,
                width: `${r.bbox[2] * 100}%`,
                height: `${r.bbox[3] * 100}%`,
                opacity: armed ? 1 : 0,
                transitionDelay: `${i * 120}ms`,
              }}
            >
              <span className="absolute -top-0.5 left-0 -translate-y-full bg-accent px-1 py-px font-mono text-[11px] leading-snug text-white">
                F-{fmt(i + 1)}
              </span>
            </button>
          ))}
          <div
            ref={barRef}
            role="slider"
            aria-label="对比分割线"
            aria-valuenow={50}
            aria-valuemin={0}
            aria-valuemax={100}
            tabIndex={0}
            onKeyDown={onBarKey}
            className="absolute inset-y-0 z-10 w-4 -translate-x-1/2 cursor-ew-resize"
            style={{ left: '50%' }}
          >
            <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-ink" />
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <figure className="border border-rule">
            <img src={inUrl} alt="入住照片" className="w-full select-none" draggable={false} />
            <figcaption className="border-t border-rule px-3 py-1.5 text-[13px] text-ink-2">入住</figcaption>
          </figure>
          <figure className="border border-rule">
            <img src={outUrl} alt="退租照片" className="w-full select-none" draggable={false} />
            <figcaption className="border-t border-rule px-3 py-1.5 text-[13px] text-ink-2">退租</figcaption>
          </figure>
        </div>
      )}

      {regions.length === 0 ? (
        <p className="mt-8 text-[15px] text-ink-2">这张照片没看出明显差异——这本身也是好消息。</p>
      ) : (
        <>
          <p className="mt-6 font-serif text-[17px] font-semibold">
            {regions.length} 处差异
          </p>
          <p className="text-[13px] text-ink-2">点一条看位置和说明。</p>
          <div className="mt-2">
            {regions.map((r, i) => (
              <div key={i}>
                <Rule />
                <button
                  type="button"
                  className="flex w-full items-center gap-3 py-3 text-left"
                  onClick={() => setSheet(i)}
                >
                  <img
                    src={crops[i]}
                    alt=""
                    className="h-14 w-14 shrink-0 rounded-doc border border-rule object-cover"
                  />
                  <span className="min-w-0">
                    <span className="block font-mono text-[13px] text-ink-3">[ F-{fmt(i + 1)} ]</span>
                    <span className="block text-[15px]">差异 {fmt(i + 1)}</span>
                    <span className="block text-[13px] text-ink-2">
                      {ai[i]
                        ? `${PHENOMENON_LABELS[ai[i]!.phenomenon]} · ${SEVERITY_LABELS[ai[i]!.severity]}`
                        : picked[i]
                          ? `现象：${PHENOMENON_LABELS[picked[i]]}（你选的）`
                          : `强度 ${Math.round(r.strength * 100)}%`}
                    </span>
                  </span>
                </button>
              </div>
            ))}
            <Rule />
          </div>
        </>
      )}

      <div className="mt-10 space-y-3">
        <Button className="w-full" loading={confirming} onClick={() => void handleConfirm()}>
          逐条确认
        </Button>
        <Button variant="secondary" className="w-full" onClick={onBack}>
          返回点位清单
        </Button>
      </div>

      <Sheet open={sheet !== null} onClose={() => setSheet(null)} title={sheet === null ? undefined : `[ F-${fmt(sheet + 1)} ]`}>
        {sheet !== null && (
          <div>
            <img
              src={crops[sheet]}
              alt=""
              className="w-full rounded-doc border border-rule object-cover"
            />
            <p className="mt-3 text-[15px]">
              差异强度 {Math.round(regions[sheet].strength * 100)}%，约{' '}
              <span className="font-mono">
                {Math.round(regions[sheet].bbox[2] * aspect.w)}×{Math.round(regions[sheet].bbox[3] * aspect.h)}
              </span>{' '}
              像素。
            </p>
            {ai[sheet] ? (
              <>
                <blockquote className="mt-3 border-l-2 border-rule pl-3 text-[15px] leading-relaxed text-ink-2">
                  {ai[sheet]!.description}
                </blockquote>
                <p className="mt-2 text-[13px] text-ink-2">
                  AI 看到的是「{PHENOMENON_LABELS[ai[sheet]!.phenomenon]}」·
                  {SEVERITY_LABELS[ai[sheet]!.severity]}。AI 只描述看到的现象，不判断该谁负责。
                </p>
                {ai[sheet]!.needsRephoto && (
                  <p className="mt-2 text-[13px] text-ink-2">这张裁切图看不清，建议重拍一张。</p>
                )}
              </>
            ) : (
              <div className="mt-3">
                <p className="text-[13px] text-ink-2">
                  {picked[sheet]
                    ? `这块你标记为「${PHENOMENON_LABELS[picked[sheet]]}」。`
                    : 'AI 未能识别。这块是什么，由你来选：'}
                </p>
                <div className="mt-2 grid grid-cols-5 gap-2">
                  {PHENOMENON_KEYS.map((p) => {
                    const active = picked[sheet] === p
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPicked((prev) => ({ ...prev, [sheet]: p }))}
                        className={`h-9 rounded-doc border text-[13px] ${
                          active ? 'border-accent text-accent' : 'border-rule text-ink-2'
                        }`}
                      >
                        {PHENOMENON_LABELS[p]}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </Sheet>
    </div>
  )
}
