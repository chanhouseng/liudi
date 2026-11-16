import { useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'

import { parseDeductions } from '@/domain/parse'
import { parsedToItems } from '@/domain/valuation'
import { CasePageShell } from '@/features/case/CasePageShell'
import { useCase } from '@/features/case/useCase'
import { formatYuan } from '@/lib/format'
import { db } from '@/lib/idb'
import { Button } from '@/ui/Button'
import { fieldControlClass } from '@/ui/Field'
import { toast } from '@/ui/Toast'

interface PreviewItem {
  rawText: string
  label: string
  amountFen: number
}

type Phase = 'idle' | 'running' | 'done' | 'fail'

// S13 定损 · 输入。拆完落 deductions 表（只存拆解条目，估值在 S14 现算），对得上总数就直接跳 S14。
export default function ParsePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const state = useCase(id)

  const [draft, setDraft] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [items, setItems] = useState<PreviewItem[]>([])
  const [statedTotalFen, setStatedTotalFen] = useState<number | null>(null)
  const [manualOpen, setManualOpen] = useState(false)
  const [manualLabel, setManualLabel] = useState('')
  const [manualAmount, setManualAmount] = useState('')

  const taRef = useRef<HTMLTextAreaElement | null>(null)

  const autoSize = () => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`
  }

  const sumFen = items.reduce((s, i) => s + i.amountFen, 0)

  // 落库 + 跳 S14。演示案件不落库，S14 用预置消息现算。
  async function commitAndGo(list: PreviewItem[]) {
    if (id && id !== 'demo') {
      try {
        await db.transaction('rw', [db.deductions], async () => {
          await db.deductions.where('caseId').equals(id).delete()
          await db.deductions.bulkPut(
            parsedToItems(
              id,
              list.map((i) => ({ rawText: i.rawText, label: i.label, amountFen: i.amountFen })),
            ),
          )
        })
      } catch {
        toast('没存上，再试一次')
        return
      }
    }
    toast(`拆出 ${list.length} 条，合计 ${formatYuan(list.reduce((s, i) => s + i.amountFen, 0))}`)
    navigate(`/case/${id}/value/result`)
  }

  async function startParse() {
    const text = draft.trim()
    if (text === '' || phase === 'running') return
    setPhase('running')

    const r = parseDeductions(text)
    let parsed: PreviewItem[] = r.items.map((i) => ({
      rawText: i.rawText,
      label: i.label,
      amountFen: i.amountFen,
    }))
    const total = r.statedTotalFen
    const sum = parsed.reduce((s, i) => s + i.amountFen, 0)

    // FR-502：正则空手或与总数对不上，才走 LLM；LLM 结果必须过总和校验，不过回退正则。
    // extract 客户端动态 import：zod 跟着进懒加载块，不占初始 JS。
    const needLlm = parsed.length === 0 || (total !== null && sum !== total)
    if (needLlm && (import.meta.env.VITE_EXTRACT_API ?? '') !== '') {
      const { requestExtract } = await import('@/lib/api/extract')
      const llm = await requestExtract(text.slice(0, 2000))
      if (llm && llm.length > 0) {
        const sumL = llm.reduce((s, i) => s + i.amountFen, 0)
        if (total === null || sumL === total) parsed = llm.map((i) => ({ rawText: '', ...i }))
      }
    }

    setStatedTotalFen(total)
    setItems(parsed)
    if (parsed.length === 0) {
      setPhase('fail')
      setManualOpen(true)
      return
    }
    // 总数对不上时留在本页，让人看清差在哪、手动补；对得上就直接进定损单（S13 → S14）。
    if (total === null || sum === total) {
      setPhase('done')
      await commitAndGo(parsed)
      return
    }
    setPhase('done')
  }

  function addManual() {
    const label = manualLabel.trim()
    const amount = Number(manualAmount.replace(/,/g, ''))
    if (label === '') {
      toast('先写名目，比如：墙面重刷')
      return
    }
    if (!Number.isFinite(amount) || amount < 0.01) {
      toast('金额没看懂，填个数字，单位元')
      return
    }
    setItems((prev) => [...prev, { rawText: '', label, amountFen: Math.round(amount * 100) }])
    setManualLabel('')
    setManualAmount('')
    setPhase('done')
  }

  const totalNote =
    statedTotalFen === null ? null : sumFen === statedTotalFen
      ? `房东说的总数是 ${formatYuan(statedTotalFen)}，拆出来对得上。`
      : `房东说的总数是 ${formatYuan(statedTotalFen)}，拆出合计 ${formatYuan(sumFen)}，差 ${formatYuan(Math.abs(sumFen - statedTotalFen))}。可以手动补一条。`

  return (
    <CasePageShell
      state={state}
      step={3}
      stepName="定损"
      backTo={id ? `/case/${id}/judge` : '/'}
      backLabel="判定列表"
      next={id ? { to: `/case/${id}/value/result`, label: '下一步：定损' } : undefined}
    >
      <section>
        <h2 className="font-serif text-[17px] font-semibold">房东说要扣多少？</h2>
        <textarea
          ref={taRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            autoSize()
          }}
          maxLength={2000}
          rows={4}
          placeholder={'把房东的微信原话粘进来，比如：\n墙面有印子要重刷 1400，保洁 600，门锁 400'}
          className="mt-3 w-full resize-none overflow-hidden rounded-doc border border-rule bg-surface px-3 py-2.5 text-[15px] leading-relaxed text-ink placeholder:text-ink-3 focus:border-accent"
        />
        <p className="mt-1.5 text-[13px] text-ink-3">{draft.length}/2000 字</p>
        <Button className="mt-4 w-full" loading={phase === 'running'} disabled={draft.trim() === ''} onClick={startParse}>
          开始拆解
        </Button>
        {phase === 'running' && <p className="mt-3 text-[13px] text-ink-2">正在拆成一条一条…</p>}
        {phase === 'fail' && (
          <p className="mt-3 text-[13px] text-ink-2">这段没看懂，你可以手动加几条。</p>
        )}
      </section>

      <section className="mt-8">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[13px] text-ink-2">或者手动一条条加</h2>
          <button
            type="button"
            className="text-[13px] text-accent underline underline-offset-2"
            onClick={() => setManualOpen((v) => !v)}
          >
            {manualOpen ? '收起' : '手动添加'}
          </button>
        </div>
        {manualOpen && (
          <div className="mt-3 space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-[13px] text-ink-2">名目</span>
              <input
                value={manualLabel}
                onChange={(e) => setManualLabel(e.target.value)}
                placeholder="比如：墙面重刷"
                className={fieldControlClass}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] text-ink-2">金额（元）</span>
              <input
                value={manualAmount}
                onChange={(e) => setManualAmount(e.target.value)}
                inputMode="decimal"
                placeholder="比如：1400"
                className={fieldControlClass}
              />
            </label>
            <Button variant="secondary" className="w-full" onClick={addManual}>
              添加这一条
            </Button>
          </div>
        )}
      </section>

      {phase === 'done' && items.length > 0 && (
        <section className="mt-8">
          <ul>
            {items.map((item, idx) => (
              <li key={`${item.label}-${idx}`} className="flex items-baseline justify-between border-b border-rule py-3">
                <span className="mr-3 min-w-0 flex-1 text-[15px] text-ink">
                  <span className="mr-2 font-mono text-[12px] tracking-[0.02em] text-ink-3">
                    [ {String(idx + 1).padStart(2, '0')} ]
                  </span>
                  {item.label}
                </span>
                <span className="font-serif text-[15px] font-medium tabular-nums">
                  {formatYuan(item.amountFen)}
                </span>
                <button
                  type="button"
                  className="ml-3 text-[13px] text-ink-3 underline underline-offset-2"
                  onClick={() => setItems((prev) => prev.filter((_, n) => n !== idx))}
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-4 font-serif text-[15px] font-semibold tabular-nums">
            拆出 {items.length} 条，合计 {formatYuan(sumFen)}
          </p>
          {totalNote && <p className="mt-2 text-[13px] text-ink-2">{totalNote}</p>}
          <Button className="mt-4 w-full" onClick={() => void commitAndGo(items)}>
            拿这几条去定损
          </Button>
        </section>
      )}

      <p className="mt-10 text-center text-[12px] text-ink-3">本工具不构成法律意见。</p>
    </CasePageShell>
  )
}
