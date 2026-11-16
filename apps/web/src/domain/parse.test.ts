import { describe, expect, it } from 'vitest'

import { parseDeductions } from './parse'

// FR-502 验收原文：DEMO.md §1.1 房东扣款消息（逐字）
const DEMO_MESSAGE = [
  '房子我看了，问题不少：',
  '1. 墙面到处是印子和钉眼，要整面重新刷，材料加人工 1400',
  '2. 保洁没做干净，我另外请人打扫 600',
  '3. 门锁不好转，换锁 400',
  '4. 空调不制冷，加氟 300',
  '5. 凉席、床单、热水壶都不见了，算 500',
  '一共 3200，剩下的我转你。',
].join('\n')

describe('parseDeductions · 演示消息（FR-502）', () => {
  const r = parseDeductions(DEMO_MESSAGE)

  it('拆出 5 条，合计 3200 元', () => {
    expect(r.items).toHaveLength(5)
    expect(r.items.reduce((s, i) => s + i.amountFen, 0)).toBe(320_000)
  })

  it('各条金额与顺序对得上', () => {
    expect(r.items.map((i) => i.amountFen)).toEqual([140_000, 60_000, 40_000, 30_000, 50_000])
  })

  it('名目可读、不带序号和金额', () => {
    expect(r.items.map((i) => i.label)).toEqual([
      '墙面到处是印子和钉眼，要整面重新刷，材料加人工',
      '保洁没做干净，我另外请人打扫',
      '门锁不好转，换锁',
      '空调不制冷，加氟',
      '凉席、床单、热水壶都不见了',
    ])
  })

  it('总数行识别为 statedTotalFen，不混进条目', () => {
    expect(r.statedTotalFen).toBe(320_000)
    expect(r.items.some((i) => i.label.includes('一共'))).toBe(false)
  })
})

describe('parseDeductions · 金额写法', () => {
  it('SCREENS 占位例：一行三个裸数字拆成三条', () => {
    const r = parseDeductions('墙面有印子要重刷 1400，保洁 600，门锁 400')
    expect(r.items.map((i) => [i.label, i.amountFen])).toEqual([
      ['墙面有印子要重刷', 140_000],
      ['保洁', 60_000],
      ['门锁', 40_000],
    ])
  })

  it('¥ / 元 / 块 后缀混排', () => {
    const r = parseDeductions('墙面重刷¥1400，保洁600元，换锁400块')
    expect(r.items.map((i) => i.amountFen)).toEqual([140_000, 60_000, 40_000])
    expect(r.items.map((i) => i.label)).toEqual(['墙面重刷', '保洁', '换锁'])
  })

  it('千分位与小数（元 → 分，四舍五入）', () => {
    expect(parseDeductions('重刷墙面 1,400 元').items[0]?.amountFen).toBe(140_000)
    expect(parseDeductions('重刷 600.5元').items[0]?.amountFen).toBe(60_050)
  })

  it('块钱后接汉字不误判量词：3 块地板只留 300', () => {
    const r = parseDeductions('3 块地板 300')
    expect(r.items).toHaveLength(1)
    expect(r.items[0]?.amountFen).toBe(30_000)
  })

  it('日期量词后的数字不算金额', () => {
    const r = parseDeductions('11月8日退租，保洁 600')
    expect(r.items).toHaveLength(1)
    expect(r.items[0]?.amountFen).toBe(60_000)
  })

  it('押金/租金后的数字不是扣款', () => {
    const r = parseDeductions('押金 4000 里扣 500')
    expect(r.items).toHaveLength(1)
    expect(r.items[0]?.amountFen).toBe(50_000)
  })

  it('超过 100 万的数字丢弃（防编号/串号）', () => {
    expect(parseDeductions('赔 99999999').items).toHaveLength(0)
  })
})

describe('parseDeductions · 结构与边界', () => {
  it('三种序号写法都剥掉', () => {
    const r = parseDeductions('1）墙面 500\n2、保洁 300\n一、门锁 200')
    expect(r.items.map((i) => [i.amountFen, i.rawText.startsWith('墙') || i.rawText.startsWith('保') || i.rawText.startsWith('门')])).toEqual([
      [50_000, true],
      [30_000, true],
      [20_000, true],
    ])
  })

  it('只有总数没有条目', () => {
    const r = parseDeductions('一共 3200，剩下的我转你。')
    expect(r.items).toHaveLength(0)
    expect(r.statedTotalFen).toBe(320_000)
  })

  it('没有金额：空结果、无总数', () => {
    const r = parseDeductions('房子我看了，问题不少：')
    expect(r.items).toHaveLength(0)
    expect(r.statedTotalFen).toBeNull()
  })

  it('光有金额没有名目：label 兜底', () => {
    const r = parseDeductions('1400')
    expect(r.items[0]?.label).toBe('未注明名目')
    expect(r.items[0]?.amountFen).toBe(140_000)
  })

  it('rawText 不超 500 字（FR-501）', () => {
    const long = `${'墙面坏了'.repeat(200)} 300`
    const r = parseDeductions(long)
    expect(r.items).toHaveLength(1)
    expect(r.items[0]?.rawText.length).toBeLessThanOrEqual(500)
  })

  it('条目上限 20 条', () => {
    const many = Array.from({ length: 25 }, (_, n) => `项目${n} ${100 + n}元`).join('\n')
    expect(parseDeductions(many).items).toHaveLength(20)
  })

  it('多行总数取最后一个', () => {
    const r = parseDeductions('合计 3000\n重算：一共 3200')
    expect(r.statedTotalFen).toBe(320_000)
  })
})
