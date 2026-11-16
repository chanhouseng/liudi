// S14/S15/S16 共用：从 demo 或 IndexedDB 取案件输入，现算定损（deductions 表只存拆解条目）。
import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'

import { PRICES } from '@/content/prices'
import { parseDeductions, type ParsedDeduction } from '@/domain/parse'
import { judge } from '@/domain/rules'
import { computeValuation } from '@/domain/valuation'
import type { Case, CaseValuation, Finding, Judgement } from '@/domain/types'
import { demoCase, demoDeductionText, demoFindings } from '@/demo/demoCase'
import { monthsBetween } from '@/lib/format'
import { db, getCase, listCaseFindings } from '@/lib/idb'

export interface ValuationSource {
  deposit: number
  tenancyMonths: number
  parsed: ParsedDeduction[]
  findings: Finding[]
  judgements: Judgement[]
}

// 演示案例：内存里跑真实拆解 + 定损引擎，与判定页同一套判定结果。
function useDemoSource(): ValuationSource {
  return useMemo(() => {
    const months = monthsBetween(demoCase.leaseStart, demoCase.leaseEnd)
    const findings: Finding[] = demoFindings.map((f, i) => ({
      id: `demo-f-${i + 1}`,
      roomId: 'demo-room',
      photoOutId: 'demo-photo',
      bbox: [0, 0, 0, 0],
      phenomenon: f.phenomenon,
      surface: f.surface,
      severity: f.severity,
      needsRephoto: false,
    }))
    const judgements = findings.map((f) =>
      judge({ finding: f, hasMoveInEvidence: true, tenancyMonths: months }),
    )
    return {
      deposit: demoCase.deposit,
      tenancyMonths: months,
      parsed: parseDeductions(demoDeductionText).items,
      findings,
      judgements,
    }
  }, [])
}

export function useValuationInput(id: string | undefined): {
  caseData: Case | undefined
  source: ValuationSource | undefined
  valuation: CaseValuation | undefined
} {
  const isDemo = id === 'demo'
  const demoSource = useDemoSource()

  const live = useLiveQuery(async () => {
    if (!id || isDemo) return null
    const caseData = await getCase(id)
    const rows = await listCaseFindings(id)
    const deductionRows = await db.deductions.where('caseId').equals(id).toArray()
    return { caseData, rows, deductionRows }
  }, [id, isDemo])

  const source: ValuationSource | undefined = useMemo(() => {
    if (isDemo) return demoSource
    if (!live) return undefined
    const findings = live.rows.map((r) => r.finding)
    const judgements = live.rows.flatMap((r) => (r.judgement ? [r.judgement] : []))
    return {
      deposit: live.caseData?.deposit ?? 0,
      tenancyMonths: live.caseData
        ? monthsBetween(live.caseData.leaseStart, live.caseData.leaseEnd)
        : 0,
      parsed: live.deductionRows.map((r) => ({ rawText: r.rawText, label: r.label, amountFen: r.amount })),
      findings,
      judgements,
    }
  }, [isDemo, demoSource, live])

  const valuation = useMemo(
    () =>
      source === undefined
        ? undefined
        : computeValuation({ caseId: id ?? 'demo', ...source }, PRICES),
    [source, id],
  )

  const caseData: Case | undefined = isDemo ? demoCase : (live?.caseData ?? undefined)

  return { caseData, source, valuation }
}
