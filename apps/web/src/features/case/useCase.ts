import { useLiveQuery } from 'dexie-react-hooks'

import type { Case } from '@/domain/types'
import { demoCase } from '@/demo/demoCase'
import { db } from '@/lib/idb'

export type CaseState =
  | { kind: 'loading' }
  | { kind: 'ok'; data: Case }
  | { kind: 'missing' }
  | { kind: 'error' }

export function useCase(id: string | undefined): CaseState {
  const result = useLiveQuery(async () => {
    if (id === 'demo') return { kind: 'ok' as const, data: demoCase }
    if (!id) return { kind: 'missing' as const }
    try {
      const c = await db.cases.get(id)
      return c ? { kind: 'ok' as const, data: c } : { kind: 'missing' as const }
    } catch {
      return { kind: 'error' as const }
    }
  }, [id])
  return result ?? { kind: 'loading' }
}
