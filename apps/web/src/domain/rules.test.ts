import { describe, expect, it } from 'vitest'

import type { Defect, Finding, Surface } from './types'
import { CONFIDENCE_WARN, iouBBoxes, judge, MATCH_IOU_THRESHOLD } from './rules'

let seqCounter = 0

function mkFinding(over: Partial<Finding> = {}): Finding {
  seqCounter++
  return {
    id: `f-${seqCounter}`,
    roomId: 'room-1',
    photoOutId: 'photo-out',
    bbox: [0.2, 0.2, 0.4, 0.4],
    phenomenon: 'stain',
    surface: 'wall',
    severity: 'moderate',
    needsRephoto: false,
    ...over,
  }
}

function mkDefect(over: Partial<Defect> = {}): Defect {
  seqCounter++
  return {
    id: `d-${seqCounter}`,
    photoId: 'photo-in',
    bbox: [0.2, 0.2, 0.4, 0.4],
    phenomenon: 'stain',
    source: 'manual',
    confidence: 1,
    seq: 3,
    ...over,
  }
}

interface EvidenceOpts {
  matchedDefect?: Defect
  tenancyMonths?: number
}

function clsOf(f: Finding, over: EvidenceOpts = {}) {
  return judge({
    finding: f,
    hasMoveInEvidence: true,
    tenancyMonths: over.tenancyMonths ?? 14,
    matchedDefect: over.matchedDefect,
  })
}

describe('iouBBoxes', () => {
  it('identical boxes → 1', () => {
    expect(iouBBoxes([0, 0, 1, 1], [0, 0, 1, 1])).toBeCloseTo(1)
  })
  it('disjoint boxes → 0', () => {
    expect(iouBBoxes([0, 0, 0.2, 0.2], [0.5, 0.5, 0.8, 0.8])).toBe(0)
  })
  it('containment → 0.5；错开半格 → 1/3', () => {
    // [0,0,1,1] 与 [0,0,1,0.5]：交 0.5，并 1
    expect(iouBBoxes([0, 0, 1, 1], [0, 0, 1, 0.5])).toBeCloseTo(0.5)
    // [0,0,1,1] 与 [0.5,0,1.5,1]：交 0.5，并 1.5
    expect(iouBBoxes([0, 0, 1, 1], [0.5, 0, 1.5, 1])).toBeCloseTo(1 / 3)
  })
  it('A-01 阈值语义：IoU 0.4 命中、0.3 不命中（> 0.35 严格）', () => {
    // 单位方格对 [0,0,1,h]：IoU = h
    expect(iouBBoxes([0, 0, 1, 1], [0, 0, 1, 0.4])).toBeCloseTo(0.4)
    expect(iouBBoxes([0, 0, 1, 1], [0, 0, 1, 0.3])).toBeCloseTo(0.3)
    expect(MATCH_IOU_THRESHOLD).toBe(0.35)
    expect(0.4 > MATCH_IOU_THRESHOLD).toBe(true)
    expect(0.3 > MATCH_IOU_THRESHOLD).toBe(false)
  })
})

describe('A-01 底稿同位置瑕疵', () => {
  it('matchedDefect 存在 → A，理由含 D-xx，即使现象严重', () => {
    const j = clsOf(mkFinding({ severity: 'severe', phenomenon: 'hole' }), {
      matchedDefect: mkDefect({ seq: 3 }),
    })
    expect(j.cls).toBe('A')
    expect(j.ruleId).toBe('A-01')
    expect(j.reason).toContain('D-03')
    expect(j.legalRefs).toContain('civil-733')
    expect(j.confidence).toBeCloseTo(0.95 * 1.0 * 0.7)
  })
  it('AI 高置信度抬高 A-01 置信度', () => {
    const j = clsOf(mkFinding({ aiConfidence: 0.9 }), { matchedDefect: mkDefect() })
    expect(j.confidence).toBeCloseTo(0.95 * (0.6 + 0.4 * 0.9))
    expect(j.confidence).toBeGreaterThan(CONFIDENCE_WARN)
  })
})

