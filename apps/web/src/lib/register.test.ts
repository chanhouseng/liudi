import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

import { registerPair, setOpenCv, warpTo } from './register'

// opencv.js 的 Mat 是 WASM 初始化完成后异步挂上的，require 后必须轮询就绪；
// 走 createRequire 绕开 vite-node 对 13MB UMD 的转换。
// 注意：就绪轮询不能放进 beforeAll（该环境里 hook 内 await 会挂起），
// 用惰性单例在第一个用例内完成加载与夹具构造。
const require = createRequire(import.meta.url)

let ready: Promise<void> | null = null
function ensureReady(): Promise<void> {
  ready ??= (async () => {
    const cv = require('@techstark/opencv-js') as never
    const deadline = Date.now() + 60000
    while (
      !(cv as { Mat?: unknown; ORB?: unknown }).Mat &&
      !(cv as { Mat?: unknown; ORB?: unknown }).ORB &&
      Date.now() < deadline
    ) {
      await new Promise((r) => setTimeout(r, 50))
    }
    if (!(cv as { Mat?: unknown }).Mat) throw new Error('opencv 初始化超时')
    setOpenCv(cv)
    const base = makeTexture(720, 560, 42)
    moveIn = crop(base, 0, 0, W, H)
    moveOut = crop(base, DX, DY, W, H)
  })()
  return ready
}

// 确定性纹理：渐变底 + 随机色块 + 细网格，给 ORB 足够角点。
function makeTexture(w: number, h: number, seed: number): ImageData {
  let s = seed >>> 0
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < 30; i++) {
    const bx = Math.floor(rand() * w)
    const by = Math.floor(rand() * h)
    const bw = 12 + Math.floor(rand() * 110)
    const bh = 12 + Math.floor(rand() * 110)
    const v = Math.floor(60 + rand() * 160)
    for (let y = by; y < Math.min(h, by + bh); y++) {
      for (let x = bx; x < Math.min(w, bx + bw); x++) {
        const o = (y * w + x) * 4
        data[o] = v
        data[o + 1] = Math.floor(v * 0.8)
        data[o + 2] = Math.floor(v * 0.6)
        data[o + 3] = 255
      }
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      const grid = (x % 16 === 0 || y % 16 === 0) ? 26 : 0
      data[o] = Math.min(255, data[o] + x * 0.12 + grid)
      data[o + 1] = Math.min(255, data[o + 1] + y * 0.1 + grid)
      data[o + 3] = 255
    }
  }
  return { data, width: w, height: h, colorSpace: 'srgb' }
}

function crop(img: ImageData, x0: number, y0: number, w: number, h: number): ImageData {
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    out.set(
      img.data.subarray(((y + y0) * img.width + x0) * 4, ((y + y0) * img.width + x0 + w) * 4),
      y * w * 4,
    )
  }
  return { data: out, width: w, height: h, colorSpace: 'srgb' }
}

// 640×480 > 512：配准在工作分辨率（0.8 倍）做，H 再换算回原始分辨率，scaleHomography 被真实覆盖。
const DX = 24
const DY = 16
const W = 640
const H = 480

function cornersOf(Hm: number[]): [number, number][] {
  const apply = (x: number, y: number): [number, number] => [
    (Hm[0] * x + Hm[1] * y + Hm[2]) / (Hm[6] * x + Hm[7] * y + Hm[8]),
    (Hm[3] * x + Hm[4] * y + Hm[5]) / (Hm[6] * x + Hm[7] * y + Hm[8]),
  ]
  return [apply(0, 0), apply(W - 1, 0), apply(0, H - 1), apply(W - 1, H - 1)]
}

const blank = {
  data: new Uint8ClampedArray(W * H * 4).fill(90),
  width: W,
  height: H,
  colorSpace: 'srgb',
} as ImageData

let moveIn: ImageData
let moveOut: ImageData

describe('registerPair', () => {
  it('已知平移的图对：内点 ≥ 20，四角误差 < 3% 边长', async () => {
    await ensureReady()
    const r = await registerPair(moveIn, moveOut)
    if (!r.ok) throw new Error(`应配准成功：${r.reason}`)
    expect(r.inliers).toBeGreaterThanOrEqual(20)
    const corners = cornersOf(r.H)
    const expected: [number, number][] = [
      [DX, DY],
      [DX + W - 1, DY],
      [DX, DY + H - 1],
      [DX + W - 1, DY + H - 1],
    ]
    const errs = corners.map(([x, y], i) => Math.hypot(x - expected[i][0], y - expected[i][1]))
    const mean = errs.reduce((a, b) => a + b, 0) / errs.length
    expect(mean).toBeLessThan(W * 0.03)
  }, 60000)

  it('无纹理空白图 → few-inliers', async () => {
    await ensureReady()
    const r = await registerPair(blank, blank)
    expect(r).toEqual({ ok: false, reason: 'few-inliers' })
  }, 60000)

  it('warpTo 按 H 重采样后场景对齐（中心区域逐像素接近）', async () => {
    await ensureReady()
    const r = await registerPair(moveIn, moveOut)
    if (!r.ok) throw new Error('前置：配准成功')
    const warped = await warpTo(moveOut, r.H, W, H)
    expect(warped.width).toBe(W)
    expect(warped.height).toBe(H)
    let sum = 0
    let n = 0
    for (let y = 40; y < H - 40; y += 4) {
      for (let x = 40; x < W - 40; x += 4) {
        const o = (y * W + x) * 4
        for (let c = 0; c < 3; c++) sum += Math.abs(warped.data[o + c] - moveIn.data[o + c])
        n += 3
      }
    }
    expect(sum / n).toBeLessThan(2)
  }, 60000)
})
