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
