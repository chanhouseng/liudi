import { describe, expect, it } from 'vitest'

import { monthsBetween } from './format'

describe('monthsBetween', () => {
  it('整月差：2025-09-01 → 2026-11-01 = 14', () => {
    expect(monthsBetween('2025-09-01', '2026-11-01')).toBe(14)
  })
  it('同月为 0；倒序不为负', () => {
    expect(monthsBetween('2026-11-01', '2026-11-15')).toBe(0)
    expect(monthsBetween('2026-11-01', '2025-09-01')).toBe(0)
  })
  it('跨年不足整月按已过月数计', () => {
    expect(monthsBetween('2025-12-01', '2026-01-20')).toBe(1)
  })
})
