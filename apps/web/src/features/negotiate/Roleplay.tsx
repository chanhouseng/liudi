// S16 谈判 · 模拟（FR-605）。AI 扮演房东，最多 3 轮，每轮给破绽点评；
// 总结的守住/让出计数由代码统计（数字不经 LLM）。人格开场白取自 CONTENT.md §6.1 原文。
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'

import { useCase } from '@/features/case/useCase'
import { useValuationInput } from '@/features/valuation/useValuationInput'
import {
  requestLandlordReply,
  wordingConfigured,
  type LandlordTurn,
  type Persona,
} from '@/lib/api/wording'
import { Button } from '@/ui/Button'
import { CasePageShell } from '../case/CasePageShell'
import { composeTemplate } from './compose'

const MAX_ROUNDS = 3

const PERSONAS: { value: Persona; label: string; note: string; opening: string }[] = [
  {
    value: 'pressure',
    label: '压价型',
    note: '最常见：咬住总价，整面重刷、不扣折旧、拿不出报价单',
    opening: '墙上有印子，我得重新刷一遍，材料加人工 1500，这不过分吧？',
  },
  {
    value: 'stall',
    label: '耍赖型',
    note: '拿「保持原样」当挡箭牌，把原状说成全新，回避具体条款',
    opening: '合同写了退租要保持原样，你现在这样就是违约，押金不退。',
  },
  {
    value: 'reasonable',
    label: '讲理型',
    note: '态度好，但不给具体项目和金额',
    opening: '我也不是要为难你，就是确实有损坏，我们各退一步。',
  },
]

interface Turn {
  role: 'landlord' | 'tenant'
  text: string
  flaw?: string
  stance?: 'hold' | 'concede' | 'shift'
}

