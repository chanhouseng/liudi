import { useParams } from 'react-router'

import { CasePageShell } from '@/features/case/CasePageShell'
import { useCase } from '@/features/case/useCase'

export default function ValuePage() {
  const { id } = useParams()
  const state = useCase(id)
  return (
    <CasePageShell
      state={state}
      step={3}
      stepName="定损"
      backTo={id ? `/case/${id}/capture` : '/'}
      backLabel="返回案件"
      next={id ? { to: `/case/${id}/negotiate`, label: '下一步：谈判' } : undefined}
    >
      <p className="text-ink-2">房东还没说扣多少？先把原话粘进来。</p>
    </CasePageShell>
  )
}
