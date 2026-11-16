export function formatYuan(fen: number): string {
  return `¥${(fen / 100).toLocaleString('zh-CN')}`
}

// 租期整月数（不足整月按 0 计）。输入为 ISO 日期串（YYYY-MM-DD）。
export function monthsBetween(startISO: string, endISO: string): number {
  const [sy, sm] = startISO.split('-').map(Number)
  const [ey, em] = endISO.split('-').map(Number)
  if (!Number.isFinite(sy) || !Number.isFinite(sm) || !Number.isFinite(ey) || !Number.isFinite(em)) {
    return 0
  }
  return Math.max(0, (ey - sy) * 12 + (em - sm))
}
