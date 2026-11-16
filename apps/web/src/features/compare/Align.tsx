import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useNavigate, useParams } from 'react-router'

import { getRoomTemplate, type SlotTemplate } from '@/content/roomTemplates'
import type { RoomKind } from '@/domain/types'
import { addSlotPhoto, db, getSlotPhotoByPhase } from '@/lib/idb'
import { Button } from '@/ui/Button'
import { toast } from '@/ui/Toast'
import { useCamera } from '../capture/useCamera'

const TIPS = ['站到入住时拍照的位置', '保持手机水平', '让门框贴着画面边缘']

function resolveSlot(kind: RoomKind, slotId: string): SlotTemplate | null {
  try {
    return getRoomTemplate(kind).slots.find((s) => s.id === slotId) ?? null
  } catch {
    return null
  }
}

interface Xf {
  tx: number
  ty: number
  scale: number
  rot: number
}

interface PinchBase {
  dist: number
  ang: number
  mid: { x: number; y: number }
  xf: Xf
}

export default function Align() {
  const { id, roomId, slotId } = useParams()
  const navigate = useNavigate()

  const albumInputRef = useRef<HTMLInputElement>(null)
  const captureInputRef = useRef<HTMLInputElement>(null)

  const [slot, setSlot] = useState<SlotTemplate | null>(null)
  const [missing, setMissing] = useState(false)
  const [refUrl, setRefUrl] = useState<string | null>(null)
  const [showRef, setShowRef] = useState(true)
  const [litTips, setLitTips] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)

  const cam = useCamera()

  // 参考帧变换：手势里直接写 ref + style，避免高频 setState
  const overlayRef = useRef<HTMLImageElement>(null)
  const xf = useRef<Xf>({ tx: 0, ty: 0, scale: 1, rot: 0 })
  const pts = useRef(new Map<number, { x: number; y: number }>())
  const base = useRef<PinchBase | null>(null)

  // 点位解析 + 入住参考帧
  useEffect(() => {
    let on = true
    void (async () => {
      if (!id || !roomId || !slotId) {
        setMissing(true)
        return
      }
      try {
        let s: SlotTemplate | null = null
        if (id === 'demo') {
          s = resolveSlot(roomId.replace(/^demo-/, '') as RoomKind, slotId)
        } else {
          const room = await db.rooms.get(roomId)
          s = room ? resolveSlot(room.kind, slotId) : null
          if (room) {
            const p = await getSlotPhotoByPhase(roomId, slotId, 'move_in')
            if (p?.blob) setRefUrl(URL.createObjectURL(p.blob))
          }
        }
        if (!on) return
        if (s) setSlot(s)
        else setMissing(true)
      } catch {
        if (on) setMissing(true)
      }
    })()
    return () => {
      on = false
    }
  }, [id, roomId, slotId])

  // 释放参考帧 URL
  useEffect(() => {
    return () => {
      if (refUrl) URL.revokeObjectURL(refUrl)
    }
  }, [refUrl])

  // 引导三步逐条点亮
  useEffect(() => {
    if (missing) return
    const timers = TIPS.map((_, i) => window.setTimeout(() => setLitTips(i + 1), 700 * (i + 1)))
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [missing])

  function applyXf() {
    const el = overlayRef.current
    if (!el) return
    const { tx, ty, scale, rot } = xf.current
    el.style.transform = `translate(${tx}px, ${ty}px) rotate(${rot}deg) scale(${scale})`
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // 老浏览器不支持捕获也能拖，只是移出元素会断
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

  function reshoot() {
    setSaveError(false)
    cam.reshoot()
  }

  async function confirmSave() {
    if (!cam.pending || saving || !id || !roomId || !slotId) return
    setSaving(true)
    setSaveError(false)
    try {
      if (id === 'demo') {
        toast('演示案例不保存照片。')
        URL.revokeObjectURL(cam.pending.url)
        cam.reshoot()
        navigate('/case/demo/compare')
        return
      }
      await addSlotPhoto(
        roomId,
        slotId,
        {
          blob: cam.pending.blob,
          thumb: cam.pending.thumb,
          sha256: cam.pending.sha256,
        },
        'move_out',
      )
      navigate(`/case/${id}/compare/${roomId}/${slotId}/result`)
    } catch {
      setSaveError(true)
    } finally {
      setSaving(false)
    }
  }

  const pending = cam.pending
  const capturing = cam.capturing

  if (missing) {
    return (
      <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-ink px-8 text-center">
        <p className="text-[15px] text-white/80">没有找到这个点位。</p>
        <button
          type="button"
          className="text-[13px] text-white/70"
          onClick={() => navigate(-1)}
        >
          ← 返回
        </button>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-ink">
      <div className="bg-black/60 px-5 pb-3 pt-[calc(12px+env(safe-area-inset-top))] text-white">
        <div className="mx-auto max-w-[480px]">
          <button
            type="button"
            className="text-[13px] text-white/70"
            onClick={() => navigate(`/case/${id}/compare`)}
          >
            ← 取消
          </button>
          {slot && (
            <>
              <p className="mt-1 text-[15px] font-medium">退租 · {slot.label}</p>
              <p className="text-[13px] text-white/70">{slot.why}</p>
            </>
          )}
          <p className="mt-1 text-[13px] text-white/90">对不齐也没关系，下一步可以手动调。</p>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {cam.fileMode ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
            <p className="text-[15px] text-white/80">这台设备开不了摄像头，从相册选一张也可以。</p>
            <Button loading={capturing} onClick={() => captureInputRef.current?.click()}>
              选择照片
            </Button>
          </div>
        ) : (
          <>
            <video
              ref={cam.videoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full object-cover"
            />
            {!pending && refUrl && showRef && (
              <div
                className="absolute inset-0 flex touch-none items-center justify-center"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              >
                <img
                  ref={overlayRef}
                  src={refUrl}
                  alt="入住参考帧"
                  draggable={false}
                  className="pointer-events-none max-h-full max-w-full opacity-35 select-none"
                />
              </div>
            )}
            {!pending && refUrl && (
              <button
                type="button"
                className="absolute right-4 top-4 rounded-doc bg-black/50 px-3 py-1.5 text-[13px] text-white/90"
                onClick={() => setShowRef((v) => !v)}
              >
                {showRef ? '隐藏参考帧' : '显示参考帧'}
              </button>
            )}
            {!pending && !refUrl && (
              <p className="absolute inset-x-6 top-4 text-center text-[13px] text-white/80">
                这个点位没有入住照片，直接拍退租也可以。
              </p>
            )}
            {!pending && (
              <ul className="absolute inset-x-6 bottom-4 space-y-1.5 text-center text-[13px]">
                {TIPS.map((t, i) => (
                  <li key={t} className={i < litTips ? 'text-white' : 'text-white/40'}>
                    {t}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {pending && (
          <div className="absolute inset-0 bg-ink">
            <img
              src={pending.url}
              alt="刚拍的照片"
              className="h-full w-full object-contain"
            />
          </div>
        )}
      </div>

      <div className="pb-[calc(16px+env(safe-area-inset-bottom))] pt-4">
        {pending ? (
          <div className="mx-auto max-w-[480px] px-5">
            {saveError && (
              <p role="alert" className="mb-3 text-center text-[13px] text-white/90">
                这张没存上，再拍一次。
              </p>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                disabled={saving}
                onClick={reshoot}
                className="h-11 flex-1 rounded-doc border border-white text-[15px] text-white disabled:opacity-40"
              >
                重拍
              </button>
              <Button
                className="flex-1"
                loading={saving}
                disabled={saveError}
                onClick={() => void confirmSave()}
              >
                拍好了
              </Button>
            </div>
          </div>
        ) : cam.fileMode ? (
          <div className="mx-auto flex max-w-[480px] items-center justify-between px-10">
            <button
              type="button"
              className="text-[13px] text-white/90"
              onClick={() => albumInputRef.current?.click()}
            >
              相册
            </button>
            <Button loading={capturing} onClick={() => captureInputRef.current?.click()}>
              选择照片
            </Button>
            <span className="w-8" aria-hidden />
          </div>
        ) : (
          <div className="mx-auto flex max-w-[480px] items-center justify-between px-10">
            <button
              type="button"
              className="text-[13px] text-white/90"
              onClick={() => albumInputRef.current?.click()}
            >
              相册
            </button>
            <button
              type="button"
              aria-label="快门"
              disabled={capturing}
              onClick={() => void cam.capture()}
              className="size-16 rounded-full border-2 border-white p-1 disabled:opacity-60"
            >
              {capturing ? (
                <span className="block size-full animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <span className="block size-full rounded-full bg-white" />
              )}
            </button>
            <span className="w-8" aria-hidden />
          </div>
        )}
      </div>

      <input
        ref={albumInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void cam.onPickFile(e)}
      />
      <input
        ref={captureInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => void cam.onPickFile(e)}
      />
    </div>
  )
}
