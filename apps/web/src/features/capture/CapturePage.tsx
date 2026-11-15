import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'

import { getRoomTemplate, ROOM_TEMPLATES } from '@/content/roomTemplates'
import type { Room, RoomKind } from '@/domain/types'
import { demoCase } from '@/demo/demoCase'
import { addRoomToCase, getRoomShotMap, listRooms } from '@/lib/idb'
import { Button } from '@/ui/Button'
import { Skeleton } from '@/ui/Skeleton'
import { Sheet } from '@/ui/Sheet'
import { toast } from '@/ui/Toast'

interface RoomRow {
  room: Room
  shot: number
  total: number
  nextLabel: string | null
}

type CaptureData = { ok: true; rows: RoomRow[] } | { ok: false }

function Ring({ done, total }: { done: number; total: number }) {
  const r = 10
  const c = 2 * Math.PI * r
  const frac = total === 0 ? 0 : done / total
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden className="shrink-0">
      <circle cx="14" cy="14" r={r} fill="none" stroke="var(--rule)" strokeWidth="2" />
      {frac > 0 && (
        <circle
          cx="14"
          cy="14"
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeDasharray={`${c * frac} ${c}`}
          transform="rotate(-90 14 14)"
        />
      )}
    </svg>
  )
}

function demoRows(): RoomRow[] {
  return ROOM_TEMPLATES.map((t) => ({
    room: { id: `demo-${t.kind}`, caseId: demoCase.id, kind: t.kind, label: t.label },
    shot: 0,
    total: t.slots.length,
    nextLabel: t.slots[0]?.label ?? null,
  }))
}

export default function CapturePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isDemo = id === 'demo'
  const [retryTick, setRetryTick] = useState(0)
  const [adding, setAdding] = useState(false)

  const data = useLiveQuery<CaptureData>(async () => {
    if (!id) return { ok: false }
    try {
      const rooms = await listRooms(id)
      const rows = await Promise.all(
        rooms.map(async (room) => {
          const shot = await getRoomShotMap(room.id)
          const tpl = getRoomTemplate(room.kind)
          const next = tpl.slots.find((s) => !shot.has(s.id))
          return {
            room,
            shot: shot.size,
            total: tpl.slots.length,
            nextLabel: next?.label ?? null,
          }
        }),
      )
      return { ok: true, rows }
    } catch {
      return { ok: false }
    }
  }, [id, retryTick])

  const rows = isDemo ? demoRows() : data?.ok ? data.rows : null
  const shotTotal = rows?.reduce((n, r) => n + r.shot, 0) ?? 0
  const slotTotal = rows?.reduce((n, r) => n + r.total, 0) ?? 0

  return (
    <main className="mx-auto min-h-dvh max-w-[480px] px-5 pb-10">
      {rows === null && !isDemo && data === undefined ? (
        <div className="space-y-4 pt-14">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : rows === null && !isDemo ? (
        <div className="pt-14">
          <p className="text-ink-2">照片读取失败</p>
          <Button
            variant="secondary"
            className="mt-4"
            onClick={() => setRetryTick((n) => n + 1)}
          >
            重试
          </Button>
        </div>
      ) : (
        <>
          <header className="flex items-baseline justify-between pt-8">
            <Link to="/" className="text-[13px] text-ink-2">
              ← 首页
            </Link>
            <span className="font-mono text-[13px] tracking-[0.02em] text-ink-3">[ 01 ]</span>
          </header>
          <div className="mt-2 flex items-baseline justify-between">
            <h1 className="font-serif text-[22px] font-semibold">第 1 步 · 取证</h1>
            <span className="font-mono text-[13px] tabular-nums text-ink-2">
              已拍 {shotTotal}/{slotTotal}
            </span>
          </div>

          <div className="mt-4">
            {rows!.length === 0 && (
              <p className="py-6 text-ink-2">这个案件还没有房间，先在下面添加。</p>
            )}
            {rows!.map((r) => {
              return (
                <Link
                  key={r.room.id}
                  to={`/case/${id}/capture/${r.room.id}`}
                  className="block border-t border-rule py-5"
                >
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <h2 className="font-serif text-[17px] font-semibold">{r.room.label}</h2>
                        <span className="font-mono text-[13px] tabular-nums text-ink-2">
                          已拍 {r.shot}/{r.total}
                        </span>
                      </div>
                      <p className="mt-1 text-[13px] text-ink-3">
                        {r.nextLabel ? `下一个：${r.nextLabel}` : '这个房间拍完了'}
                      </p>
                    </div>
                    <Ring done={r.shot} total={r.total} />
                  </div>
                </Link>
              )
            })}
          </div>

          {!isDemo && (
            <Button variant="secondary" className="mt-4 w-full" onClick={() => setAdding(true)}>
              + 添加房间
            </Button>
          )}

          {!isDemo && rows!.length > 0 && rows!.every((r) => r.shot === r.total) && (
            <Button className="mt-4 w-full" onClick={() => navigate(`/case/${id}/deed`)}>
              生成底稿
            </Button>
          )}

          <p className="mt-6 text-[13px] leading-relaxed text-ink-3">
            照片存在你自己的手机里，不会自动上传。
          </p>
        </>
      )}

      <AddRoomSheet
        open={adding}
        onClose={() => setAdding(false)}
        onPick={async (kind) => {
          if (!id) return
          try {
            await addRoomToCase(id, kind)
            setAdding(false)
          } catch {
            setAdding(false)
            toast('没加上，请再试一次。')
          }
        }}
      />
    </main>
  )
}

function AddRoomSheet({
  open,
  onClose,
  onPick,
}: {
  open: boolean
  onClose: () => void
  onPick: (kind: RoomKind) => void
}) {
  return (
    <Sheet open={open} onClose={onClose} title="添加房间">
      <ul>
        {ROOM_TEMPLATES.map((t) => (
          <li key={t.kind} className="border-t border-rule first:border-t-0">
            <button
              type="button"
              className="flex w-full items-baseline justify-between py-3.5 text-left"
              onClick={() => onPick(t.kind)}
            >
              <span className="text-[15px]">{t.label}</span>
              <span className="font-mono text-[13px] tabular-nums text-ink-3">
                {t.slots.length} 个点位
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  )
}
