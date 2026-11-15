import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'

import { findSlot, getRoomTemplate, type SlotTemplate } from '@/content/roomTemplates'
import { PHENOMENON_LABELS } from '@/content/vocab'
import type { BBox, Phenomenon, Room } from '@/domain/types'
import {
  addDefect,
  db,
  deleteDefect,
  getRoomShotMap,
  listPhotoDefects,
  setDefectPhenomenon,
  type PhotoRecord,
} from '@/lib/idb'
import { Button } from '@/ui/Button'
import { Sheet } from '@/ui/Sheet'
import { Skeleton } from '@/ui/Skeleton'
import { toast } from '@/ui/Toast'

const PHENOMENON_KEYS = Object.keys(PHENOMENON_LABELS) as Phenomenon[]
const MIN_BOX_PX = 16

type Meta =
  | { state: 'ok'; room: Room; slot: SlotTemplate; photo: PhotoRecord }
  | { state: 'miss' }
  | { state: 'err' }

function normBox(
  a: { x: number; y: number },
  b: { x: number; y: number },
  w: number,
  h: number,
): BBox {
  const x0 = Math.max(0, Math.min(a.x, b.x) / w)
  const y0 = Math.max(0, Math.min(a.y, b.y) / h)
  const x1 = Math.min(w, Math.max(a.x, b.x) / w)
  const y1 = Math.min(h, Math.max(a.y, b.y) / h)
  return [x0, y0, x1 - x0, y1 - y0]
}

