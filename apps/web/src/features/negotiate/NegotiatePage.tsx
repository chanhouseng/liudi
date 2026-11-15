import { useParams } from 'react-router'

import { CasePageShell } from '@/features/case/CasePageShell'
import { useCase } from '@/features/case/useCase'

export default function NegotiatePage() {
  const { id } = useParams()
  const state = useCase(id)
  return (
    <CasePageShell
      state={state}
      step={4}
      stepName="谈判"
      backTo={id ? `/case/${id}/capture` : '/'}
      backLabel="返回案件"
    >
      <p className="text-ink-2">谈判信在定损后生成。</p>
    </CasePageShell>
  )
}
