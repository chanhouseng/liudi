import type { ID } from '@/domain/types'
import { formatYuan } from '@/lib/format'
import { PHENOMENON_LABELS } from '@/content/vocab'
import type { DeedModel } from './deedModel'

export interface DeedDrawData {
  caseData: { alias: string; leaseStart: string; leaseEnd: string; deposit: number }
  model: DeedModel
  generatedAt: string
  brokenPNo: number | null
}

export type WallImage = HTMLCanvasElement | ImageBitmap

const INK = '#14161A'
const INK2 = '#5A6170'
const INK3 = '#8A909C'
const RULE = '#E2DFD8'
const ACCENT = '#17325E'
const ALERT = '#B3261E'
const SURFACE = '#FFFFFF'

const SERIF = '"Noto Serif SC","Songti SC","STSong","SimSun",serif'
const SANS =
  '"Noto Sans SC",system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif'
const MONO = '"JetBrains Mono",ui-monospace,Consolas,"Courier New",monospace'

export interface Block {
  h: number
  forceBreakAfter?: boolean
  draw: (ctx: CanvasRenderingContext2D, x: number, y: number, w: number) => void
}

function setFont(ctx: CanvasRenderingContext2D, f: string, size: number, weight = 400): void {
  ctx.font = `${weight} ${size}px ${f}`
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let cur = ''
  for (const ch of text) {
    const next = cur + ch
    if (ctx.measureText(next).width > maxWidth && cur) {
      lines.push(cur)
      cur = ch
    } else {
      cur = next
    }
  }
  if (cur) lines.push(cur)
  return lines
}

export function hashShort(hex: string): string {
  if (!hex) return '未入链'
  return `${hex.slice(0, 4)}…${hex.slice(-4)}`
}

export function timeLabel(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ')
}

export async function loadPhotoBitmaps(
  blobs: (Blob | null)[],
  longEdge = 800,
): Promise<(WallImage | null)[]> {
  return Promise.all(
    blobs.map(async (blob) => {
      if (!blob) return null
      try {
        const src = await createImageBitmap(blob)
        const scale = Math.min(1, longEdge / Math.max(src.width, src.height))
        const w = Math.max(1, Math.round(src.width * scale))
        const h = Math.max(1, Math.round(src.height * scale))
        const cv = document.createElement('canvas')
        cv.width = w
        cv.height = h
        const ctx = cv.getContext('2d')
        if (!ctx) return null
        ctx.drawImage(src, 0, 0, w, h)
        src.close()
        return cv
      } catch {
        return null
      }
    }),
  )
}

function photoCell(
  img: WallImage | null,
  p: DeedModel['photos'][number],
  cellW: number,
  imgH: number,
): Block {
  return {
    h: imgH + 66,
    draw: (ctx, x, y) => {
      ctx.save()
      ctx.strokeStyle = RULE
      ctx.strokeRect(x + 0.5, y + 0.5, cellW - 1, imgH - 1)
      if (img) {
        const iw = 'width' in img ? img.width : 0
        const ih = 'height' in img ? img.height : 0
        if (iw && ih) {
          const s = Math.min((cellW - 2) / iw, (imgH - 2) / ih)
          const dw = iw * s
          const dh = ih * s
          ctx.drawImage(
            img as CanvasImageSource,
            x + (cellW - dw) / 2,
            y + (imgH - dh) / 2,
            dw,
            dh,
          )
        }
      }
      setFont(ctx, MONO, 20, 500)
      ctx.fillStyle = ACCENT
      ctx.fillText(`[P-${String(p.pNo).padStart(2, '0')}]`, x, y + imgH + 26)
      setFont(ctx, SANS, 20)
      ctx.fillStyle = INK
      ctx.fillText(p.slotLabel, x + 78, y + imgH + 26)
      setFont(ctx, MONO, 17)
      ctx.fillStyle = INK3
      ctx.fillText(
        `${timeLabel(p.takenAt)}  ${hashShort(p.chainHash || p.sha256)}`,
        x,
        y + imgH + 52,
      )
      ctx.restore()
    },
  }
}

