import { describe, expect, it } from 'vitest'

import { diffImages } from './diff'

const W = 640
const H = 480

function mulberry32(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let z = t
    z = Math.imul(z ^ (z >>> 15), z | 1)
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61)
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296
  }
}

function asImage(data: Uint8ClampedArray): ImageData {
  return { data, width: W, height: H, colorSpace: 'srgb' } as unknown as ImageData
}

// 底图模拟室内墙面：缓慢渐变 + 随机色块 + 网格线，避免大片纯平区
function makeBase(): ImageData {
  const data = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = 140 + x * 0.06 + y * 0.04
      const i = (y * W + x) * 4
      data[i] = v
      data[i + 1] = v - 6
      data[i + 2] = v - 10
      data[i + 3] = 255
    }
  }
  const rnd = mulberry32(7)
  for (let k = 0; k < 36; k++) {
    const rx = Math.floor(rnd() * W)
    const ry = Math.floor(rnd() * H)
    const rw = 20 + Math.floor(rnd() * 60)
    const rh = 12 + Math.floor(rnd() * 40)
    const v = 70 + rnd() * 140
    for (let y = ry; y < Math.min(H, ry + rh); y++) {
      for (let x = rx; x < Math.min(W, rx + rw); x++) {
        const i = (y * W + x) * 4
        data[i] = v
        data[i + 1] = v - 6
        data[i + 2] = v - 10
      }
    }
  }
  for (let x = 0; x < W; x += 24) {
    for (let y = 0; y < H; y++) {
      const i = (y * W + x) * 4
      data[i] += 22
      data[i + 1] += 22
      data[i + 2] += 22
    }
  }
  for (let y = 0; y < H; y += 24) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      data[i] += 22
      data[i + 1] += 22
      data[i + 2] += 22
    }
  }
  return asImage(data)
}

function copyBase(base: ImageData): Uint8ClampedArray {
  return new Uint8ClampedArray(base.data)
}

function withBlotch(base: ImageData, cx: number, cy: number, r: number, mul: number): ImageData {
  const data = copyBase(base)
  const r2 = r * r
  for (let y = Math.max(0, cy - r); y < Math.min(H, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x < Math.min(W, cx + r); x++) {
      const dx = x - cx
      const dy = y - cy
      if (dx * dx + dy * dy > r2) continue
      const i = (y * W + x) * 4
      data[i] *= mul
      data[i + 1] *= mul
      data[i + 2] *= mul
    }
  }
  return asImage(data)
}

function withStreak(
  base: ImageData,
  x0: number,
  y0: number,
  len: number,
  thick: number,
  add: number,
  seed: number,
  vertical: boolean,
): ImageData {
  const data = copyBase(base)
  const rnd = mulberry32(seed)
  for (let a = 0; a < len; a++) {
    for (let t = 0; t < thick; t++) {
      const x = vertical ? x0 + t : x0 + a
      const y = vertical ? y0 + a : y0 + t
      if (x >= W || y >= H) continue
      // 真实划痕有颗粒感；纯平移亮度的窗口 SSIM 天然钝感，必须带结构变化
      const n = (rnd() * 2 - 1) * 25
      const i = (y * W + x) * 4
      data[i] += add + n
      data[i + 1] += add + n
      data[i + 2] += add + n
    }
  }
  return asImage(data)
}

function withPatch(base: ImageData, cx: number, cy: number, half: number): ImageData {
  const data = copyBase(base)
  for (let y = cy - half; y < cy + half; y++) {
    for (let x = cx - half; x < cx + half; x++) {
      const i = (y * W + x) * 4
      data[i] = data[i] * 1.35 + 45
      data[i + 1] *= 0.55
      data[i + 2] *= 0.55
    }
  }
  return asImage(data)
}

function withNoise(
  base: ImageData,
  cx: number,
  cy: number,
  r: number,
  amp: number,
  seed: number,
): ImageData {
  const data = copyBase(base)
  const rnd = mulberry32(seed)
  const r2 = r * r
  for (let y = Math.max(0, cy - r); y < Math.min(H, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x < Math.min(W, cx + r); x++) {
      const dx = x - cx
      const dy = y - cy
      if (dx * dx + dy * dy > r2) continue
      const n = (rnd() * 2 - 1) * amp
      const i = (y * W + x) * 4
      data[i] += n
      data[i + 1] += n
      data[i + 2] += n
    }
  }
  return asImage(data)
}

function iou(a: number[], b: number[]): number {
  const x0 = Math.max(a[0], b[0])
  const y0 = Math.max(a[1], b[1])
  const x1 = Math.min(a[0] + a[2], b[0] + b[2])
  const y1 = Math.min(a[1] + a[3], b[1] + b[3])
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0)
  const uni = a[2] * a[3] + b[2] * b[3] - inter
  return uni > 0 ? inter / uni : 0
}

describe('T13 diffImages', () => {
  it('5 组固定图：每个已知缺陷的最佳匹配 IoU > 0.6', () => {
    const base = makeBase()
    const cases = [
      {
        name: '暗渍',
        out: withBlotch(base, 320, 216, 50, 0.3),
        gts: [[270 / W, 166 / H, 100 / W, 100 / H]],
      },
      {
        name: '亮划痕',
        out: withStreak(base, 70, 90, 130, 24, 100, 11, false),
        gts: [[70 / W, 90 / H, 130 / W, 24 / H]],
      },
      {
        name: '彩色残留',
        out: withPatch(base, 470, 330, 50),
        gts: [[420 / W, 280 / H, 100 / W, 100 / H]],
      },
      {
        name: '双缺陷',
        out: withBlotch(withStreak(base, 390, 110, 130, 24, 100, 12, true), 190, 290, 48, 0.3),
        gts: [
          [142 / W, 242 / H, 96 / W, 96 / H],
          [390 / W, 110 / H, 24 / W, 130 / H],
        ],
      },
      {
        name: '泛黄噪点渍',
        out: withNoise(base, 230, 190, 48, 60, 13),
        gts: [[182 / W, 142 / H, 96 / W, 96 / H]],
      },
    ]
    for (const c of cases) {
      const regions = diffImages(base, c.out)
      expect(regions.length, `${c.name}: 至少出一个区域`).toBeGreaterThan(0)
      for (const gt of c.gts) {
        const best = Math.max(...regions.map((r) => iou(gt, r.bbox)))
        expect(best, `${c.name}: IoU=${best.toFixed(2)}`).toBeGreaterThan(0.6)
      }
    }
  })

  it('两帧完全一致 → 没有差异区域', () => {
    const base = makeBase()
    expect(diffImages(base, base)).toEqual([])
  })

  it('缺陷多于 8 个时按强度截断到 8 个', () => {
    const base = makeBase()
    let out = base
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 4; col++) {
        out = withBlotch(out, 80 + col * 160, 80 + row * 160, 28, 0.3)
      }
    }
    const regions = diffImages(base, out)
    expect(regions.length).toBe(8)
  })
})
