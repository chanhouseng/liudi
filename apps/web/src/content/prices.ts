// T21 价格库（杭州口径）。事实来源：CONTENT.md §4，改这里必须同步那边。
// 单位：分（金额一律整数分，展示时才除以 100）。
// 截至 2026-11-15 全部 30 项为待核价（CONTENT §4.8：提交前核完或删除），
// source 留空、unverified: true，UI 显示「待核价」——不编造来源。

export interface PriceItem {
  id: string
  label: string
  unit: string
  low: number
  mid: number
  high: number
  /** 设计使用年限（年）；null = 不折旧（CONTENT §4.7 保洁/清洗类） */
  life: number | null
  /** 核价来源：平台名 + 日期。未核为空串。 */
  source: string
  updatedAt: string
  unverified: boolean
}

export const PRICES: PriceItem[] = [
  // 墙面 / 顶面
  { id: 'wall-patch', label: '墙面局部修补 + 补漆（≤1㎡）', unit: '处', low: 15000, mid: 22000, high: 35000, life: 5, source: '', updatedAt: '2026-11-15', unverified: true },
  { id: 'wall-repaint-1', label: '单面墙重新刷漆（约 12–15㎡）', unit: '面', low: 20000, mid: 32000, high: 50000, life: 5, source: '', updatedAt: '2026-11-15', unverified: true },
  { id: 'wall-repaint-all', label: '全屋墙面翻新（50–70㎡）', unit: '套', low: 280000, mid: 420000, high: 650000, life: 5, source: '', updatedAt: '2026-11-15', unverified: true },
  { id: 'wall-mold', label: '墙面除霉处理', unit: '处', low: 15000, mid: 30000, high: 60000, life: 5, source: '', updatedAt: '2026-11-15', unverified: true },
  { id: 'wall-nailhole', label: '钉眼修补（含补漆）', unit: '个', low: 500, mid: 1000, high: 2000, life: 5, source: '', updatedAt: '2026-11-15', unverified: true },
  { id: 'ceiling-patch', label: '顶面修补', unit: '处', low: 20000, mid: 35000, high: 60000, life: 5, source: '', updatedAt: '2026-11-15', unverified: true },

  // 地面
  { id: 'floor-wood-piece', label: '木地板局部更换（单块）', unit: '块', low: 8000, mid: 15000, high: 26000, life: 10, source: '', updatedAt: '2026-11-15', unverified: true },
  { id: 'floor-sanding', label: '木地板打磨翻新', unit: '㎡', low: 2500, mid: 3800, high: 5500, life: 10, source: '', updatedAt: '2026-11-15', unverified: true },
  { id: 'floor-tile-piece', label: '瓷砖更换（单块，含人工）', unit: '块', low: 10000, mid: 18000, high: 30000, life: 15, source: '', updatedAt: '2026-11-15', unverified: true },
  { id: 'floor-grout', label: '瓷砖美缝', unit: '㎡', low: 1000, mid: 1600, high: 2500, life: 10, source: '', updatedAt: '2026-11-15', unverified: true },
  { id: 'carpet-clean', label: '地毯清洗', unit: '㎡', low: 800, mid: 1200, high: 1800, life: null, source: '', updatedAt: '2026-11-15', unverified: true },

  // 门窗 / 五金
  { id: 'door-indoor', label: '室内门更换（含安装）', unit: '樘', low: 60000, mid: 90000, high: 140000, life: 10, source: '', updatedAt: '2026-11-15', unverified: true },
  { id: 'lock-set', label: '门锁更换', unit: '套', low: 15000, mid: 26000, high: 45000, life: 8, source: '', updatedAt: '2026-11-15', unverified: true },
  { id: 'door-frame', label: '门套修补', unit: '处', low: 10000, mid: 20000, high: 35000, life: 10, source: '', updatedAt: '2026-11-15', unverified: true },
  { id: 'screen-window', label: '纱窗更换', unit: '扇', low: 8000, mid: 13000, high: 22000, life: 6, source: '', updatedAt: '2026-11-15', unverified: true },
  { id: 'glass-pane', label: '玻璃更换（单块）', unit: '块', low: 8000, mid: 15000, high: 28000, life: 15, source: '', updatedAt: '2026-11-15', unverified: true },

  // 家具
  { id: 'wardrobe-door', label: '衣柜门板更换', unit: '扇', low: 20000, mid: 35000, high: 60000, life: 10, source: '', updatedAt: '2026-11-15', unverified: true },
  { id: 'mattress-15', label: '床垫更换（1.5m）', unit: '张', low: 70000, mid: 120000, high: 220000, life: 8, source: '', updatedAt: '2026-11-15', unverified: true },
  { id: 'sofa-clean', label: '沙发清洗', unit: '座', low: 8000, mid: 15000, high: 28000, life: null, source: '', updatedAt: '2026-11-15', unverified: true },
  { id: 'furniture-repair', label: '桌椅修补', unit: '件', low: 8000, mid: 16000, high: 30000, life: 10, source: '', updatedAt: '2026-11-15', unverified: true },

  // 家电
  { id: 'ac-clean', label: '空调清洗（挂机）', unit: '台', low: 8000, mid: 12000, high: 18000, life: null, source: '', updatedAt: '2026-11-15', unverified: true },
  { id: 'ac-gas', label: '空调加氟', unit: '台', low: 10000, mid: 16000, high: 26000, life: null, source: '', updatedAt: '2026-11-15', unverified: true },
  { id: 'washer-clean', label: '洗衣机清洗', unit: '台', low: 8000, mid: 12000, high: 18000, life: null, source: '', updatedAt: '2026-11-15', unverified: true },
  { id: 'fridge-clean', label: '冰箱清洁除味', unit: '台', low: 6000, mid: 10000, high: 16000, life: null, source: '', updatedAt: '2026-11-15', unverified: true },
  { id: 'heater-clean', label: '热水器清洗', unit: '台', low: 10000, mid: 16000, high: 25000, life: null, source: '', updatedAt: '2026-11-15', unverified: true },
  { id: 'hood-clean', label: '油烟机清洗', unit: '台', low: 10000, mid: 16000, high: 26000, life: null, source: '', updatedAt: '2026-11-15', unverified: true },

  // 保洁 / 其他
  { id: 'clean-hourly', label: '日常保洁（按小时）', unit: '小时', low: 4000, mid: 5000, high: 7000, life: null, source: '', updatedAt: '2026-11-15', unverified: true },
  { id: 'clean-deep-1br', label: '退租深度保洁（一居）', unit: '套', low: 28000, mid: 42000, high: 70000, life: null, source: '', updatedAt: '2026-11-15', unverified: true },
  { id: 'clean-window', label: '玻璃清洗', unit: '㎡', low: 1000, mid: 1500, high: 2200, life: null, source: '', updatedAt: '2026-11-15', unverified: true },
  { id: 'drain-unclog', label: '下水道疏通', unit: '处', low: 8000, mid: 12000, high: 20000, life: null, source: '', updatedAt: '2026-11-15', unverified: true },
]

export function findPrice(id: string): PriceItem | undefined {
  return PRICES.find((p) => p.id === id)
}
