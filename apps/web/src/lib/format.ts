export function formatYuan(fen: number): string {
  return `¥${(fen / 100).toLocaleString('zh-CN')}`
}
