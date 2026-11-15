import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'

import { Button } from '@/ui/Button'
import { Skeleton } from '@/ui/Skeleton'

import type { CaseState } from './useCase'

interface CasePageShellProps {
  state: CaseState
  step: 1 | 2 | 3 | 4
  stepName: string
  backTo: string
  backLabel: string
  next?: { to: string; label: string }
  children: ReactNode
}

export function CasePageShell({
  state,
  step,
  stepName,
  backTo,
  backLabel,
  next,
  children,
}: CasePageShellProps) {
  const navigate = useNavigate()
  return (
    <main className="mx-auto min-h-dvh max-w-[480px] px-5 pb-10">
      {state.kind === 'loading' ? (
        <div className="space-y-4 pt-14">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : state.kind === 'error' ? (
        <div className="pt-14">
          <p className="text-ink-2">读取本地数据失败，可能是浏览器限制了存储。</p>
          <Button variant="secondary" className="mt-4" onClick={() => window.location.reload()}>
            重试
          </Button>
        </div>
      ) : state.kind === 'missing' ? (
        <div className="pt-14">
          <p className="text-ink-2">没有找到这个案件。</p>
          <Button variant="secondary" className="mt-4" onClick={() => navigate('/')}>
            回首页
          </Button>
        </div>
      ) : (
        <>
          <header className="flex items-baseline justify-between pt-8">
            <Link to={backTo} className="text-[13px] text-ink-2">
              ← {backLabel}
            </Link>
            <span className="font-mono text-[13px] tracking-[0.02em] text-ink-3">
              [ {String(step).padStart(2, '0')} ]
            </span>
          </header>
          <h1 className="mt-2 font-serif text-[22px] font-semibold">
            第 {step} 步 · {stepName}
          </h1>
          <div className="mt-6">{children}</div>
          {next && (
            <Button className="mt-10 w-full" onClick={() => navigate(next.to)}>
              {next.label}
            </Button>
          )}
        </>
      )}
    </main>
  )
}
