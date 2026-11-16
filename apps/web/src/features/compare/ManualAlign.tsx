import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

import { gestureToHomography, type ManualGesture } from '@/lib/register'
import { Button } from '@/ui/Button'

interface ManualAlignProps {
  inUrl: string
  outUrl: string
  onConfirm: (H: number[]) => void
}

interface Geom {
  containerW: number
  containerH: number
  inW: number
  inH: number
  outW: number
  outH: number
}

interface PinchBase {
  dist: number
  ang: number
  mid: { x: number; y: number }
  xf: ManualGesture
}

// 自动配准失败（内点不足/矩阵奇异/引擎加载失败）后的降级：用户手动把退租图对到入住图上。
// 不弹错误——按 30-domain 的降级链，这里给的是出路不是报警。
export default function ManualAlign({ inUrl, outUrl, onConfirm }: ManualAlignProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const inRef = useRef<HTMLImageElement>(null)
  const outRef = useRef<HTMLImageElement>(null)
  const [loaded, setLoaded] = useState(0)
  const [inNat, setInNat] = useState<{ w: number; h: number } | null>(null)
  const [geom, setGeom] = useState<Geom | null>(null)

  const xf = useRef<ManualGesture>({ tx: 0, ty: 0, scale: 1, rot: 0 })
  const pts = useRef(new Map<number, { x: number; y: number }>())
  const base = useRef<PinchBase | null>(null)

  useEffect(() => {
    if (loaded < 2) return
    const box = boxRef.current
    const i = inRef.current
    const o = outRef.current
    if (!box || !i || !o || !i.naturalWidth || !o.naturalWidth) return
    const rect = box.getBoundingClientRect()
    setGeom({
      containerW: rect.width,
      containerH: rect.height,
      inW: i.naturalWidth,
      inH: i.naturalHeight,
      outW: o.naturalWidth,
      outH: o.naturalHeight,
    })
  }, [loaded])

  function applyXf() {
    const el = outRef.current
    if (!el) return
    const { tx, ty, scale, rot } = xf.current
    el.style.transform = `translate(${tx}px, ${ty}px) rotate(${rot}deg) scale(${scale})`
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // 不支持捕获也能拖，只是移出元素会断
    }
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pts.current.size === 2) base.current = null
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const prev = pts.current.get(e.pointerId)
    if (!prev) return
    const cur = { x: e.clientX, y: e.clientY }
    pts.current.set(e.pointerId, cur)

    if (pts.current.size === 1) {
      xf.current.tx += cur.x - prev.x
      xf.current.ty += cur.y - prev.y
      applyXf()
      return
    }
    if (pts.current.size !== 2) return
    const [a, b] = [...pts.current.values()]
    const dist = Math.hypot(b.x - a.x, b.y - a.y)
    const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    if (!base.current || base.current.dist === 0) {
      base.current = { dist, ang, mid, xf: { ...xf.current } }
      return
    }
    const { dist: d0, ang: a0, mid: m0, xf: x0 } = base.current
    const s = Math.min(3, Math.max(0.4, (x0.scale * dist) / d0))
    xf.current = {
      scale: s,
      rot: x0.rot + (ang - a0),
      tx: x0.tx + (mid.x - m0.x),
      ty: x0.ty + (mid.y - m0.y),
    }
    applyXf()
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    pts.current.delete(e.pointerId)
    base.current = null
  }

  function reset() {
    xf.current = { tx: 0, ty: 0, scale: 1, rot: 0 }
    applyXf()
  }

  function confirm() {
    if (!geom) return
    onConfirm(gestureToHomography(xf.current, geom))
  }

  const kOut = geom ? Math.min(geom.containerW / geom.outW, geom.containerH / geom.outH) : 0
  const offX = geom ? (geom.containerW - geom.outW * kOut) / 2 : 0
  const offY = geom ? (geom.containerH - geom.outH * kOut) / 2 : 0

  return (
    <div>
      <p className="text-[13px] text-ink-2">
        自动对齐没成。拖动、双指缩放旋转下面这张退租照片，让它和入住照片对上。
      </p>
      <div
        ref={boxRef}
        className="relative mt-4 w-full touch-none overflow-hidden border border-rule"
        style={{ aspectRatio: inNat ? `${inNat.w} / ${inNat.h}` : '4 / 3' }}
      >
        <img
          ref={inRef}
          src={inUrl}
          alt="入住照片"
          draggable={false}
          onLoad={(e) => {
            setInNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
            setLoaded((n) => n + 1)
          }}
          className="absolute inset-0 h-full w-full object-contain select-none"
        />
        {/* overlay 先隐藏加载（geom 依赖它的 naturalWidth），量完才显示并可交互 */}
        <img
          ref={outRef}
          src={outUrl}
          alt="退租照片"
          draggable={false}
          onLoad={() => setLoaded((n) => n + 1)}
          onPointerDown={geom ? onPointerDown : undefined}
          onPointerMove={geom ? onPointerMove : undefined}
          onPointerUp={geom ? onPointerUp : undefined}
          onPointerCancel={geom ? onPointerUp : undefined}
          className={`absolute touch-none select-none ${
            geom ? 'cursor-move opacity-60' : 'pointer-events-none inset-0 h-full w-full opacity-0'
          }`}
          style={
            geom
              ? {
                  left: offX,
                  top: offY,
                  width: geom.outW * kOut,
                  height: geom.outH * kOut,
                  transformOrigin: '0 0',
                }
              : undefined
          }
        />
      </div>
      <div className="mt-6 flex gap-3">
        <Button variant="secondary" className="flex-1" onClick={reset}>
          重置
        </Button>
        <Button className="flex-1" disabled={!geom} onClick={confirm}>
          对好了，开始对比
        </Button>
      </div>
    </div>
  )
}
