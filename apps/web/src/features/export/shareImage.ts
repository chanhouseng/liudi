import type { ID } from '@/domain/types'
import { loadPhotoBitmaps, renderShareCanvas, type DeedDrawData } from './deedCanvas'

export async function renderShareImage(
  data: DeedDrawData,
  ids: ID[],
  blobs: (Blob | null)[],
): Promise<Blob> {
  const bitmaps = await loadPhotoBitmaps(blobs, 800)
  const images = new Map(ids.map((id, i) => [id, bitmaps[i]]))
  const canvas = renderShareCanvas(data, images)
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('长图生成失败'))),
      'image/jpeg',
      0.9,
    )
  })
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
