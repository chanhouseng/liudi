import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate, useParams } from 'react-router'

import { demoCase, demoFindings } from '@/demo/demoCase'
import { PHENOMENON_LABELS, SEVERITY_LABELS } from '@/content/vocab'
import { CasePageShell } from '@/features/case/CasePageShell'
import { useCase } from '@/features/case/useCase'
import { listCompareSlots, type CompareSlotRow } from '@/lib/idb'
import { formatYuan } from '@/lib/format'
import { Skeleton } from '@/ui/Skeleton'
import { Rule } from '@/ui/Rule'

function rowStatus(r: CompareSlotRow): { label: string; dim: boolean } {
  if (r.hasMoveIn && r.hasMoveOut) return { label: '可对比', dim: false }
  if (r.hasMoveIn) return { label: '待拍退租', dim: false }
  if (r.hasMoveOut) return { label: '缺入住底稿', dim: true }
  return { label: '未拍', dim: true }
}

function SlotList({ id, rows }: { id: string; rows: CompareSlotRow[] }) {
  const navigate = useNavigate()
  const hasAnyMoveIn = rows.some((r) => r.hasMoveIn)
  const done = rows.filter((r) => r.hasMoveIn && r.hasMoveOut).length

  if (!hasAnyMoveIn) {
    return (
      <div>
        <p className="text-ink-2">先拍退租照片，才有得比。</p>
        <button
          type="button"
          className="mt-4 text-[14px] text-accent underline underline-offset-4"
          onClick={() => navigate(`/case/${id}/capture`)}
        >
          去取证
        </button>
      </div>
    )
  }

  let lastRoom = ''
  return (
    <div>
      <p className="text-[13px] text-ink-2">
        已对齐 {done} / {rows.length} 处 · 逐个点位重拍退租照片
      </p>
      <Rule className="mt-3" />
      {rows.map((r, i) => {
        const roomHeader = r.roomLabel !== lastRoom ? r.roomLabel : null
        lastRoom = r.roomLabel
        const st = rowStatus(r)
        return (
          <div key={`${r.roomId}-${r.slotId}`}>
            {roomHeader && (
              <p className="mt-5 font-serif text-[16px] font-semibold text-ink-2">{roomHeader}</p>
            )}
            <button
              type="button"
              className="-mx-2 flex w-[calc(100%+16px)] items-baseline gap-3 border-b border-rule py-3 text-left"
              onClick={() => navigate(`/case/${id}/compare/${r.roomId}/${r.slotId}`)}
            >
              <span className="font-mono text-[13px] tracking-[0.02em] text-ink-3">
                [ {String(i + 1).padStart(2, '0')} ]
              </span>
              <span className="flex-1">{r.slotLabel}</span>
              <span className={st.dim ? 'text-[13px] text-ink-3' : 'text-[13px] text-accent'}>
                {st.label}
              </span>
            </button>
          </div>
        )
      })}
    </div>
  )
}

function DemoCompare() {
  return (
    <div>
      <p className="font-serif text-[17px] font-semibold">{demoCase.alias}</p>
      <p className="mt-1 text-[13px] text-ink-2">
        押金 {formatYuan(demoCase.deposit)} · 租期 {demoCase.leaseStart} 至 {demoCase.leaseEnd}
      </p>
      <Rule className="my-4" />
      <p className="text-[13px] text-ink-3">演示数据 · {demoFindings.length} 处差异</p>
      <div className="mt-1">
        {demoFindings.map((f) => (
          <div key={f.no} className="flex items-baseline gap-3 border-b border-rule py-2.5">
            <span className="font-mono text-[13px] text-ink-3">[ {f.no} ]</span>
            <span>{f.slot}</span>
            <span className="text-ink-2">
              {PHENOMENON_LABELS[f.phenomenon]} · {SEVERITY_LABELS[f.severity]}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function ComparePage() {
  const { id } = useParams()
  const state = useCase(id)
  const isDemo = id === 'demo'
  const rows = useLiveQuery(
    async () => (id && !isDemo ? await listCompareSlots(id) : []),
    [id, isDemo],
  )

  return (
    <CasePageShell
      state={state}
      step={2}
      stepName="对比"
      backTo={id ? `/case/${id}/capture` : '/'}
      backLabel="返回案件"
      next={id ? { to: `/case/${id}/value`, label: '下一步：定损' } : undefined}
    >
      {isDemo ? (
        <DemoCompare />
      ) : rows === undefined ? (
        <div className="space-y-3">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : (
        <SlotList id={id!} rows={rows} />
      )}
    </CasePageShell>
  )
}
