import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useNavigate, useParams } from 'react-router'

import { getRoomTemplate, type SlotTemplate } from '@/content/roomTemplates'
import type { RoomKind } from '@/domain/types'
import { addSlotPhoto, db } from '@/lib/idb'
import { Button } from '@/ui/Button'
import { toast } from '@/ui/Toast'
import { useCamera } from './useCamera'

function resolveSlot(kind: RoomKind, slotId: string): SlotTemplate | null {
  try {
    return getRoomTemplate(kind).slots.find((s) => s.id === slotId) ?? null
  } catch {
    return null
  }
}

export default function Camera() {
  const { id, roomId, slotId } = useParams()
  const navigate = useNavigate()

  const albumInputRef = useRef<HTMLInputElement>(null)
  const captureInputRef = useRef<HTMLInputElement>(null)

  const [slot, setSlot] = useState<SlotTemplate | null>(null)
  const [missing, setMissing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)

  const cam = useCamera()

  // 点位解析
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

  async function onPickFile(e: ChangeEvent<HTMLInputElement>) {
    await cam.onPickFile(e)
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
        navigate(`/case/demo/capture/${roomId}`)
        return
      }
      await addSlotPhoto(roomId, slotId, {
        blob: cam.pending.blob,
        thumb: cam.pending.thumb,
        sha256: cam.pending.sha256,
      })
      navigate(`/case/${id}/capture/${roomId}`)
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
            onClick={() => navigate(`/case/${id}/capture/${roomId}`)}
          >
            ← 取消
          </button>
          {slot && (
            <>
              <p className="mt-1 text-[15px] font-medium">{slot.label}</p>
              <p className="text-[13px] text-white/70">{slot.why}</p>
            </>
          )}
          {cam.fileMode && <p className="mt-1 text-[13px] text-white/90">用相册里的照片也可以</p>}
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
            {!pending && (
              <div aria-hidden className="pointer-events-none absolute inset-8">
                <span className="absolute left-0 top-0 size-8 border-l-2 border-t-2 border-white/70" />
                <span className="absolute right-0 top-0 size-8 border-r-2 border-t-2 border-white/70" />
                <span className="absolute bottom-0 left-0 size-8 border-b-2 border-l-2 border-white/70" />
                <span className="absolute bottom-0 right-0 size-8 border-b-2 border-r-2 border-white/70" />
              </div>
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
                用这张
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
            <Button
              loading={capturing}
              onClick={() => captureInputRef.current?.click()}
            >
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
            {cam.torchAvailable ? (
              <button
                type="button"
                className="text-[13px] text-white/90"
                onClick={() => void cam.toggleTorch()}
              >
                {cam.torchOn ? '闪光·开' : '闪光'}
              </button>
            ) : (
              <span className="w-8" aria-hidden />
            )}
          </div>
        )}
      </div>

      <input
        ref={albumInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void onPickFile(e)}
      />
      <input
        ref={captureInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => void onPickFile(e)}
      />
    </div>
  )
}