describe('B 类规则', () => {
  it('B-01 dirt + wall，无泼洒措辞 → B', () => {
    const j = clsOf(mkFinding({ phenomenon: 'dirt', surface: 'wall' }))
    expect(j.cls).toBe('B')
    expect(j.ruleId).toBe('B-01')
    expect(j.legalRefs).toEqual(['civil-710'])
  })
  it('B-01 描述含泼洒 → 不命中，保守落到 A-02（C）', () => {
    const j = clsOf(
      mkFinding({ phenomenon: 'dirt', surface: 'floor', aiDescription: '深色液体泼洒痕迹，边缘锐利' }),
    )
    expect(j.ruleId).not.toBe('B-01')
    expect(j.cls).toBe('C')
  })
  it('B-02 discolor + wall → B', () => {
    const j = clsOf(mkFinding({ phenomenon: 'discolor', surface: 'wall' }))
    expect(j.ruleId).toBe('B-02')
    expect(j.cls).toBe('B')
  })
  it('B-02 描述含霉斑 → 不命中（保守 C）', () => {
    const j = clsOf(
      mkFinding({ phenomenon: 'discolor', surface: 'wall', aiDescription: '泛黄并伴霉斑，局部扩散' }),
    )
    expect(j.ruleId).not.toBe('B-02')
    expect(j.cls).toBe('C')
  })
  it('B-03 scratch + floor + light → B', () => {
    const j = clsOf(mkFinding({ phenomenon: 'scratch', surface: 'floor', severity: 'light' }))
    expect(j.ruleId).toBe('B-03')
  })
  it('B-03 scratch moderate → 不命中（保守 C）', () => {
    const j = clsOf(mkFinding({ phenomenon: 'scratch', surface: 'floor', severity: 'moderate' }))
    expect(j.cls).toBe('C')
    expect(j.ruleId).not.toBe('B-03')
  })
  it('B-04 crack + wall + moderate + 租期 30 月 → B，法条 710+733', () => {
    const j = clsOf(mkFinding({ phenomenon: 'crack', surface: 'wall', severity: 'moderate' }), {
      tenancyMonths: 30,
    })
    expect(j.ruleId).toBe('B-04')
    expect(j.legalRefs).toEqual(['civil-710', 'civil-733'])
  })
  it('B-04 租期不足 24 月 → 不命中（保守 C）', () => {
    const j = clsOf(mkFinding({ phenomenon: 'crack', surface: 'wall', severity: 'light' }), {
      tenancyMonths: 12,
    })
    expect(j.ruleId).not.toBe('B-04')
    expect(j.cls).toBe('C')
  })
  it('B-05 crack + wall + 渗水措辞 → B，法条 712（维修义务在出租人）', () => {
    const j = clsOf(
      mkFinding({ phenomenon: 'crack', surface: 'wall', severity: 'light', aiDescription: '裂缝周边有水渍，疑似渗水后干燥' }),
      { tenancyMonths: 10 },
    )
    expect(j.ruleId).toBe('B-05')
    expect(j.legalRefs).toEqual(['civil-712'])
  })
  it('B-06 rust + fixture → B；rust + wall 不命中', () => {
    expect(clsOf(mkFinding({ phenomenon: 'rust', surface: 'fixture' })).ruleId).toBe('B-06')
    expect(clsOf(mkFinding({ phenomenon: 'rust', surface: 'wall' })).cls).toBe('C')
  })
  it('B-07 hole + wall + 钉眼措辞（未写直径）→ B', () => {
    const j = clsOf(
      mkFinding({ phenomenon: 'hole', surface: 'wall', aiDescription: '3 处钉眼，分布零散' }),
    )
    expect(j.ruleId).toBe('B-07')
    expect(j.cls).toBe('B')
  })
  it('B-07 钉眼但直径 12mm → 不命中（不在 <8mm 范围，保守 C）', () => {
    const j = clsOf(
      mkFinding({ phenomenon: 'hole', surface: 'wall', aiDescription: '钉眼痕迹，直径约 12mm' }),
    )
    expect(j.ruleId).not.toBe('B-07')
    expect(j.cls).toBe('C')
  })
  it('B-09 dirt + appliance → B', () => {
    const j = clsOf(mkFinding({ phenomenon: 'dirt', surface: 'appliance' }))
    expect(j.ruleId).toBe('B-09')
    expect(j.cls).toBe('B')
  })
})

describe('C 类规则', () => {
  it('C-01 hole + wall + 成片措辞 → C', () => {
    const j = clsOf(
      mkFinding({ phenomenon: 'hole', surface: 'wall', aiDescription: '墙面成片孔洞，最大直径 25mm' }),
    )
    expect(j.ruleId).toBe('C-01')
    expect(j.cls).toBe('C')
    expect(j.legalRefs).toEqual(['civil-711'])
  })
  it('C-01 直径 ≥ 20mm 单独成立', () => {
    const j = clsOf(
      mkFinding({ phenomenon: 'hole', surface: 'door', aiDescription: '圆形破洞，直径约 30mm' }),
    )
    expect(j.ruleId).toBe('C-01')
  })
  it('C-02 stain + wall + 泼洒措辞 → C', () => {
    const j = clsOf(
      mkFinding({ phenomenon: 'stain', surface: 'floor', aiDescription: '深色泼洒痕迹，边界清晰' }),
    )
    expect(j.ruleId).toBe('C-02')
  })
  it('B-08 stain + wall + 霉斑扩散 → B（倾向房屋原因，712）', () => {
    const j = clsOf(
      mkFinding({ phenomenon: 'stain', surface: 'wall', aiDescription: '黄褐色霉斑，呈扩散状' }),
    )
    expect(j.ruleId).toBe('B-08')
    expect(j.cls).toBe('B')
    expect(j.legalRefs).toEqual(['civil-712'])
  })
  it('C-03 chip + wall + 撕扯措辞 → C', () => {
    const j = clsOf(
      mkFinding({ phenomenon: 'chip', surface: 'wall', aiDescription: '漆面边缘呈撕扯状，疑为胶带移除' }),
    )
    expect(j.ruleId).toBe('C-03')
  })
  it('C-04 missing + 有入住证据 → C', () => {
    const j = clsOf(mkFinding({ phenomenon: 'missing', surface: 'furniture' }))
    expect(j.ruleId).toBe('C-04')
    expect(j.cls).toBe('C')
  })
  it('C-05 deform + furniture → C', () => {
    const j = clsOf(mkFinding({ phenomenon: 'deform', surface: 'furniture' }))
    expect(j.ruleId).toBe('C-05')
  })
  it('C-99 severe 且无专属规则命中 → C，base 0.5', () => {
    const j = clsOf(mkFinding({ phenomenon: 'chip', surface: 'door', severity: 'severe' }))
    expect(j.ruleId).toBe('C-99')
    expect(j.confidence).toBeCloseTo(0.5 * 1.0 * 0.7)
  })
})