export default function Roleplay() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const state = useCase(id)
  const { caseData, source, valuation } = useValuationInput(id)

  const [persona, setPersona] = useState<Persona | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [draft, setDraft] = useState('')

  const abortRef = useRef<AbortController | null>(null)
  const pendingRef = useRef<{ history: LandlordTurn[]; tenantText: string; round: number } | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const configured = wordingConfigured()

  const excerpt = useMemo(() => {
    const fromState = (location.state as { body?: unknown } | null)?.body
    if (typeof fromState === 'string' && fromState.trim() !== '') return fromState.slice(0, 2000)
    if (caseData && source && valuation) {
      return composeTemplate(
        { caseData, months: source.tenancyMonths, valuation, findings: source.findings },
        'neutral',
        'wechat',
      ).body.slice(0, 2000)
    }
    return '押金返还协商，请逐项核对扣款依据。'
  }, [location.state, caseData, source, valuation])

  useEffect(() => () => abortRef.current?.abort(), [])

  const tenantRounds = turns.filter((t) => t.role === 'tenant').length
  const finished = persona !== null && tenantRounds >= MAX_ROUNDS && status === 'idle'

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns.length, status])

  async function ask(p: { history: LandlordTurn[]; tenantText: string; round: number }) {
    if (!persona) return
    setStatus('loading')
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const reply = await requestLandlordReply(
      { persona, round: p.round, letterExcerpt: excerpt, history: p.history, tenantText: p.tenantText },
      controller.signal,
    )
    if (controller.signal.aborted) return
    if (reply === null) {
      setStatus('error')
      return
    }
    setTurns((ts) => {
      const next = ts.map((t, i) =>
        i === ts.length - 1 && t.role === 'tenant' ? { ...t, flaw: reply.flaw || undefined, stance: reply.stance } : t,
      )
      return [...next, { role: 'landlord', text: reply.reply }]
    })
    setStatus('idle')
  }

  function send() {
    const text = draft.trim()
    if (!text || !persona || status === 'loading' || finished) return
    const history: LandlordTurn[] = turns.map((t) => ({ role: t.role, text: t.text }))
    const round = turns.filter((t) => t.role === 'tenant').length + 1
    pendingRef.current = { history, tenantText: text, round }
    setTurns((ts) => [...ts, { role: 'tenant', text }])
    setDraft('')
    void ask({ history, tenantText: text, round })
  }

  function retry() {
    const p = pendingRef.current
    if (p) void ask(p)
  }

  function reset() {
    abortRef.current?.abort()
    setPersona(null)
    setTurns([])
    setStatus('idle')
    setDraft('')
    pendingRef.current = null
  }

  const holds = turns.filter((t) => t.role === 'tenant' && t.stance === 'hold').length
  const concedes = turns.filter((t) => t.role === 'tenant' && t.stance === 'concede').length

  return (
    <CasePageShell
      state={state}
      step={4}
      stepName="谈判"
      backTo={id ? `/case/${id}/negotiate` : '/'}
      backLabel="返回信件"
    >
      <p className="rounded-doc border border-rule bg-surface px-3 py-2.5 text-[13px] text-ink-2">
        AI 在扮演房东，练完就散，不会发出去。
      </p>

      {!configured ? (
        <div className="mt-6">
          <p className="text-[15px] text-ink-2">
            这个功能需要联网，当前用不了。你仍可以直接复制信件去沟通。
          </p>
          <Button variant="secondary" className="mt-4" onClick={() => navigate(`/case/${id}/negotiate`)}>
            返回信件
          </Button>
        </div>
      ) : persona === null ? (
        <div className="mt-5 space-y-3">
          <p className="text-[13px] text-ink-2">选一种房东，练 3 轮：</p>
          {PERSONAS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => {
                setPersona(p.value)
                setTurns([{ role: 'landlord', text: p.opening }])
              }}
              className="block w-full rounded-doc border border-rule bg-surface px-3.5 py-3 text-left hover:border-ink-2"
            >
              <span className="text-[15px] font-medium">{p.label}</span>
              <span className="mt-1 block text-[13px] text-ink-2">{p.note}</span>
              <span className="mt-1.5 block text-[13px] text-ink-3">「{p.opening}」</span>
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="mt-5 flex min-h-[45vh] flex-col gap-2.5">
            {turns.map((t, i) => (
              <div key={i} className={`max-w-[85%] ${t.role === 'tenant' ? 'self-end' : 'self-start'}`}>
                <div
                  className={`rounded-doc px-3.5 py-2.5 text-[15px] leading-relaxed ${
                    t.role === 'tenant' ? 'bg-accent text-white' : 'border border-rule bg-surface text-ink'
                  }`}
                >
                  {t.text}
                </div>
                {t.role === 'tenant' && t.flaw && (
                  <p className="mt-1 text-[12px] leading-relaxed text-ink-3">这句话的破绽：{t.flaw}</p>
                )}
              </div>
            ))}
            {status === 'loading' && (
              <p className="self-start text-[13px] text-ink-3">房东正在输入…</p>
            )}
            {status === 'error' && (
              <div className="self-start">
                <p className="text-[13px] text-ink-2">这句没接上：AI 没能回应。</p>
                <Button variant="secondary" className="mt-2" onClick={retry}>
                  重试
                </Button>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {finished ? (
            <div className="mt-4 border-t border-rule pt-4">
              <p className="text-[15px]">
                你守住了 {holds} 个关键点{concedes > 0 ? `，让出了 ${concedes} 个不该让的` : ''}。
              </p>
              <div className="mt-4 flex gap-3">
                <Button variant="secondary" className="flex-1" onClick={reset}>
                  重新练一遍
                </Button>
                <Button className="flex-1" onClick={() => navigate(`/case/${id}/negotiate`)}>
                  返回信件
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') send()
                }}
                placeholder="回房东一句"
                aria-label="回复房东"
                disabled={status === 'loading'}
                className="h-11 min-w-0 flex-1 rounded-doc border border-rule bg-surface px-3 text-[15px] text-ink placeholder:text-ink-3 focus:outline-ink disabled:opacity-40"
              />
              <Button onClick={send} loading={status === 'loading'}>
                发送
              </Button>
            </div>
          )}
        </>
      )}
    </CasePageShell>
  )
}
