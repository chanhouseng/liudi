import type { ReactNode } from 'react'

import { Skeleton } from './Skeleton'

export const fieldControlClass =
  'w-full rounded-doc border border-rule bg-surface px-3 py-2.5 text-[15px] text-ink tabular-nums placeholder:text-ink-3 focus:border-accent disabled:cursor-not-allowed disabled:opacity-40'

interface FieldProps {
  label: string
  hint?: string
  error?: string
  loading?: boolean
  disabled?: boolean
  children: ReactNode
}

export function Field({ label, hint, error, loading, disabled, children }: FieldProps) {
  return (
    <div className={disabled ? 'opacity-40' : ''}>
      <label className="block">
        <span className="mb-1.5 block text-[13px] text-ink-2">{label}</span>
        {loading ? <Skeleton className="h-11 w-full" /> : children}
      </label>
      {error ? (
        <p role="alert" className="mt-1.5 text-[13px] text-alert">
          {error}
        </p>
      ) : (
        hint && <p className="mt-1.5 text-[13px] text-ink-3">{hint}</p>
      )}
    </div>
  )
}