export default function Annotate() {
  const { id, roomId, slotId } = useParams()
  const navigate = useNavigate()
  const [retryTick, setRetryTick] = useState(0)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null)
  const [draft, setDraft] = useState<BBox | null>(null)
  const [pendingRect, setPendingRect] = useState<BBox | null>(null)
  const [editTarget, setEditTarget] = useState<string | null>(null)
  const [selectedPhen, setSelectedPhen] = useState<Phenomenon>('stain')

  const containerRef = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{
    mode: 'none' | 'draw' | 'pinch'
    startImg: { x: number; y: number } | null
    startClient: { x: number; y: number } | null
    pinchBase: { dist: number; mid: { x: number; y: number }; view: { s: number; tx: number; ty: number } } | null
  }>({ mode: 'none', startImg: null, startClient: null, pinchBase: null })
  const [view, setView] = useState({ s: 1, tx: 0, ty: 0 })

  const meta = useLiveQuery<Meta>(async () => {
    if (!roomId || !slotId) return { state: 'err' }
    try {
      const room = await db.rooms.get(roomId)
      if (!room) return { state: 'miss' }
      const tpl = safeTemplate(room.kind)
      const slot = tpl ? findSlot(room.kind, slotId) : undefined
      if (!tpl || !slot) return { state: 'miss' }
      const shot = await getRoomShotMap(roomId)
      const photo = shot.get(slotId)
      if (!photo) return { state: 'miss' }
      return { state: 'ok', room, slot, photo }
    } catch {
      return { state: 'err' }
    }
  }, [roomId, slotId, retryTick])

  const photoId = meta?.state === 'ok' ? meta.photo.id : null
  const defects = useLiveQuery(
    async () => (photoId ? await listPhotoDefects(photoId) : []),
    [photoId],
  )

  useEffect(() => {
    if (!photoId) {
      setPhotoUrl(null)
      return
    }
    let dead = false
    let url: string | null = null
    db.photos
      .get(photoId)
      .then((p) => {
        if (dead || !p?.blob) return
        url = URL.createObjectURL(p.blob)
        setPhotoUrl(url)
      })
      .catch(() => setPhotoUrl(null))
    return () => {
      dead = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [photoId])

  useEffect(() => {
    setView({ s: 1, tx: 0, ty: 0 })
  }, [photoUrl])

  function imgPoint(clientX: number, clientY: number): { x: number; y: number } {
    const el = containerRef.current
    if (!el) return { x: 0, y: 0 }
    const r = el.getBoundingClientRect()
    return { x: (clientX - r.left - view.tx) / view.s, y: (clientY - r.top - view.ty) / view.s }
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // 捕获只是尽力而为：合成事件或特殊设备上 pointerId 可能不是活跃指针，会抛 NotFoundError
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesture.current
    if (pointers.current.size === 1) {
      g.mode = 'draw'
      g.startImg = imgPoint(e.clientX, e.clientY)
      g.startClient = { x: e.clientX, y: e.clientY }
    } else if (pointers.current.size === 2) {
      g.mode = 'pinch'
      setDraft(null)
      const pts = [...pointers.current.values()]
      g.pinchBase = {
        dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
        mid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
        view: { ...view },
      }
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesture.current
    const el = containerRef.current
    if (!el || !imgSize) return
    if (g.mode === 'draw' && g.startImg) {
      const cur = imgPoint(e.clientX, e.clientY)
      setDraft(normBox(g.startImg, cur, imgSize.w, imgSize.h))
    } else if (g.mode === 'pinch' && g.pinchBase) {
      const pts = [...pointers.current.values()]
      if (pts.length < 2) return
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }
      const s = Math.min(3, Math.max(1, (g.pinchBase.view.s * dist) / g.pinchBase.dist))
      const rect = el.getBoundingClientRect()
      const boxW = rect.width
      const boxH = imgSize ? (boxW * imgSize.h) / imgSize.w : rect.height
      const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
      const tx = clamp(
        g.pinchBase.view.tx + (mid.x - g.pinchBase.mid.x) / s,
        Math.min(0, boxW - boxW * s),
        0,
      )
      const ty = clamp(
        g.pinchBase.view.ty + (mid.y - g.pinchBase.mid.y) / s,
        Math.min(0, boxH - boxH * s),
        0,
      )
      setView({ s, tx, ty })
    }
  }

  function onPointerEnd(e: React.PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.delete(e.pointerId)
    const g = gesture.current
    if (g.mode === 'draw' && g.startImg && g.startClient && imgSize) {
      // 不读 draft state：move/up 可能同批派发，state 还没提交，直接从手势起点重算
      const cur = imgPoint(e.clientX, e.clientY)
      const box = normBox(g.startImg, cur, imgSize.w, imgSize.h)
      const dx = e.clientX - g.startClient.x
      const dy = e.clientY - g.startClient.y
      if (Math.abs(dx) >= MIN_BOX_PX && Math.abs(dy) >= MIN_BOX_PX) {
        setPendingRect(box)
      }
    }
    if (pointers.current.size === 0) {
      g.mode = 'none'
      g.startImg = null
      g.startClient = null
      g.pinchBase = null
      setDraft(null)
    }
  }

  async function confirmPhenomenon(phen: Phenomenon) {
    if (!photoId) return
    try {
      if (editTarget) {
        await setDefectPhenomenon(editTarget, phen)
        setEditTarget(null)
      } else if (pendingRect) {
        await addDefect(photoId, { bbox: pendingRect, phenomenon: phen })
        setPendingRect(null)
      }
    } catch {
      toast('没存上，请再试一次。')
    }
  }

  if (meta === undefined) {
    return (
      <main className="mx-auto min-h-dvh max-w-[480px] px-5 pt-14">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="mt-6 h-64 w-full" />
        <div className="mt-6 space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </main>
    )
  }

  if (meta.state === 'err') {
    return (
      <main className="mx-auto min-h-dvh max-w-[480px] px-5 pt-14">
        <p className="text-ink-2">照片读取失败</p>
        <Button variant="secondary" className="mt-4" onClick={() => setRetryTick((n) => n + 1)}>
          重试
        </Button>
      </main>
    )
  }

  if (meta.state === 'miss') {
    return (
      <main className="mx-auto min-h-dvh max-w-[480px] px-5 pt-14">
        <p className="text-ink-2">没有找到这个点位。</p>
        <Button
          variant="secondary"
          className="mt-4"
          onClick={() => navigate(`/case/${id}/capture/${roomId}`)}
        >
          返回房间列表
        </Button>
      </main>
    )
  }

  const { room, slot } = meta
  const typePickerOpen = pendingRect !== null || editTarget !== null

  return (
    <main className="mx-auto min-h-dvh max-w-[480px] px-5 pb-40">
      <header className="flex items-baseline justify-between pt-8">
        <Link to={`/case/${id}/capture/${roomId}`} className="text-[13px] text-ink-2">
          ← {room.label}
        </Link>
        <span className="font-mono text-[13px] tracking-[0.02em] text-ink-3">[ 01 ]</span>
      </header>
      <div className="mt-2">
        <h1 className="font-serif text-[22px] font-semibold">标注：{slot.label}</h1>
        <p className="mt-1 text-[13px] text-ink-3">不用圈得很精确，能看出位置就行。</p>
      </div>

      <div
        ref={containerRef}
        className="mt-4 touch-none select-none overflow-hidden rounded-doc border border-rule"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        {photoUrl ? (
          <div
            style={{
              transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.s})`,
              transformOrigin: '0 0',
            }}
          >
            <img
              src={photoUrl}
              alt={slot.label}
              draggable={false}
              className="block w-full"
              onLoad={(e) => {
                const el = e.currentTarget
                setImgSize({ w: el.naturalWidth, h: el.naturalHeight })
              }}
            />
            <div className="absolute inset-0" aria-hidden>
              {(defects ?? []).map((d) => (
                <div
                  key={d.id}
                  className="absolute border border-accent"
                  style={{
                    left: `${d.bbox[0] * 100}%`,
                    top: `${d.bbox[1] * 100}%`,
                    width: `${d.bbox[2] * 100}%`,
                    height: `${d.bbox[3] * 100}%`,
                  }}
                >
                  <span className="absolute -top-[18px] left-0 bg-paper px-1 font-mono text-[10px] leading-[16px] text-accent">
                    D-{String(d.seq).padStart(2, '0')}
                  </span>
                </div>
              ))}
              {draft && (
                <div
                  className="absolute border border-dashed border-accent"
                  style={{
                    left: `${draft[0] * 100}%`,
                    top: `${draft[1] * 100}%`,
                    width: `${draft[2] * 100}%`,
                    height: `${draft[3] * 100}%`,
                  }}
                />
              )}
            </div>
          </div>
        ) : (
          <Skeleton className="aspect-[4/3] w-full" />
        )}
      </div>
      <p className="mt-2 text-center text-[12px] text-ink-3">单指圈出问题，双指缩放照片</p>

      {(defects ?? []).length === 0 ? (
        <p className="mt-6 text-[15px] text-ink-2">这面墙有问题吗？圈出来。没有就点完成。</p>
      ) : (
        <ul className="mt-4">
          {(defects ?? []).map((d) => (
            <li key={d.id} className="border-t border-rule first:border-t-0">
              <div className="flex items-center gap-3 py-3">
                <span className="font-mono text-[13px] text-ink-2">
                  D-{String(d.seq).padStart(2, '0')}
                </span>
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left text-[15px]"
                  onClick={() => setEditTarget(d.id)}
                >
                  {PHENOMENON_LABELS[d.phenomenon]}
                  <span className="ml-2 text-[12px] text-ink-3">点一下可改</span>
                </button>
                <button
                  type="button"
                  className="text-[13px] text-ink-3"
                  onClick={() => deleteDefect(d.id).catch(() => toast('没删掉，请再试一次。'))}
                >
                  删除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-rule bg-paper">
        <div className="mx-auto max-w-[480px] px-5 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3">
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {PHENOMENON_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setSelectedPhen(k)}
                className={`shrink-0 rounded-doc border px-3 py-1.5 text-[13px] ${
                  selectedPhen === k ? 'border-accent bg-accent text-paper' : 'border-rule text-ink-2'
                }`}
              >
                {PHENOMENON_LABELS[k]}
              </button>
            ))}
          </div>
          <Button className="mt-3 w-full" onClick={() => navigate(`/case/${id}/capture/${roomId}`)}>
            完成
          </Button>
        </div>
      </div>

      <Sheet
        open={typePickerOpen}
        onClose={() => {
          setPendingRect(null)
          setEditTarget(null)
        }}
        title="这是什么问题？"
      >
        <ul>
          {PHENOMENON_KEYS.map((k) => (
            <li key={k} className="border-t border-rule first:border-t-0">
              <button
                type="button"
                className="w-full py-3.5 text-left text-[15px]"
                onClick={() => confirmPhenomenon(k)}
              >
                {PHENOMENON_LABELS[k]}
                {selectedPhen === k && <span className="ml-2 text-[12px] text-accent">当前选择</span>}
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
    </main>
  )
}

function safeTemplate(kind: Room['kind']) {
  try {
    return getRoomTemplate(kind)
  } catch {
    return null
  }
}
