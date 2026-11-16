import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate, useParams } from 'react-router'

import { findLegal, type LegalRef } from '@/content/legal'
import { CLS_LABELS, PHENOMENON_LABELS } from '@/content/vocab'
import { CONFIDENCE_WARN, judge } from '@/domain/rules'
import type { Finding, Judgement, JudgementClass } from '@/domain/types'
import { demoCase, demoFindings } from '@/demo/demoCase'
import { monthsBetween } from '@/lib/format'
import { db, listCaseFindings, type JudgementRow } from '@/lib/idb'
import { Badge } from '@/ui/Badge'
import { Button } from '@/ui/Button'
import { Rule } from '@/ui/Rule'
import { Sheet } from '@/ui/Sheet'
import { Skeleton } from '@/ui/Skeleton'
import { toast } from '@/ui/Toast'
import { CasePageShell } from '../case/CasePageShell'
import { useCase } from '../case/useCase'

type Tone = 'a' | 'b' | 'c'
const CLS_TONE: Record<JudgementClass, Tone> = { A: 'a', B: 'b', C: 'c' }
const CLS_KEYS: JudgementClass[] = ['A', 'B', 'C']

interface Row {
  finding: Finding
  ordinal: number
  roomLabel: string
  judgement: Judgement
  cls: JudgementClass
  needsConfirm: boolean
}

function toRows(list: JudgementRow[]): Row[] {
  return list
    .filter((r) => r.judgement !== undefined)
    .map((r, i) => {
      const j = r.judgement!
      const cls = j.overriddenByUser ? j.overriddenByUser.cls : j.cls
      return {
        finding: r.finding,
        ordinal: i + 1,
        roomLabel: r.roomLabel,
        judgement: j,
        cls,
        needsConfirm: j.confidence < CONFIDENCE_WARN && !j.overriddenByUser,
      }
    })
}

// 演示案例：内存里跑同一套规则引擎，展示 A/B/C 与待确认的真实分布。
function demoRows(): Row[] {
  const months = monthsBetween(demoCase.leaseStart, demoCase.leaseEnd)
  return demoFindings.map((f, i) => {
    const finding: Finding = {
      id: `demo-f-${i + 1}`,
      roomId: 'demo-room',
      photoOutId: 'demo-photo',
      bbox: [0, 0, 0, 0],
      phenomenon: f.phenomenon,
      surface: f.surface,
      severity: f.severity,
      needsRephoto: false,
    }
    const judgement = judge({ finding, hasMoveInEvidence: true, tenancyMonths: months })
    return {
      finding,
      ordinal: i + 1,
      roomLabel: f.slot,
      judgement,
      cls: judgement.cls,
      needsConfirm: judgement.confidence < CONFIDENCE_WARN,
    }
  })
}

function StatBar({ count, label, tone }: { count: number; label: string; tone: Tone | 'neutral' }) {
  const bar =
    tone === 'a'
      ? 'border-l-cls-a'
      : tone === 'b'
        ? 'border-l-cls-b'
        : tone === 'c'
          ? 'border-l-cls-c'
          : 'border-l-ink-3'
  return (
    <div className={`border-l-[3px] ${bar} pl-2`}>
      <p className="font-serif text-[20px] font-semibold tabular-nums">{count}</p>
      <p className="mt-0.5 text-[12px] text-ink-2">{label}</p>
    </div>
  )
}

