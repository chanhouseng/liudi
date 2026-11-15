import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'

import { getRoomTemplate, type SlotTemplate } from '@/content/roomTemplates'
import type { Room, RoomKind } from '@/domain/types'
import { db, getRoomShotMap, type PhotoRecord } from '@/lib/idb'
import { Button } from '@/ui/Button'
import { Skeleton } from '@/ui/Skeleton'
import { Sheet } from '@/ui/Sheet'

interface RoomData {
  state: 'ok' | 'miss' | 'err'
  room?: Room
  tpl?: { label: string; slots: SlotTemplate[] }
  shot?: Map<string, PhotoRecord>
  thumbs?: Map<string, Blob>
}

function ThumbImg({ blob, alt }: { blob: Blob; alt: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url ? (
    <img
      src={url}
      alt={alt}
      className="size-12 shrink-0 rounded-doc border border-rule object-cover"
    />
  ) : (
    <span aria-hidden className="block size-12 shrink-0 rounded-doc bg-rule" />
  )
}

export default function SlotListPage() {
  const { id, roomId } = useParams()
  const navigate = useNavigate()
  const isDemo = id === 'demo'
  const [retryTick, setRetryTick] = useState(0)
  const [viewing, setViewing] = useState<{ slotId: string; label: string; url: string } | null>(
    null,
  )

  const demoKind = isDemo && roomId ? (roomId.replace(/^demo-/, '') as RoomKind) : null

  const data = useLiveQuery<RoomData>(async () => {
    if (!roomId) return { state: 'err' }
    try {
      const room = await db.rooms.get(roomId)
      if (!room) return { state: 'miss' }
      const tpl = getRoomTemplate(room.kind)
      const shot = await getRoomShotMap(roomId)
      const photoIds = [...shot.values()].map((p) => p.id)
      const thumbs = await db.thumbs.bulkGet(photoIds)
      const thumbMap = new Map<string, Blob>()
      photoIds.forEach((pid, i) => {
        const t = thumbs[i]
        if (t) thumbMap.set(pid, t.blob)
      })
      return { state: 'ok', room, tpl, shot, thumbs: thumbMap }
    } catch {
      return { state: 'err' }
    }
  }, [roomId, retryTick])

  if (isDemo) {
    const tpl = demoKind ? safeTemplate(demoKind) : null
    if (!tpl) {
      return (
        <main className="mx-auto min-h-dvh max-w-[480px] px-5 pt-14">
          <p className="text-ink-2">没有找到这个房间。</p>
          <Button variant="secondary" className="mt-4" onClick={() => navigate('/case/demo/capture')}>
            返回房间列表
          </Button>
        </main>
      )
    }
    const next = tpl.slots[0] ?? null
    return (
      <main className="mx-auto min-h-dvh max-w-[480px] px-5 pb-28">
        <header className="flex items-baseline justify-between pt-8">
          <Link to="/case/demo/capture" className="text-[13px] text-ink-2">
            ← 房间列表
          </Link>
          <span className="font-mono text-[13px] tracking-[0.02em] text-ink-3">[ 01 ]</span>
        </header>
        <div className="mt-2 flex items-baseline justify-between">
          <h1 className="font-serif text-[22px] font-semibold">{tpl.label}</h1>
          <span className="font-mono text-[13px] tabular-nums text-ink-2">
            已拍 0/{tpl.slots.length}
          </span>
        </div>
        <SlotRows
          slots={tpl.slots}
          shot={new Map()}
          thumbs={new Map()}
          onOpenCamera={(slotId) => navigate(`/case/demo/capture/${roomId}/${slotId}`)}
          onView={() => {}}
        />
        {next && (
          <BottomBar>
            <Button
              className="w-full"
              onClick={() => navigate(`/case/demo/capture/${roomId}/${next.id}`)}
            >
              拍下一个：{next.label}
            </Button>
          </BottomBar>
        )}
      </main>
    )
  }

  if (data === undefined) {
    return (
      <main className="mx-auto min-h-dvh max-w-[480px] px-5 pt-14">
        <Skeleton className="h-6 w-40" />
        <div className="mt-6 space-y-4">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      </main>
    )
  }

  if (data.state === 'err') {
    return (
      <main className="mx-auto min-h-dvh max-w-[480px] px-5 pt-14">
        <p className="text-ink-2">照片读取失败</p>
        <Button variant="secondary" className="mt-4" onClick={() => setRetryTick((n) => n + 1)}>
          重试
        </Button>
      </main>
    )
  }

  if (data.state === 'miss' || !data.room || !data.tpl) {
    return (
      <main className="mx-auto min-h-dvh max-w-[480px] px-5 pt-14">
        <p className="text-ink-2">没有找到这个房间。</p>
        <Button
          variant="secondary"
          className="mt-4"
          onClick={() => navigate(`/case/${id}/capture`)}
        >
          返回房间列表
        </Button>
      </main>
    )
  }

  const { room, tpl, shot, thumbs } = data
  const next = tpl.slots.find((s) => !shot!.has(s.id))
  const shotCount = shot!.size

  async function openView(p: PhotoRecord, label: string) {
    try {
      const full = await db.photos.get(p.id)
      const blob = full?.blob ?? thumbs?.get(p.id) ?? null
      if (!blob) return
      setViewing({ slotId: p.slot, label, url: URL.createObjectURL(blob) })
    } catch {
      setViewing(null)
    }
  }

  function closeView() {
    if (viewing) URL.revokeObjectURL(viewing.url)
    setViewing(null)
  }

  return (
    <main className="mx-auto min-h-dvh max-w-[480px] px-5 pb-28">
      <header className="flex items-baseline justify-between pt-8">
        <Link to={`/case/${id}/capture`} className="text-[13px] text-ink-2">
          ← 房间列表
        </Link>
        <span className="font-mono text-[13px] tracking-[0.02em] text-ink-3">[ 01 ]</span>
      </header>
      <div className="mt-2 flex items-baseline justify-between">
        <h1 className="font-serif text-[22px] font-semibold">{room.label}</h1>
        <span className="font-mono text-[13px] tabular-nums text-ink-2">
          已拍 {shotCount}/{tpl.slots.length}
        </span>
      </div>

      <SlotRows
        slots={tpl.slots}
        shot={shot!}
        thumbs={thumbs!}
        onOpenCamera={(slotId) => navigate(`/case/${id}/capture/${roomId}/${slotId}`)}
        onView={openView}
      />

      <BottomBar>
        {next ? (
          <Button className="w-full" onClick={() => navigate(`/case/${id}/capture/${roomId}/${next.id}`)}>
            拍下一个：{next.label}
          </Button>
        ) : (
          <Button variant="secondary" className="w-full" onClick={() => navigate(`/case/${id}/capture`)}>
            全部拍完，返回房间列表
          </Button>
        )}
      </BottomBar>

      <Sheet open={viewing !== null} onClose={closeView} title={viewing?.label}>
        {viewing && (
          <>
            <img
              src={viewing.url}
              alt={viewing.label}
              className="max-h-[50dvh] w-full rounded-doc border border-rule object-contain"
            />
            <div className="mt-4 flex gap-3">
              <Button
                className="flex-1"
                onClick={() => {
                  const slotId = viewing.slotId
                  closeView()
                  navigate(`/case/${id}/capture/${roomId}/${slotId}`)
                }}
              >
                重拍
              </Button>
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => {
                  const slotId = viewing.slotId
                  closeView()
                  navigate(`/case/${id}/capture/${roomId}/${slotId}/annotate`)
                }}
              >
                标瑕疵
              </Button>
              <Button variant="secondary" className="flex-1" onClick={closeView}>
                关闭
              </Button>
            </div>
          </>
        )}
      </Sheet>
    </main>
  )
}