export function buildBlocks(data: DeedDrawData, images: Map<ID, WallImage | null>, w: number): Block[] {
  const { model } = data
  const blocks: Block[] = []
  const pad = Math.round(w * 0.06)
  const inner = w - pad * 2

  // 封面
  blocks.push({
    h: 150,
    draw: (ctx, x, y) => {
      setFont(ctx, SERIF, 44, 600)
      ctx.fillStyle = INK
      ctx.fillText('房屋底稿', x, y + 48)
      setFont(ctx, SANS, 20)
      ctx.fillStyle = INK3
      ctx.fillText(data.generatedAt, x, y + 86)
      setFont(ctx, MONO, 20, 500)
      ctx.fillStyle = ACCENT
      ctx.textAlign = 'right'
      ctx.fillText(model.caseNo, x + inner, y + 48)
      ctx.textAlign = 'left'
      ctx.strokeStyle = RULE
      ctx.beginPath()
      ctx.moveTo(x, y + 118)
      ctx.lineTo(x + inner, y + 118)
      ctx.stroke()
    },
  })
  const kvs: [string, string, boolean][] = [
    ['别名', data.caseData.alias, false],
    ['租期', `${data.caseData.leaseStart} 至 ${data.caseData.leaseEnd}`, true],
    ['押金', formatYuan(data.caseData.deposit), true],
    ['照片', `${model.photos.length} 张`, true],
    ['瑕疵', `${model.defects.length} 处`, true],
  ]
  for (const [label, value, mono] of kvs) {
    blocks.push({
      h: 52,
      draw: (ctx, x, y) => {
        setFont(ctx, SANS, 22)
        ctx.fillStyle = INK2
        ctx.fillText(label, x, y + 30)
        setFont(ctx, mono ? MONO : SANS, 22, mono ? 500 : 400)
        ctx.fillStyle = INK
        ctx.textAlign = 'right'
        ctx.fillText(value, x + inner, y + 30)
        ctx.textAlign = 'left'
        ctx.strokeStyle = RULE
        ctx.beginPath()
        ctx.moveTo(x, y + 51.5)
        ctx.lineTo(x + inner, y + 51.5)
        ctx.stroke()
      },
    })
  }
  blocks.push({
    h: 52,
    forceBreakAfter: true,
    draw: (ctx, x, y) => {
      setFont(ctx, SANS, 22)
      ctx.fillStyle = INK2
      ctx.fillText('校验', x, y + 30)
      setFont(ctx, MONO, 22, 500)
      ctx.fillStyle = data.brokenPNo !== null ? ALERT : ACCENT
      ctx.textAlign = 'right'
      ctx.fillText(
        data.brokenPNo !== null
          ? `有 1 张照片的校验没通过（P-${String(data.brokenPNo).padStart(2, '0')}）`
          : model.chained.length > 0
            ? `通过 ${model.chained.length} 张`
            : '尚无入链照片',
        x + inner,
        y + 30,
      )
      ctx.textAlign = 'left'
    },
  })

  // 照片墙（按房间分组，两列）
  blocks.push({
    h: 64,
    draw: (ctx, x, y) => {
      setFont(ctx, SERIF, 30, 600)
      ctx.fillStyle = INK
      ctx.fillText('照片墙', x, y + 40)
    },
  })
  const cols = 2
  const gap = Math.round(inner * 0.04)
  const cellW = Math.floor((inner - gap * (cols - 1)) / cols)
  const imgH = Math.round(cellW * 0.75)
  for (const group of model.byRoom) {
    blocks.push({
      h: 56,
      draw: (ctx, x, y) => {
        setFont(ctx, SERIF, 26, 600)
        ctx.fillStyle = INK2
        ctx.fillText(group.roomLabel, x, y + 36)
      },
    })
    for (let i = 0; i < group.photos.length; i += cols) {
      const rowPhotos = group.photos.slice(i, i + cols)
      const cells = rowPhotos.map((p) => photoCell(images.get(p.id) ?? null, p, cellW, imgH))
      blocks.push({
        h: imgH + 66,
        draw: (ctx, x, y) => {
          cells.forEach((c, idx) => c.draw(ctx, x + idx * (cellW + gap), y, cellW))
        },
      })
    }
  }

  // 瑕疵清单
  blocks.push({
    h: 64,
    draw: (ctx, x, y) => {
      setFont(ctx, SERIF, 30, 600)
      ctx.fillStyle = INK
      ctx.fillText('瑕疵清单', x, y + 40)
    },
  })
  if (model.defects.length === 0) {
    blocks.push({
      h: 40,
      draw: (ctx, x, y) => {
        setFont(ctx, SANS, 20)
        ctx.fillStyle = INK3
        ctx.fillText('无', x, y + 24)
      },
    })
  }
  for (const d of model.defects) {
    const p = model.photos.find((pp) => pp.pNo === d.pNo)
    const img = p ? images.get(p.id) ?? null : null
    const boxH = 184
    blocks.push({
      h: boxH,
      draw: (ctx, x, y) => {
        setFont(ctx, MONO, 22, 500)
        ctx.fillStyle = ACCENT
        ctx.fillText(`D-${String(d.seq).padStart(2, '0')}`, x, y + 28)
        setFont(ctx, SANS, 22)
        ctx.fillStyle = INK
        ctx.fillText(`${d.roomLabel} · ${d.slotLabel}`, x + 66, y + 28)
        setFont(ctx, SANS, 22)
        ctx.fillStyle = INK2
        ctx.textAlign = 'right'
        ctx.fillText(PHENOMENON_LABELS[d.phenomenon], x + inner, y + 28)
        ctx.textAlign = 'left'
        const thumbW = 200
        const thumbH = 126
        const ty = y + 44
        if (img && 'width' in img) {
          const iw = img.width
          const ih = img.height
          const s = Math.min(thumbW / iw, thumbH / ih)
          const dw = iw * s
          const dh = ih * s
          ctx.drawImage(img as CanvasImageSource, x, ty + (thumbH - dh) / 2, dw, dh)
          if (dw > 0 && dh > 0) {
            ctx.strokeStyle = ACCENT
            ctx.lineWidth = 2
            ctx.strokeRect(
              x + d.bbox[0] * dw,
              ty + (thumbH - dh) / 2 + d.bbox[1] * dh,
              d.bbox[2] * dw,
              d.bbox[3] * dh,
            )
            ctx.lineWidth = 1
          }
        }
        setFont(ctx, SANS, 19)
        ctx.fillStyle = INK2
        ctx.fillText(`见照片 [P-${String(d.pNo).padStart(2, '0')}]`, x + thumbW + 18, ty + 20)
        ctx.strokeStyle = RULE
        ctx.beginPath()
        ctx.moveTo(x, y + boxH - 0.5)
        ctx.lineTo(x + inner, y + boxH - 0.5)
        ctx.stroke()
      },
    })
  }

  // 哈希链
  blocks.push({
    h: 80,
    draw: (ctx, x, y) => {
      setFont(ctx, SERIF, 30, 600)
      ctx.fillStyle = INK
      ctx.fillText('哈希链', x, y + 40)
      setFont(ctx, SANS, 19)
      ctx.fillStyle = INK3
      ctx.fillText('chainHash = SHA256(prevChainHash + sha256 + takenAt)', x, y + 68)
    },
  })
  const colHash = Math.round((inner - 60 - 90) / 2)
  for (const p of model.chained) {
    blocks.push({
      h: 56,
      draw: (ctx, x, y) => {
        setFont(ctx, MONO, 19)
        ctx.fillStyle = INK3
        ctx.fillText(String(p.pNo), x, y + 24)
        ctx.fillStyle = ACCENT
        ctx.fillText(`P-${String(p.pNo).padStart(2, '0')}`, x + 50, y + 24)
        ctx.fillStyle = INK
        ctx.fillText(p.sha256.slice(0, 12), x + 50, y + 46)
        ctx.fillStyle = INK2
        ctx.fillText(p.chainHash.slice(0, 12), x + 50 + colHash, y + 46)
        setFont(ctx, MONO, 15)
        ctx.fillStyle = INK3
        ctx.fillText(p.takenAt.slice(0, 19).replace('T', ' '), x + 50 + colHash, y + 24)
        ctx.strokeStyle = RULE
        ctx.beginPath()
        ctx.moveTo(x, y + 55.5)
        ctx.lineTo(x + inner, y + 55.5)
        ctx.stroke()
      },
    })
  }

  // 声明
  blocks.push({
    h: 110,
    draw: (ctx, x, y) => {
      setFont(ctx, SANS, 19)
      ctx.fillStyle = INK2
      const lines = wrap(ctx, '本底稿用于记录房屋交付时的状态，不构成法律意见。', inner)
      lines.forEach((ln, i) => ctx.fillText(ln, x, y + 24 + i * 30))
    },
  })
  return blocks
}

