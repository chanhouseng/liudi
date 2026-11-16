import { describe, expect, it } from 'vitest'

import {
  FORBIDDEN_PHRASES,
  allowedSetFor,
  numberTokens,
  numbersWithin,
} from './numcheck'

describe('numberTokens', () => {
  it('¥ / ￥ / 千分位 / 小数归一', () => {
    expect(numberTokens('押金 ¥4,000，主张 3,200 元，折旧后 222.08')).toEqual([
      '4000',
      '3200',
      '222.08',
    ])
    expect(numberTokens('￥１２３')).not.toContain('１２３') // 全角数字不在集合语义内
  })

  it('无数字返回空', () => {
    expect(numberTokens('这项建议不付。')).toEqual([])
  })
})

describe('numbersWithin（FR-508 = FR-602）', () => {
  const allowed = new Set(['4000', '380', '235', '7'])

  it('集合内全部放行', () => {
    expect(numbersWithin('押金 4000 元，建议最多付 235 元，期限 7 天。', allowed)).toBe(true)
  })

  it('任一集合外即拒绝', () => {
    expect(numbersWithin('建议付 2000 元。', allowed)).toBe(false)
    expect(numbersWithin('折旧后 234.9 元。', allowed)).toBe(false)
  })

  it('无数字放行', () => {
    expect(numbersWithin('这项建议不付。', allowed)).toBe(true)
  })
})

describe('allowedSetFor', () => {
  it('分 → 元字面，计数直入', () => {
    const s = allowedSetFor(new Set(['x']), [23500, 400000], [7, 14])
    expect(s.has('235')).toBe(true)
    expect(s.has('4000')).toBe(true)
    expect(s.has('7')).toBe(true)
    expect(s.has('14')).toBe(true)
    expect(s.has('x')).toBe(true)
  })
})

describe('FORBIDDEN_PHRASES（产品立场红线）', () => {
  it('命中判决式 / 承诺式措辞', () => {
    for (const t of ['法院会判你赢', '一定能要回', '必赢', '保证退款', '百分百能退']) {
      expect(FORBIDDEN_PHRASES.test(t)).toBe(true)
    }
    expect(FORBIDDEN_PHRASES.test('按市场价和折旧，建议最多付 235 元。')).toBe(false)
  })
})