function safeTemplate(kind: RoomKind) {  try {
    return getRoomTemplate(kind)
  } catch {
    return null
  }
}

function SlotRows({
  slots,
  shot,
  thumbs,
  onOpenCamera,
  onView,
}: {
  slots: SlotTemplate[]
  shot: Map<string, PhotoRecord>
  thumbs: Map<string, Blob>
  onOpenCamera: (slotId: string) => void
  onView: (photo: PhotoRecord, label: string) => void
}) {
  return (
    <ul className="mt-4">
      {slots.map((s) => {
        const photo = shot.get(s.id)
        const thumb = photo ? thumbs.get(photo.id) : undefined
        return (
          <li key={s.id} className="border-t border-rule first:border-t-0">
            <button
              type="button"
              className="flex w-full items-center gap-3 py-4 text-left"
              onClick={() => (photo ? onView(photo, s.label) : onOpenCamera(s.id))}
            >
              <span
                aria-hidden
                className={`size-2.5 shrink-0 rounded-full border ${
                  photo ? 'border-accent bg-accent' : 'border-ink-3 bg-transparent'
                }`}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px]">{s.label}</span>
                <span className="mt-0.5 block text-[13px] text-ink-3">{s.why}</span>
              </span>
              {thumb && <ThumbImg blob={thumb} alt={`${s.label} 已拍照片`} />}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function BottomBar({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-10 border-t border-rule bg-paper">
      <div className="mx-auto max-w-[480px] px-5 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3">
        {children}
      </div>
    </div>
  )
}
