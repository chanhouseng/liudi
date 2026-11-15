import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'

import { DEFAULT_ROOM_KINDS } from '@/content/roomTemplates'
import { PHENOMENON_LABELS } from '@/content/vocab'
import { SEND_SCRIPT } from '@/content/scripts'
import type { Case, ID } from '@/domain/types'
import { formatYuan } from '@/lib/format'
import { getCase, db, listRooms } from '@/lib/idb'
import { verifyChain } from '@/lib/hash'
import { Button } from '@/ui/Button'
import { Sheet } from '@/ui/Sheet'
import { Skeleton } from '@/ui/Skeleton'
import { Stat } from '@/ui/Stat'
import { toast } from '@/ui/Toast'
import { assembleDeed, type DeedModel } from '@/features/export/deedModel'
import { exportDeedPdf } from '@/features/export/deedPdf'
import { downloadBlob, renderShareImage } from '@/features/export/shareImage'
import { hashShort, timeLabel } from '@/features/export/deedCanvas'

type DeedQuery =
  | { state: 'ok'; c: Case; model: DeedModel; thumbs: Map<ID, Blob>; brokenPNo: number | null }
  | { state: 'miss' }
  | { state: 'err' }

function nowLabel(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function Deed() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [retryTick, setRetryTick] = useState(0)
  const [expanded, setExpanded] = useState<ID | null>(null)
  const [exporting, setExporting] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [share, setShare] = useState<{ url: string; blob: Blob } | null>(null)

  const data = useLiveQuery<DeedQuery>(async () => {
    if (!id) return { state: 'err' }
    try {
      const c = await getCase(id)
      if (!c) return { state: 'miss' }
      const rooms = await listRooms(id)
      const roomIds = rooms.map((r) => r.id)
      const captures = roomIds.length
        ? await db.captures.where('roomId').anyOf(roomIds).toArray()
        : []
      const moveIn = captures.filter((cp) => cp.phase === 'move_in')
      const photos = moveIn.length
        ? await db.photos.where('captureId').anyOf(moveIn.map((cp) => cp.id)).toArray()
        : []
      const photoIds = photos.map((p) => p.id)
      const defects = photoIds.length
        ? await db.defects.where('photoId').anyOf(photoIds).toArray()
        : []
      const thumbs = photoIds.length ? await db.thumbs.bulkGet(photoIds) : []
      const thumbMap = new Map<ID, Blob>()
      photoIds.forEach((pid, i) => {
        const t = thumbs[i]
        if (t) thumbMap.set(pid, t.blob)
      })
      const model = assembleDeed(c, rooms, moveIn, photos, defects, [
        ...DEFAULT_ROOM_KINDS,
      ])
      const verify = await verifyChain(model.chained)
      const brokenPNo = verify.ok ? null : model.chained[verify.breakIndex]?.pNo ?? null
      return { state: 'ok', c, model, thumbs: thumbMap, brokenPNo }
    } catch {
      return { state: 'err' }
    }
  }, [id, retryTick])

  async function photoBlobs(model: DeedModel): Promise<(Blob | null)[]> {
    return Promise.all(model.photos.map(async (p) => (await db.photos.get(p.id))?.blob ?? null))
  }

  async function doExport() {
    if (!data || data.state !== 'ok' || !id) return
    setExporting(true)
    try {
      const blobs = await photoBlobs(data.model)
      await exportDeedPdf(
        {
          caseData: data.c,
          model: data.model,
          generatedAt: nowLabel(),
          brokenPNo: data.brokenPNo,
        },
        data.model.photos.map((p) => p.id),
        blobs,
      )
      toast('PDF 已导出')
    } catch {
      toast('导出没成功，请再试一次。')
    } finally {
      setExporting(false)
    }
  }

  async function doShare() {
    if (!data || data.state !== 'ok') return
    setSharing(true)
    try {
      const blobs = await photoBlobs(data.model)
      const blob = await renderShareImage(
        {
          caseData: data.c,
          model: data.model,
          generatedAt: nowLabel(),
          brokenPNo: data.brokenPNo,
        },
        data.model.photos.map((p) => p.id),
        blobs,
      )
      setShare({ url: URL.createObjectURL(blob), blob })
    } catch {
      toast('长图没生成，请再试一次。')
    } finally {
      setSharing(false)
    }
  }

  if (data === undefined) {
    return (
      <main className="mx-auto min-h-dvh max-w-[480px] px-5 pt-14">
        <Skeleton className="h-6 w-40" />
        <p className="mt-4 text-[13px] text-ink-3">正在生成证据链…</p>
        <div className="mt-6 space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
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

  if (data.state === 'miss') {
    return (
      <main className="mx-auto min-h-dvh max-w-[480px] px-5 pt-14">
        <p className="text-ink-2">没有找到这个案件。</p>
        <Button variant="secondary" className="mt-4" onClick={() => navigate('/')}>
          返回首页
        </Button>
      </main>
    )
  }

  const { c, model, thumbs, brokenPNo } = data
  const brokenId = brokenPNo !== null ? model.chained.find((p) => p.pNo === brokenPNo)?.id : null

  return (
    <main className="mx-auto min-h-dvh max-w-[480px] px-5 pb-28">
      <header className="flex items-center justify-between pt-8">
        <Link to={`/case/${id}/capture`} className="text-[13px] text-ink-2">
          ← 取证
        </Link>
        <span className="font-mono text-[13px] tracking-[0.02em] text-ink-3">[ 01 ]</span>
      </header>
      <div className="mt-2 flex items-baseline justify-between">
        <h1 className="font-serif text-[22px] font-semibold">房屋底稿</h1>
        <Button loading={exporting} className="px-4" onClick={doExport}>
          导出 PDF
        </Button>
      </div>

      {brokenPNo !== null && (
        <div
          role="alert"
          className="mt-4 flex items-center justify-between gap-3 rounded-doc border border-alert px-3 py-2.5"
        >
          <span className="text-[13px] text-alert">有 1 张照片的校验没通过，可能被修改过</span>
          <button
            type="button"
            className="shrink-0 text-[13px] text-alert underline"
            onClick={() =>
              document
                .getElementById(`photo-${brokenId}`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }
          >
            定位到该张
          </button>
        </div>
      )}

      {/* 封面区 */}
      <section className="border-t border-rule pt-5">
        <div className="flex items-baseline justify-between">
          <h2 className="font-serif text-[24px] font-semibold">{c.alias}</h2>
          <span className="font-mono text-[13px] text-ink-3">{model.caseNo}</span>
        </div>
        <dl className="mt-3 text-[14px]">
          {(
            [
              ['租期', `${c.leaseStart} 至 ${c.leaseEnd}`],
              ['押金', formatYuan(c.deposit)],
              ['生成时间', nowLabel()],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between border-b border-rule py-2.5">
              <dt className="text-ink-2">{k}</dt>
              <dd className="font-mono tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* 摘要 */}
      <section className="border-t border-rule py-5">
        <div className="grid grid-cols-3 gap-4">
          <Stat label="照片" value={String(model.photos.length)} />
          <Stat label="瑕疵" value={String(model.defects.length)} />
          <Stat label="断链" value={brokenPNo !== null ? '1' : '0'} />
        </div>
      </section>

      {/* 照片墙 */}
      <section className="border-t border-rule py-5">
        <h2 className="font-serif text-[17px] font-semibold">照片墙</h2>
        {model.photos.length === 0 && (
          <p className="mt-3 text-[14px] text-ink-2">这个房间还没拍。</p>
        )}
        {model.byRoom.map((g) => (
          <div key={g.roomLabel} className="mt-4">
            <h3 className="text-[14px] text-ink-2">{g.roomLabel}</h3>
            <div className="mt-2 grid grid-cols-2 gap-3">
              {g.photos.map((p) => (
                <figure key={p.id} id={`photo-${p.id}`}>
                  <Thumb blob={thumbs.get(p.id)} alt={p.slotLabel} />
                  <figcaption className="mt-1 font-mono text-[11px] leading-relaxed text-ink-3">
                    <span className="text-accent">[P-{String(p.pNo).padStart(2, '0')}]</span>{' '}
                    {p.slotLabel}
                    <br />
                    {timeLabel(p.takenAt)} {hashShort(p.chainHash || p.sha256)}
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* 瑕疵清单 */}
      <section className="border-t border-rule py-5">
        <h2 className="font-serif text-[17px] font-semibold">瑕疵清单</h2>
        {model.defects.length === 0 ? (
          <p className="mt-3 text-[14px] text-ink-2">无</p>
        ) : (
          <ul className="mt-2">
            {model.defects.map((d) => {
              const p = model.photos.find((pp) => pp.pNo === d.pNo)
              return (
                <li key={d.id} className="flex items-center gap-3 border-b border-rule py-3">
                  <span className="w-12 shrink-0 font-mono text-[13px] text-accent">
                    D-{String(d.seq).padStart(2, '0')}
                  </span>
                  <span className="min-w-0 flex-1 text-[14px]">
                    {d.roomLabel} · {d.slotLabel}
                    <span className="ml-2 text-ink-2">{PHENOMENON_LABELS[d.phenomenon]}</span>
                  </span>
                  {p && <DefectThumb blob={thumbs.get(p.id)} bbox={d.bbox} alt={d.slotLabel} />}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* 哈希链 */}
      <section className="border-t border-rule py-5">
        <h2 className="font-serif text-[17px] font-semibold">哈希链</h2>
        {model.chained.length === 0 ? (
          <p className="mt-3 text-[14px] text-ink-2">尚无入链照片。</p>
        ) : (
          <table className="mt-2 w-full border-collapse font-mono text-[11px]">
            <thead>
              <tr className="text-left text-ink-3">
                <th className="py-2 font-normal">#</th>
                <th className="py-2 font-normal">照片</th>
                <th className="py-2 font-normal">sha256</th>
                <th className="py-2 font-normal">chainHash</th>
              </tr>
            </thead>
            <tbody>
              {model.chained.map((p) => {
                const open = expanded === p.id
                return (
                  <tr
                    key={p.id}
                    className="cursor-pointer border-t border-rule align-top"
                    onClick={() => setExpanded(open ? null : p.id)}
                  >
                    <td className="py-2 tabular-nums text-ink-3">{p.pNo}</td>
                    <td className="py-2 text-accent">P-{String(p.pNo).padStart(2, '0')}</td>
                    <td className="py-2 break-all">
                      {open ? p.sha256 : p.sha256.slice(0, 12) || '—'}
                    </td>
                    <td className="py-2 break-all">{open ? p.chainHash : p.chainHash.slice(0, 12)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* 声明区 */}
      <section className="border-t border-rule py-5">
        <p className="text-[13px] leading-relaxed text-ink-2">
          本底稿用于记录房屋交付时的状态，不构成法律意见。
        </p>
      </section>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-rule bg-paper">
        <div className="mx-auto max-w-[480px] px-5 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3">
          <Button loading={sharing} className="w-full" onClick={doShare}>
            发给房东确认
          </Button>
        </div>
      </div>

      <ShareSheet
        share={share}
        onClose={() => {
          if (share) URL.revokeObjectURL(share.url)
          setShare(null)
        }}
      />
    </main>
  )
}

function useObjectUrl(blob: Blob | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!blob) {
      setUrl(null)
      return
    }
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url
}

function Thumb({ blob, alt }: { blob: Blob | undefined; alt: string }) {
  const url = useObjectUrl(blob)
  return url ? (
    <img src={url} alt={alt} className="aspect-[4/3] w-full rounded-doc border border-rule object-cover" />
  ) : (
    <span aria-hidden className="block aspect-[4/3] w-full rounded-doc bg-rule" />
  )
}

function DefectThumb({
  blob,
  bbox,
  alt,
}: {
  blob: Blob | undefined
  bbox: [number, number, number, number]
  alt: string
}) {
  const url = useObjectUrl(blob)
  return (
    <span className="relative block size-14 shrink-0 overflow-hidden rounded-doc border border-rule">
      {url && <img src={url} alt={alt} className="size-full object-cover" />}
      <span
        aria-hidden
        className="absolute border-2 border-accent"
        style={{
          left: `${bbox[0] * 100}%`,
          top: `${bbox[1] * 100}%`,
          width: `${bbox[2] * 100}%`,
          height: `${bbox[3] * 100}%`,
        }}
      />
    </span>
  )
}

function ShareSheet({
  share,
  onClose,
}: {
  share: { url: string; blob: Blob } | null
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!share) setCopied(false)
  }, [share])
  return (
    <Sheet open={share !== null} onClose={onClose} title="发给房东">
      {share && (
        <>
          <img
            src={share.url}
            alt="底稿长图"
            className="max-h-[40dvh] w-full rounded-doc border border-rule object-contain"
          />
          <p className="mt-3 border-t border-rule pt-3 text-[14px] leading-relaxed text-ink-2">
            {SEND_SCRIPT}
          </p>
          <div className="mt-4 flex gap-3">
            <Button
              className="flex-1"
              onClick={() => {
                downloadBlob(share.blob, '底稿-确认页.jpg')
                toast('长图已保存，去微信发给房东。')
              }}
            >
              保存长图
            </Button>
            <Button
              variant="secondary"
              className="flex-1"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(SEND_SCRIPT)
                  setCopied(true)
                  toast('话术已复制')
                } catch {
                  toast('没复制上，长按话术文字手动复制。')
                }
              }}
            >
              {copied ? '已复制' : '复制话术'}
            </Button>
          </div>
        </>
      )}
    </Sheet>
  )
}
