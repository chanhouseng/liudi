import { Fragment, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router'

import { findPrice, type PriceItem } from '@/content/prices'
import { PHENOMENON_LABELS } from '@/content/vocab'
import { findLinkedFindings, legalRefsFor } from '@/domain/valuation'
import type { DeductionItem } from '@/domain/types'
import { formatYuan } from '@/lib/format'
import { Button } from '@/ui/Button'
import { Skeleton } from '@/ui/Skeleton'
import { CasePageShell } from '../case/CasePageShell'
import { LegalRefChips } from '../case/LegalRefChips'
import { useCase } from '../case/useCase'
import { suggest } from './suggest'
import { useValuationInput } from './useValuationInput'

function verdictLabel(item: DeductionItem, price: PriceItem | null): string {
  if (item.status === 'valid') return 'C'
  if (item.status === 'disputed') return '—'
  if (price === null || price.life === null) return '无依据'
  if (price.id === 'ac-gas') return 'B'
  return 'A / B'
}

function marketLine(price: PriceItem | null): string {
  if (!price) return '暂时没有参考价'
  return `${formatYuan(price.low)} – ${formatYuan(price.high)} / ${price.unit}${price.unverified ? ' · 待核价' : ''}`
}

function depreciationLine(item: DeductionItem, price: PriceItem | null): string {
  if (!price || price.life === null) return '不折旧'
  const months = Math.round(item.depreciation.years * 12)
  return `${months} 个月 ÷ ${price.life * 12} 个月，剩 ${Math.round(item.depreciation.residualRatio * 100)}%`
}

function DetailRow({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="w-8 shrink-0 text-ink-3">{k}</span>
      <span className="min-w-0 flex-1 text-ink">{children}</span>
    </div>
  )
}

// S14 定损 · 结果。deductions 表只存拆解条目，这里每次用最新判定现算（FR-508：建议层只读）。
export default function ValuationPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const state = useCase(id)
  const [expanded, setExpanded] = useState<string | null>(null)

  const { source, valuation: v } = useValuationInput(id)

  const headline =
    v === undefined
      ? ''
      : v.payable > 0
        ? `该赔的 ${v.payable / 100}，一分不少。`
        : v.disputed === 0
          ? '这些项目都站不住。'
          : '能定的还没定下来，先补同位置的照片判定。'

  const unmatchedCount = v?.items.filter((i) => !i.matchedPriceId).length ?? 0
  const disputedCount = v?.items.filter((i) => i.status === 'disputed').length ?? 0

  return (
    <CasePageShell
      state={state}
      step={3}
      stepName="定损"
      backTo={id ? `/case/${id}/value` : '/'}
      backLabel="改扣款"
      next={id ? { to: `/case/${id}/negotiate`, label: '生成谈判信' } : undefined}
    >
      {v === undefined ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : v.items.length === 0 ? (
        <div>
          <p className="text-[15px] text-ink-2">先粘贴房东的扣款消息。</p>
          <Button variant="secondary" className="mt-4" onClick={() => navigate(`/case/${id}/value`)}>
            去拆解
          </Button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 items-end gap-3 border-y border-rule py-4">
            <div>
              <p className="text-[12px] text-ink-2">应付</p>
              <p className="mt-1 font-serif text-[24px] font-semibold leading-none tabular-nums text-accent">
                {formatYuan(v.payable)}
              </p>
            </div>
            <div>
              <p className="text-[12px] text-ink-2">不应付</p>
              <p className="mt-1 font-serif text-[17px] font-semibold leading-none tabular-nums">
                {formatYuan(v.notPayable)}
              </p>
            </div>
            <div>
              <p className="text-[12px] text-ink-2">争议</p>
              <p className="mt-1 font-serif text-[17px] font-semibold leading-none tabular-nums">
                {formatYuan(v.disputed)}
              </p>
            </div>
          </div>
          <p className="mt-4 text-[15px]">{headline}</p>

          {unmatchedCount > 0 && (
            <p className="mt-3 text-[13px] text-ink-2">
              这 {unmatchedCount} 项暂时没有参考价，先按房东报价暂记。
            </p>
          )}
          {disputedCount > 0 && (
            <p className="mt-2 text-[13px] text-ink-2">
              争议 {formatYuan(v.disputed)}：补同位置的照片判定能自动定，或直接进谈判。
            </p>
          )}

          <table className="mt-5 w-full border-collapse text-[15px]">
            <thead>
              <tr className="border-b border-rule text-left text-[12px] font-normal text-ink-3">
                <th className="py-2">扣款项</th>
                <th className="py-2 text-right">房东</th>
                <th className="py-2 text-right">判定</th>
                <th className="py-2 text-right">应付</th>
              </tr>
            </thead>
            <tbody>
              {v.items.map((item) => {
                const price = item.matchedPriceId ? (findPrice(item.matchedPriceId) ?? null) : null
                const open = expanded === item.id
                const linked = findLinkedFindings(item.label, source?.findings ?? [])
                return (
                  <Fragment key={item.id}>
                    <tr
                      className="cursor-pointer border-b border-rule align-top"
                      onClick={() => setExpanded(open ? null : item.id)}
                    >
                      <td className="py-3 pr-2">{item.label}</td>
                      <td className="py-3 text-right">
                        <span className="font-serif tabular-nums">{formatYuan(item.amount)}</span>
                        {item.inflatedRatio !== undefined && (
                          <span className="mt-0.5 block text-[11px] text-alert">
                            高于市场 {item.inflatedRatio.toFixed(1)} 倍
                          </span>
                        )}
                      </td>
                      <td className="py-3 text-right text-[13px] text-ink-2">
                        {verdictLabel(item, price)}
                      </td>
                      <td className="py-3 text-right font-serif font-medium tabular-nums">
                        {item.status === 'valid' ? formatYuan(item.liableAmount) : '—'}
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-b border-rule">
                        <td colSpan={4} className="bg-surface px-3 py-3">
                          <div className="space-y-2.5 text-[13px] leading-relaxed">
                            <DetailRow k="现象">
                              {linked.length === 0
                                ? '没有同位置的照片判定。'
                                : linked.map((f) => PHENOMENON_LABELS[f.phenomenon]).join('、')}
                            </DetailRow>
                            <DetailRow k="定性">{item.reason}</DetailRow>
                            <DetailRow k="依据">
                              <LegalRefChips keys={legalRefsFor(item, price)} />
                            </DetailRow>
                            <DetailRow k="市场">{marketLine(price)}</DetailRow>
                            <DetailRow k="折旧">{depreciationLine(item, price)}</DetailRow>
                            <DetailRow k="建议">
                              {suggest({ item, price, tenancyMonths: source?.tenancyMonths ?? 0 })}
                            </DetailRow>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>

          <p className="mt-10 text-center text-[12px] text-ink-3">本工具不构成法律意见。</p>
        </>
      )}
    </CasePageShell>
  )
}
