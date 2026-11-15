// 拍摄/选图 → 压缩 + 缩略图 + SHA-256。
// 通过 canvas 重编码顺便剥离 EXIF（含 GPS），满足隐私硬规则。
const MAIN_LONG_EDGE = 1600
const THUMB_LONG_EDGE = 320

export interface ProcessedImage {
  blob: Blob
  thumb: Blob
  sha256: string
}

function drawScaled(
  source: CanvasImageSource,
  w: number,
  h: number,
  longEdge: number,
): HTMLCanvasElement {
  const scale = Math.min(1, longEdge / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w * scale))
  canvas.height = Math.max(1, Math.round(h * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d 不可用')
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('编码失败'))), type, quality)
  })
}

let webpSupported: boolean | null = null
function supportsWebpEncode(): boolean {
  if (webpSupported === null) {
    const c = document.createElement('canvas')
    c.width = 1
    c.height = 1
    webpSupported = c.toDataURL('image/webp').startsWith('data:image/webp')
  }
  return webpSupported
}

async function decodeBlob(blob: Blob): Promise<{ src: CanvasImageSource; w: number; h: number }> {
  try {
    const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' })
    return { src: bmp, w: bmp.width, h: bmp.height }
  } catch {
    const url = URL.createObjectURL(blob)
    try {
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('这张图读不出来'))
        img.src = url
      })
      return { src: img, w: img.naturalWidth, h: img.naturalHeight }
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

async function sha256Hex(blob: Blob): Promise<string> {
  if (!globalThis.crypto?.subtle) return ''
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function processImage(source: Blob | HTMLVideoElement): Promise<ProcessedImage> {
  let src: CanvasImageSource
  let w: number
  let h: number
  if (source instanceof HTMLVideoElement) {
    src = source
    w = source.videoWidth
    h = source.videoHeight
    if (!w || !h) throw new Error('画面还没准备好')
  } else {
    const decoded = await decodeBlob(source)
    src = decoded.src
    w = decoded.w
    h = decoded.h
  }

  const mainCanvas = drawScaled(src, w, h, MAIN_LONG_EDGE)
  const blob = await toBlob(mainCanvas, 'image/jpeg', 0.82)

  const thumbCanvas = drawScaled(src, w, h, THUMB_LONG_EDGE)
  const thumb = await toBlob(
    thumbCanvas,
    supportsWebpEncode() ? 'image/webp' : 'image/jpeg',
    0.75,
  )

  if (src instanceof ImageBitmap) src.close()

  return { blob, thumb, sha256: await sha256Hex(blob) }
}
