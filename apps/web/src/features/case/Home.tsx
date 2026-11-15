import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate } from 'react-router'

import { formatYuan } from '@/lib/format'
import { listCaseSummaries } from '@/lib/idb'
import { Button } from '@/ui/Button'
import { Rule } from '@/ui/Rule'
import { Skeleton } from '@/ui/Skeleton'

function ProgressDot({ lit, label }: { lit: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 ${lit ? 'text-ink' : 'text-ink-3'}`}>
      <span aria-hidden className={`size-1.5 rounded-full ${lit ? 'bg-accent' : 'bg-rule'}`} />
      {label}
    </span>
  )
}

export default function Home() {
  const navigate = useNavigate()
  const data = useLiveQuery(async () => {
    try {
      return { kind: 'ok' as const, cases: await listCaseSummaries() }
    } catch {
      return { kind: 'error' as const }
    }
  }, [])

  return (
    <main className="mx-auto min-h-dvh max-w-[480px] px-5 pb-10">
      <h1 className="pt-14 font-serif text-2xl font-semibold">留底</h1>
      <p className="mt-1 text-[13px] text-ink-2">入住留个底，退租有底气</p>

      <p className="mt-12 font-serif text-[28px] font-semibold leading-snug">
        不帮你租房，只帮你要回押金。
      </p>

      <div className="mt-8 space-y-3">
        <Button className="w-full" onClick={() => navigate('/case/new')}>
          拍一份底稿
        </Button>
        <Button variant="secondary" className="w-full" onClick={() => navigate('/case/demo/compare')}>
          看一个例子
        </Button>
      </div>

      <Rule className="mt-10" />

      <section aria-label="进行中的案件">
        {data === undefined ? (
          <div className="space-y-4 py-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : data.kind === 'error' ? (
          <div className="py-4">
            <p className="text-ink-2">读取本地数据失败，可能是浏览器限制了存储。</p>
            <Button variant="secondary" className="mt-4" onClick={() => window.location.reload()}>
              重试
            </Button>
          </div>
        ) : data.cases.length === 0 ? (
          <p className="py-4 text-ink-2">还没有案件。先建一个，3 分钟。</p>
        ) : (
          <ul>
            {data.cases.map(({ data: c, progress }) => (
              <li key={c.id} className="border-b border-rule">
                <Link to={`/case/${c.id}/capture`} className="block py-3.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-serif text-[17px] font-semibold">{c.alias}</span>
                    <span className="text-[13px] tabular-nums text-ink-2">
                      押金 {formatYuan(c.deposit)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex gap-3 text-[13px]">
                    <ProgressDot lit={progress.capture} label="取证" />
                    <ProgressDot lit={progress.compare} label="对比" />
                    <ProgressDot lit={progress.value} label="定损" />
                    <ProgressDot lit={progress.negotiate} label="谈判" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="mt-10 text-[13px] text-ink-3">
        本工具不构成法律意见
        <span className="ml-3">隐私说明</span>
      </footer>
    </main>
  )
}
