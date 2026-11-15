import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react'

import { Skeleton } from './Skeleton'

interface TableProps {
  children: ReactNode
  loading?: boolean
  skeletonRows?: number
  skeletonCols?: number
}

export function Table({ children, loading, skeletonRows = 3, skeletonCols = 3 }: TableProps) {
  if (loading) {
    return (
      <table className="w-full border-collapse">
        <tbody>
          {Array.from({ length: skeletonRows }, (_, r) => (
            <tr key={r}>
              {Array.from({ length: skeletonCols }, (_, c) => (
                <td key={c} className="border-b border-rule py-2.5">
                  <Skeleton className="h-4 w-full max-w-32" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    )
  }
  return <table className="w-full border-collapse text-[13px] leading-relaxed">{children}</table>
}

export function Th({ children, className = '' }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th className={`border-b border-rule pt-0 pb-2 text-left align-bottom font-normal text-ink-2 ${className}`}>
      {children}
    </th>
  )
}

interface TdProps extends TdHTMLAttributes<HTMLTableCellElement> {
  num?: boolean
}

export function Td({ num = false, children, className = '', ...rest }: TdProps) {
  return (
    <td
      {...rest}
      className={`border-b border-rule py-2.5 align-top text-ink ${
        num ? 'text-right tabular-nums' : 'text-left'
      } ${className}`}
    >
      {children}
    </td>
  )
}