describe('A-02 / X-01 兜底', () => {
  it('A-02 有入住照片、无匹配瑕疵、无专属规则命中 → C（保守）', () => {
    const j = clsOf(mkFinding({ phenomenon: 'stain', surface: 'wall' }))
    expect(j.ruleId).toBe('A-02')
    expect(j.cls).toBe('C')
    expect(j.reason).toBe('入住底稿记录了该表面，未见此处问题')
  })
  it('X-01 无入住照片 → C，base 0.4，置信度必然低于告警线', () => {
    const j = judge({
      finding: mkFinding(),
      hasMoveInEvidence: false,
      tenancyMonths: 14,
    })
    expect(j.ruleId).toBe('X-01')
    expect(j.cls).toBe('C')
    expect(j.confidence).toBeLessThan(CONFIDENCE_WARN)
  })
  it('X-01 的证据系数 0.6 作用于置信度', () => {
    const j = judge({
      finding: mkFinding({ aiConfidence: 0.8 }),
      hasMoveInEvidence: false,
      tenancyMonths: 14,
    })
    // X-01 base 0.4 × 证据 0.6 × (0.6+0.4×0.8)
    expect(j.confidence).toBeCloseTo(0.4 * 0.6 * (0.6 + 0.4 * 0.8))
  })
})

describe('置信度公式（CONTENT §3.3）', () => {
  it('无 AI：aiFactor = 0.7；B + 有入住照 → 0.525，低于告警线必须人工确认', () => {
    const j = clsOf(mkFinding({ phenomenon: 'dirt', surface: 'wall' }))
    expect(j.confidence).toBeCloseTo(0.75 * 1.0 * 0.7)
    expect(j.confidence).toBeLessThan(CONFIDENCE_WARN)
  })
  it('有 AI：aiFactor = 0.6 + 0.4 × aiConfidence', () => {
    const j = clsOf(mkFinding({ phenomenon: 'dirt', surface: 'wall', aiConfidence: 0.5 }))
    expect(j.confidence).toBeCloseTo(0.75 * 1.0 * (0.6 + 0.4 * 0.5))
    expect(j.confidence).toBeGreaterThanOrEqual(CONFIDENCE_WARN)
  })
})

describe('纯函数性与顺序', () => {
  it('同一输入两次判定结果完全一致', () => {
    const f = mkFinding({ phenomenon: 'crack', surface: 'wall', aiConfidence: 0.7 })
    const a = judge({ finding: f, hasMoveInEvidence: true, tenancyMonths: 30 })
    const b = judge({ finding: f, hasMoveInEvidence: true, tenancyMonths: 30 })
    expect(a).toEqual(b)
  })
  it('第一条命中即返回：matchedDefect 优先于一切 C 类条件', () => {
    const j = clsOf(
      mkFinding({ phenomenon: 'hole', surface: 'wall', severity: 'severe', aiDescription: '成片破洞' }),
      { matchedDefect: mkDefect() },
    )
    expect(j.ruleId).toBe('A-01')
  })
  it('表序：crack wall moderate ≥24 月按 B-04 返回（B-04 在 B-05 之前）', () => {
    const j = clsOf(
      mkFinding({ phenomenon: 'crack', surface: 'wall', severity: 'moderate', aiDescription: '裂缝旁有水渍' }),
      { tenancyMonths: 36 },
    )
    expect(j.ruleId).toBe('B-04')
  })
})

describe('surface 兜底', () => {
  it('未知 surface（如 ceiling 的 stain 无霉斑措辞）→ 不命中专属规则，保守 C', () => {
    const j = clsOf(mkFinding({ surface: 'ceiling' as Surface, phenomenon: 'stain' }))
    expect(j.cls).toBe('C')
    expect(['A-02', 'X-01', 'C-99']).toContain(j.ruleId)
  })
})
