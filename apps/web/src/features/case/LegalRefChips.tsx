import { useState } from 'react'

import { findLegal, type LegalRef } from '@/content/legal'
import { Sheet } from '@/ui/Sheet'

// 法条角标 + 原文展开。原文照抄 content/legal，点开只见原文和一句人话，不可改写。
export function LegalRefChips({ keys }: { keys: string[] }) {
  const [ref, setRef] = useState<LegalRef | null>(null)
  return (
    <>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {keys.map((k) => {
          const r = findLegal(k)
          if (!r) return null
          return (
            <button
              key={k}
              type="button"
              className="text-[13px] text-accent underline underline-offset-4"
              onClick={() => setRef(r)}
            >
              {r.title}
            </button>
          )
        })}
      </div>
      <Sheet open={ref !== null} onClose={() => setRef(null)} title={ref?.title}>
        {ref && (
          <div>
            <blockquote className="border-l-2 border-rule pl-3 text-[15px] leading-relaxed text-ink">
              {ref.text}
            </blockquote>
            <p className="mt-3 text-[13px] text-ink-2">{ref.plain}</p>
            <p className="mt-4 text-[12px] text-ink-3">本工具不构成法律意见。</p>
          </div>
        )}
      </Sheet>
    </>
  )
}
