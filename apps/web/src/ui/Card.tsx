import type { ReactNode } from 'react'

import { Skeleton } from './Skeleton'

interface CardProps {
  no?: number
  title?: string
  loading?: boolean
  children: ReactNode
}

export function Card({ no, title, loading, children }: CardProps) {
  return (
    <section className="border-t border-rule py-5">
      {(no !== undefined || title) && (
        <header className="mb-3 flex items-baseline gap-2.5">
          {no !== undefined && (
            <span className="font-mono text-[13px] tracking-[0.02em] text-ink-3">
              [ {String(no).padStart(2, '0')} ]
            </span>
          )}
          {title && <h2 className="font-serif text-[17px] font-semibold leading-snug">{title}</h2>}
        </header>
      )}
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : (
        children
      )}
    </section>
  )
}