export default function JudgementList() {
  const { id } = useParams()
  const navigate = useNavigate()
  const caseState = useCase(id)
  const isDemo = id === 'demo'

  const [overrideSheet, setOverrideSheet] = useState<number | null>(null)
  const [overrideCls, setOverrideCls] = useState<JudgementClass>('B')
  const [overrideNote, setOverrideNote] = useState('')
  const [savingOverride, setSavingOverride] = useState(false)
  const [legalRef, setLegalRef] = useState<LegalRef | null>(null)
  const [demoOverrides, setDemoOverrides] = useState<Record<string, { cls: JudgementClass; note?: string }>>({})

  const live = useLiveQuery(
    async () => (id && !isDemo ? await listCaseFindings(id) : []),
    [id, isDemo],
  )

  const rows: Row[] | undefined = useMemo(() => {
    if (isDemo) return demoRows().map((r) => {
      const o = demoOverrides[r.finding.id]
      if (!o) return r
      return {
        ...r,
        cls: o.cls,
        judgement: { ...r.judgement, overriddenByUser: { cls: o.cls, note: o.note, at: '' } },
        needsConfirm: false,
      }
    })
    return live === undefined ? undefined : toRows(live)
  }, [isDemo, live, demoOverrides])

  const stats = useMemo(() => {
    const list = rows ?? []
    return {
      a: list.filter((r) => r.cls === 'A').length,
      b: list.filter((r) => r.cls === 'B').length,
      c: list.filter((r) => r.cls === 'C').length,
      confirm: list.filter((r) => r.needsConfirm).length,
    }
  }, [rows])

  function openOverride(i: number) {
    const r = rows?.[i]
    if (!r) return
    setOverrideCls(r.cls)
    setOverrideNote(r.judgement.overriddenByUser?.note ?? '')
    setOverrideSheet(i)
  }

  async function saveOverride() {
    const r = overrideSheet === null ? undefined : rows?.[overrideSheet]
    if (!r) return
    if (isDemo) {
      setDemoOverrides((prev) => ({
        ...prev,
        [r.finding.id]: { cls: overrideCls, note: overrideNote || undefined },
      }))
      setOverrideSheet(null)
      return
    }
    setSavingOverride(true)
    try {
      await db.judgements.put({
        ...r.judgement,
        overriddenByUser: {
          cls: overrideCls,
          note: overrideNote || undefined,
          at: new Date().toISOString(),
        },
      })
      setOverrideSheet(null)
    } catch {
      toast('没存上，再试一次')
    } finally {
      setSavingOverride(false)
    }
  }

  return (
    <CasePageShell
      state={caseState}
      step={2}
      stepName="对比"
      backTo={`/case/${id}/compare`}
      backLabel="点位清单"
    >
      {rows === undefined ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-[15px] text-ink-2">先拍退租照片，才有得比。</p>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-2">
            <StatBar count={stats.a} label={`A ${CLS_LABELS.A}`} tone="a" />
            <StatBar count={stats.b} label={`B ${CLS_LABELS.B}`} tone="b" />
            <StatBar count={stats.c} label={`C ${CLS_LABELS.C}`} tone="c" />
            <StatBar count={stats.confirm} label="待确认" tone="neutral" />
          </div>

          <p className="mt-5 text-[13px] text-ink-2">
            判定由规则和法条完成，AI 不下结论。点徽章可以改判。
          </p>

          <div className="mt-1">
            {rows.map((r, i) => {
              const ov = r.judgement.overriddenByUser
              return (
                <div key={r.finding.id}>
                  <Rule className="mt-4" />
                  <div className="flex items-center gap-3 pt-3">
                    <span className="font-mono text-[13px] tracking-[0.02em] text-ink-3">
                      [ F-{String(r.ordinal).padStart(2, '0')} ]
                    </span>
                    <span className="flex-1 text-[15px]">
                      {r.roomLabel ? `${r.roomLabel} · ` : ''}
                      {PHENOMENON_LABELS[r.finding.phenomenon]}
                    </span>
                    <Badge tone={CLS_TONE[r.cls]} onClick={() => openOverride(i)}>
                      {r.cls} {CLS_LABELS[r.cls]}
                    </Badge>
                  </div>
                  <p className="mt-1.5 pl-0 text-[15px] leading-relaxed text-ink">
                    {r.judgement.reason}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    {r.judgement.legalRefs.map((key) => {
                      const ref = findLegal(key)
                      if (!ref) return null
                      return (
                        <button
                          key={key}
                          type="button"
                          className="text-[13px] text-accent underline underline-offset-4"
                          onClick={() => setLegalRef(ref)}
                        >
                          {ref.title}
                        </button>
                      )
                    })}
                    {r.needsConfirm ? (
                      <span className="ml-auto text-[13px] font-medium text-ink">
                        这条需要你自己确认
                      </span>
                    ) : (
                      <span className="ml-auto font-mono text-[13px] text-ink-3 tabular-nums">
                        置信度 {Math.round(r.judgement.confidence * 100)}%
                      </span>
                    )}
                  </div>
                  {ov && (
                    <p className="mt-1.5 text-[13px] text-ink-2">
                      已由你改为 {ov.cls} {CLS_LABELS[ov.cls]}
                      {ov.note ? ` · ${ov.note}` : ''}
                      <span className="text-ink-3">
                        （原判定 {r.judgement.ruleId}：{r.judgement.reason}）
                      </span>
                    </p>
                  )}
                </div>
              )
            })}
            <Rule className="mt-4" />
          </div>

          <Button className="mt-8 w-full" onClick={() => navigate(`/case/${id}/value`)}>
            生成定损单
          </Button>
          <p className="mt-3 text-center text-[12px] text-ink-3">本工具不构成法律意见。</p>
        </>
      )}

      <Sheet
        open={overrideSheet !== null}
        onClose={() => setOverrideSheet(null)}
        title={overrideSheet === null ? undefined : `[ F-${String(overrideSheet + 1).padStart(2, '0')} ]`}
      >
        {overrideSheet !== null && rows && (
          <div>
            <p className="text-[13px] text-ink-2">这条判成了什么，由你说了算。原判定会保留。</p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {CLS_KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setOverrideCls(k)}
                  className={`h-10 rounded-doc border text-[13px] ${
                    overrideCls === k ? 'border-accent text-accent' : 'border-rule text-ink-2'
                  }`}
                >
                  {k} {CLS_LABELS[k]}
                </button>
              ))}
            </div>
            <textarea
              value={overrideNote}
              onChange={(e) => setOverrideNote(e.target.value)}
              rows={3}
              placeholder="备注（选填），比如：这个洞是我挂电视打的"
              className="mt-3 w-full rounded-doc border border-rule bg-surface p-2.5 text-[15px] text-ink placeholder:text-ink-3 focus:border-ink-2 focus:outline-none"
            />
            <Button className="mt-3 w-full" loading={savingOverride} onClick={() => void saveOverride()}>
              保存
            </Button>
          </div>
        )}
      </Sheet>

      <Sheet open={legalRef !== null} onClose={() => setLegalRef(null)} title={legalRef?.title}>
        {legalRef && (
          <div>
            <blockquote className="border-l-2 border-rule pl-3 text-[15px] leading-relaxed text-ink">
              {legalRef.text}
            </blockquote>
            <p className="mt-3 text-[13px] text-ink-2">{legalRef.plain}</p>
            <p className="mt-4 text-[12px] text-ink-3">本工具不构成法律意见。</p>
          </div>
        )}
      </Sheet>
    </CasePageShell>
  )
}
