// 拍摄/选图 → 压缩 + 缩略图 + SHA-256。
// 通过 canvas 重编码顺便剥离 EXIF（含 GPS），满足隐私硬规则。
const MAIN_LONG_EDGE = 1600
const THUMB_LONG_EDGE = 320

// BUG-07：非安全上下文（HTTP）拿不到 crypto.subtle。哈希是证据链的地基，
// 拿不到就宁可拍摄失败，也不能静默给出空哈希让 verifyChain 全部"通过"。
export const FINGERPRINT_ERROR = '当前环境无法生成校验指纹，请用 HTTPS 打开'

function assertSubtle(): void {
  if (!globalThis.crypto?.subtle) throw new Error(FINGERPRINT_ERROR)
}

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
  assertSubtle()
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function processImage(source: Blob | HTMLVideoElement): Promise<ProcessedImage> {
  // 先于一切解码做守卫：解码是纯浪费，且这样 Node 单测也能直接覆盖这个分支
  assertSubtle()
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

// 对比页用：把库里存的 JPEG 解成像素，供 SSIM / 手动对齐仿射重采样
export async function blobToImageData(blob: Blob): Promise<ImageData> {
  const { src, w, h } = await decodeBlob(blob)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('canvas 2d 不可用')
  ctx.drawImage(src, 0, 0)
  if (src instanceof ImageBitmap) src.close()
  return ctx.getImageData(0, 0, w, h)
}

// 手动对齐路径的仿射重采样：h 为 3×3 行主序，把源像素映射到输出画布（与 warpTo 的 H 同向）。
// 只有自动配准失败才走这里，不需要透视，canvas 自带变换即可，避免在无 OpenCV 时卡死。
export function warpAffineImageData(
  src: ImageData,
  h: number[],
  outW: number,
  outH: number,
): ImageData {
  const out = document.createElement('canvas')
  out.width = outW
  out.height = outH
  const ctx = out.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('canvas 2d 不可用')
  ctx.fillStyle = '#808080'
  ctx.fillRect(0, 0, outW, outH)
  const stage = document.createElement('canvas')
  stage.width = src.width
  stage.height = src.height
  stage.getContext('2d')?.putImageData(src, 0, 0)
  // canvas 语义 x' = a·x + c·y + e：行主序 H 是 [h0 h1 h2; h3 h4 h5]，故 (a,b,c,d,e,f) = (h0,h3,h1,h4,h2,h5)
  ctx.setTransform(h[0], h[3], h[1], h[4], h[2], h[5])
  ctx.drawImage(stage, 0, 0)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  return ctx.getImageData(0, 0, outW, outH)
}