export function paginate(
  blocks: Block[],
  pageW: number,
  pageH: number,
): { canvas: HTMLCanvasElement; drew: number }[] {
  const pages: { canvas: HTMLCanvasElement; drew: number }[] = []
  let canvas = newPage(pageW, pageH)
  let y = Math.round(pageH * 0.07)
  const bottom = Math.round(pageH * 0.94)
  let drew = 0
  const flush = () => {
    pages.push({ canvas, drew })
    drew = 0
  }
  for (const b of blocks) {
    if (y + b.h > bottom && y > Math.round(pageH * 0.07)) {
      flush()
      canvas = newPage(pageW, pageH)
      y = Math.round(pageH * 0.07)
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) continue
    b.draw(ctx, Math.round(pageW * 0.06), y, pageW)
    y += b.h
    drew += 1
    if (b.forceBreakAfter) {
      flush()
      canvas = newPage(pageW, pageH)
      y = Math.round(pageH * 0.07)
    }
  }
  flush()
  return pages
}

function newPage(w: number, h: number): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d')
  if (ctx) {
    ctx.fillStyle = SURFACE
    ctx.fillRect(0, 0, w, h)
    ctx.textBaseline = 'alphabetic'
  }
  return cv
}

// A4 @2x：595×842pt × 2，导出 PDF 用
export function renderDeedPages(
  data: DeedDrawData,
  images: Map<ID, WallImage | null>,
): { canvas: HTMLCanvasElement; drew: number }[] {
  const blocks = buildBlocks(data, images, 1190)
  return paginate(blocks, 1190, 1684)
}

// 微信长图：宽 1080，一段画布（照片墙两列块高度可控，不会触到 canvas 高度上限）
export function renderShareCanvas(
  data: DeedDrawData,
  images: Map<ID, WallImage | null>,
): HTMLCanvasElement {
  const w = 1080
  const blocks = buildBlocks(data, images, w)
  const total = blocks.reduce((n, b) => n + b.h, 0) + Math.round(w * 0.12)
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = Math.min(total, 16000)
  const ctx = cv.getContext('2d')
  if (ctx) {
    ctx.fillStyle = SURFACE
    ctx.fillRect(0, 0, cv.width, cv.height)
    let y = Math.round(w * 0.06)
    for (const b of blocks) {
      if (y + b.h > cv.height) break
      b.draw(ctx, Math.round(w * 0.06), y, w)
      y += b.h
    }
  }
  return cv
}
