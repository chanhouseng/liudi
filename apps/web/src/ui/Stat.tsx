import type { ReactNode } from 'react'

import { Skeleton } from './Skeleton'

interface StatProps {
  label: string
  value: ReactNode
  note?: string
  loading?: boolean
  size?: 'md' | 'lg'
}

export function Stat({ label, value, note, loading, size = 'md' }: StatProps) {
  return (
    <div>
      <p className="text-[13px] text-ink-2">{label}</p>
      {loading ? (
        <Skeleton className={`mt-1 ${size === 'lg' ? 'h-10 w-28' : 'h-7 w-20'}`} />
      ) : (
        <p
          className={`mt-1 font-serif font-semibold leading-none tabular-nums ${
            size === 'lg' ? 'text-[40px]' : 'text-[28px]'
          }`}
        >
          {value}
        </p>
      )}
      {note && <p className="mt-1.5 text-[13px] text-ink-3">{note}</p>}
    </div>
  )
}
