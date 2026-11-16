// 演示案例：数字口径同 DEMO.md（押金 ¥4,000、月租 ¥4,000、租期 14 个月）。
// M0 阶段为内存假数据，M6 T28 接预烘焙完整数据。
import type { Case, Phenomenon, Severity, Surface } from '@/domain/types'

export const demoCase: Case = {
  id: 'demo',
  alias: '文一西路某小区 3 幢',
  city: 'hangzhou',
  addressMasked: '文一西路某小区 3 幢',
  rentMonthly: 400000,
  deposit: 400000,
  leaseStart: '2025-09-01',
  leaseEnd: '2026-11-01',
  landlordType: 'personal',
  createdAt: '2026-11-15T09:00:00.000Z',
}

export interface DemoFindingRow {
  no: string
  slot: string
  phenomenon: Phenomenon
  surface: Surface
  severity: Severity
}

export const demoFindings: DemoFindingRow[] = [
  { no: 'F-01', slot: '墙面-北', phenomenon: 'stain', surface: 'wall', severity: 'moderate' },
  { no: 'F-02', slot: '地面', phenomenon: 'scratch', surface: 'floor', severity: 'light' },
]

// 演示扣款消息（DEMO.md §1.1 原文）。定损页演示态用它跑真实的拆解 + 定损引擎，
// 输出随现行价格库与演示判定走，不等同 DEMO.md §1.2 的表格（那组数字待 P4 核价）。
export const demoDeductionText = [
  '房子我看了，问题不少：',
  '1. 墙面到处是印子和钉眼，要整面重新刷，材料加人工 1400',
  '2. 保洁没做干净，我另外请人打扫 600',
  '3. 门锁不好转，换锁 400',
  '4. 空调不制冷，加氟 300',
  '5. 凉席、床单、热水壶都不见了，算 500',
  '一共 3200，剩下的我转你。',
].join('\n')
