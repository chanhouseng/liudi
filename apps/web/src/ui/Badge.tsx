import type { ReactNode } from 'react'

type BadgeTone = 'a' | 'b' | 'c' | 'alert' | 'neutral'

const toneBarClass: Record<BadgeTone, string> = {
  a: 'border-l-cls-a',
  b: 'border-l-cls-b',
  c: 'border-l-cls-c',
  alert: 'border-l-alert',
  neutral: 'border-l-ink-3',
}

interface BadgeProps {
  tone?: BadgeTone
  children: ReactNode
  onClick?: () => void
}

export function Badge({ tone = 'neutral', children, onClick }: BadgeProps) {
  const bar = `border-l-[3px] ${toneBarClass[tone]} py-0.5 pl-2 text-[13px] text-ink`
  if (!onClick) {
    return <span className={`inline-block ${bar}`}>{children}</span>
  }
  return (
    <button type="button" onClick={onClick} className={`inline-block cursor-pointer text-left ${bar}`}>
      {children}
    </button>
  )
}
