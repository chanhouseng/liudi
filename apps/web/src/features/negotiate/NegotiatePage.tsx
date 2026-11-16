// S15 谈判 · 生成（FR-601/602/603/604/607）。模板先行且必须完整；
// AI 只润色说明段，校验不过静默回退（用户无感，见 compose.ts）。
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'

import { LETTER_CHANNELS, LETTER_TONES, type Channel, type Tone } from '@/content/letterTemplates'
import { useCase } from '@/features/case/useCase'
import { useValuationInput } from '@/features/valuation/useValuationInput'
import { db } from '@/lib/idb'
import { Button } from '@/ui/Button'
import { Skeleton } from '@/ui/Skeleton'
import { toast } from '@/ui/Toast'
import { CasePageShell } from '../case/CasePageShell'
import { composeTemplate, composeWithAi, type ComposeInput } from './compose'

function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div>
      <p className="text-[12px] text-ink-3">{label}</p>
      <div className="mt-1.5 flex" role="radiogroup" aria-label={label}>
        {options.map((o, i) => {
          const active = o.value === value
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(o.value)}
              className={`h-9 flex-1 rounded-doc border text-[13px] ${
                active ? 'border-accent bg-accent text-white' : 'border-rule bg-surface text-ink-2'
              } ${i > 0 ? '-ml-px' : ''}`}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// FR-607：iOS / Android 都能用的复制；clipboard API 失败回退 execCommand。
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}

export default function NegotiatePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const state = useCase(id)
  const { caseData, source, valuation } = useValuationInput(id)

  const [tone, setTone] = useState<Tone>('neutral')
  const [channel, setChannel] = useState<Channel>('wechat')
  const [polishedBody, setPolishedBody] = useState<string | null>(null)
  const [draft, setDraft] = useState<string | null>(null)

  const input: ComposeInput | undefined = useMemo(
    () =>
      caseData && source && valuation
        ? {
            caseData,
            months: source.tenancyMonths,
            valuation,
            findings: source.findings,
          }
        : undefined,
    [caseData, source, valuation],
  )

  const template = useMemo(
    () => (input ? composeTemplate(input, tone, channel) : undefined),
    [input, tone, channel],
  )

  useEffect(() => {
    setPolishedBody(null)
    setDraft(null)
  }, [tone, channel])

  useEffect(() => {
    if (!input) return
    let cancelled = false
    const controller = new AbortController()
    composeWithAi(input, tone, channel, controller.signal).then((letter) => {
      if (!cancelled && letter.polished) setPolishedBody(letter.body)
    })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [input, tone, channel])

  const body = draft ?? polishedBody ?? template?.body ?? ''

  async function copyBody() {
    if (!template) return
    const ok = await copyText(body)
    if (!ok) {
      toast('复制失败，长按正文手动复制')
      return
    }
    toast('已复制全文')
    if (id && id !== 'demo') {
      await db.letters.put({
        id: crypto.randomUUID(),
        caseId: id,
        tone,
        channel,
        subject: template.subject,
        body,
        citations: template.citations,
        createdAt: new Date().toISOString(),
      })
    }
  }

  return (
    <CasePageShell
      state={state}
      step={4}
      stepName="谈判"
      backTo={id ? `/case/${id}/value/result` : '/'}
      backLabel="回定损"
    >
      {template === undefined ? (
        <div className="space-y-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : valuation !== undefined && valuation.items.length === 0 ? (
        <div>
          <p className="text-[15px] text-ink-2">房东还没说扣多少？先把原话粘进来。</p>
          <Button variant="secondary" className="mt-4" onClick={() => navigate(`/case/${id}/value`)}>
            去拆解扣款
          </Button>
        </div>
      ) : (
        <>
          <Segmented options={LETTER_TONES} value={tone} onChange={setTone} label="语气" />
          <div className="mt-3" />
          <Segmented options={LETTER_CHANNELS} value={channel} onChange={setChannel} label="渠道" />

          <textarea
            value={body}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            aria-label="信件全文，可修改"
            className="mt-4 min-h-[340px] w-full rounded-doc border border-rule bg-surface p-3 font-mono text-[13px] leading-relaxed text-ink focus:outline-ink"
          />

          {template.citations.length > 0 && (
            <p className="mt-2 font-mono text-[12px] text-ink-3">
              引用证据：{template.citations.map((c) => `${c.evidenceId} ${c.caption}`).join(' · ')}
            </p>
          )}

          <div className="mt-5 flex gap-3">
            <Button className="flex-1" onClick={copyBody}>
              复制全文
            </Button>
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => navigate(`/case/${id}/negotiate/roleplay`, { state: { body } })}
            >
              先练一遍
            </Button>
          </div>

          <p className="mt-8 text-center text-[12px] text-ink-3">本工具不构成法律意见。</p>
        </>
      )}
    </CasePageShell>
  )
}
