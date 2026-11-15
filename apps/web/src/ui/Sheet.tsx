import { useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'

import { Skeleton } from './Skeleton'

interface SheetProps {
  open: boolean
  onClose: () => void
  title?: string
  loading?: boolean
  children: ReactNode
}

export function Sheet({ open, onClose, title, loading, children }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const startY = useRef<number | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  if (!open) return null

  const onPointerDown = (e: ReactPointerEvent) => {
    startY.current = e.clientY
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    if (startY.current === null || !panelRef.current) return
    const dy = Math.max(0, e.clientY - startY.current)
    panelRef.current.style.transform = `translateY(${dy}px)`
  }

  const onPointerUp = (e: ReactPointerEvent) => {
    if (startY.current === null) return
    const dy = Math.max(0, e.clientY - startY.current)
    startY.current = null
    if (panelRef.current) panelRef.current.style.transform = ''
    if (dy > 60) onClose()
  }

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 mx-auto max-w-[480px] rounded-t-doc border-t border-rule bg-surface p-5 pb-8 focus:outline-none"
      >
        <div
          className="-mx-5 -mt-5 mb-4 cursor-grab px-5 pt-4 pb-2 touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <div aria-hidden className="mx-auto h-1 w-10 rounded-full bg-rule" />
        </div>
        {title && <h2 className="mb-3 font-serif text-[17px] font-semibold">{title}</h2>}
        {loading ? <Skeleton className="h-24 w-full" /> : children}
      </div>
    </div>
  )
}
