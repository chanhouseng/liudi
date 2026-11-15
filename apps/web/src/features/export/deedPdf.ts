import type { ID } from '@/domain/types'
import { loadPhotoBitmaps, renderDeedPages, type DeedDrawData } from './deedCanvas'

// Canvas 渲染 → 整页 JPEG 嵌入 jsPDF（方案已确认：中文由系统字体在 canvas 里绘制，规避字体子集依赖）。
export async function exportDeedPdf(
  data: DeedDrawData,
  ids: ID[],
  blobs: (Blob | null)[],
): Promise<void> {
  const bitmaps = await loadPhotoBitmaps(blobs, 800)
  const images = new Map(ids.map((id, i) => [id, bitmaps[i]]))
  const pages = renderDeedPages(data, images)
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' })
  pages.forEach((p, i) => {
    if (i > 0) pdf.addPage()
    pdf.addImage(p.canvas.toDataURL('image/jpeg', 0.85), 'JPEG', 0, 0, 595, 842)
    pdf.setFontSize(9)
    pdf.setTextColor('#8A909C')
    pdf.text(`${i + 1} / ${pages.length}`, 297.5, 830, { align: 'center' })
  })
  pdf.save(`底稿-${data.caseData.alias}.pdf`)
}
