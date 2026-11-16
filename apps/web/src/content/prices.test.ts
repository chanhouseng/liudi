import { describe, expect, it } from 'vitest'

import { findPrice, PRICES } from './prices'

describe('PRICES · 完整性（T21 验收）', () => {
  it('30 项，id 唯一', () => {
    expect(PRICES).toHaveLength(30)
    expect(new Set(PRICES.map((p) => p.id)).size).toBe(30)
  })

  it('金额为正整数分，low ≤ mid ≤ high', () => {
    for (const p of PRICES) {
      for (const v of [p.low, p.mid, p.high]) {
        expect(Number.isInteger(v)).toBe(true)
        expect(v).toBeGreaterThan(0)
      }
      expect(p.low).toBeLessThanOrEqual(p.mid)
      expect(p.mid).toBeLessThanOrEqual(p.high)
    }
  })

  it('life 为 null（不折旧）或正整数年', () => {
    for (const p of PRICES) {
      if (p.life !== null) {
        expect(Number.isInteger(p.life)).toBe(true)
        expect(p.life).toBeGreaterThan(0)
      }
    }
    expect(findPrice('carpet-clean')?.life).toBeNull()
    expect(findPrice('ac-gas')?.life).toBeNull()
    expect(findPrice('lock-set')?.life).toBe(8)
  })

  it('当前全部待核价：source 空、unverified true（CONTENT §4 核价后同步更新本测试）', () => {
    for (const p of PRICES) {
      expect(p.unverified).toBe(true)
      expect(p.source).toBe('')
    }
  })

  it('updatedAt 为 ISO 日期', () => {
    for (const p of PRICES) {
      expect(p.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('findPrice 命中演示用项（折旧口径与 CONTENT §4 一致）', () => {
    const lock = findPrice('lock-set')
    expect(lock?.mid).toBe(26_000)
  })
})
