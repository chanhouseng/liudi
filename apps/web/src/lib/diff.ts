// T13 差异检测：纯函数。输入对齐后的两帧 ImageData，输出归一化差异区域。
// 管线：统一网格重采样 → sRGB→LAB → 8×8 窗口 SSIM（三通道取最小）→ 阈值 0.72 出掩码
// → 3×3 闭运算 → 8 连通连通域 → 面积 > 全图 0.3% → 按强度降序取前 8。
// 不碰 DOM、不 import Dexie，Node 可单测。

export interface DiffRegion {
  bbox: [number, number, number, number] // [x, y, w, h]，相对整图归一化 0..1
  strength: number // 0..1，1 − SSIM 均值，越大差异越强
}

const WORK_LONG_EDGE = 512
const WIN = 8
const SSIM_THRESHOLD = 0.72
const MIN_AREA_RATIO = 0.003
const MAX_REGIONS = 8

// LAB 各通道取值范围不同，SSIM 稳定常数按通道给：L∈0..100，a/b∈-128..127（按 255 满程）
const SSIM_C1 = [1, 6.5025, 6.5025]
const SSIM_C2 = [9, 58.5225, 58.5225]

function resamplePlanes(
  src: ImageData,
  tw: number,
  th: number,
): [Float64Array, Float64Array, Float64Array] {
  const r = new Float64Array(tw * th)
  const g = new Float64Array(tw * th)
  const b = new Float64Array(tw * th)
  const sw = src.width
  const sh = src.height
  const data = src.data
  for (let ty = 0; ty < th; ty++) {
    const y0 = Math.floor((ty * sh) / th)
    const y1 = Math.max(y0 + 1, Math.ceil(((ty + 1) * sh) / th))
    for (let tx = 0; tx < tw; tx++) {
      const x0 = Math.floor((tx * sw) / tw)
      const x1 = Math.max(x0 + 1, Math.ceil(((tx + 1) * sw) / tw))
      let sr = 0
      let sg = 0
      let sb = 0
      let n = 0
      for (let y = y0; y < y1 && y < sh; y++) {
        let i = (y * sw + x0) * 4
        for (let x = x0; x < x1 && x < sw; x++, i += 4) {
          sr += data[i]
          sg += data[i + 1]
          sb += data[i + 2]
          n++
        }
      }
      const o = ty * tw + tx
      r[o] = sr / n
      g[o] = sg / n
      b[o] = sb / n
    }
  }
  return [r, g, b]
}

function linearize(c: number): number {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

function toLabPlanes(
  r: Float64Array,
  g: Float64Array,
  b: Float64Array,
): [Float64Array, Float64Array, Float64Array] {
  const n = r.length
  const L = new Float64Array(n)
  const A = new Float64Array(n)
  const B = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const rl = linearize(r[i])
    const gl = linearize(g[i])
    const bl = linearize(b[i])
    const x = (0.4124 * rl + 0.3576 * gl + 0.1805 * bl) / 0.95047
    const y = 0.2126 * rl + 0.7152 * gl + 0.0722 * bl
    const z = (0.0193 * rl + 0.1192 * gl + 0.9505 * bl) / 1.08883
    const fx = x > 0.008856 ? Math.cbrt(x) : 7.787 * x + 16 / 116
    const fy = y > 0.008856 ? Math.cbrt(y) : 7.787 * y + 16 / 116
    const fz = z > 0.008856 ? Math.cbrt(z) : 7.787 * z + 16 / 116
    L[i] = 116 * fy - 16
    A[i] = 500 * (fx - fy)
    B[i] = 200 * (fy - fz)
  }
  return [L, A, B]
}

function ssimGrid(
  a: Float64Array,
  b: Float64Array,
  w: number,
  c1: number,
  c2: number,
  gw: number,
  gh: number,
): Float64Array {
  const out = new Float64Array(gw * gh)
  const n = WIN * WIN
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      let s1 = 0
      let s2 = 0
      let s11 = 0
      let s22 = 0
      let s12 = 0
      for (let dy = 0; dy < WIN; dy++) {
        let i = (gy * WIN + dy) * w + gx * WIN
        for (let dx = 0; dx < WIN; dx++, i++) {
          const x = a[i]
          const y = b[i]
          s1 += x
          s2 += y
          s11 += x * x
          s22 += y * y
          s12 += x * y
        }
      }
      const mu1 = s1 / n
      const mu2 = s2 / n
      const v1 = s11 / n - mu1 * mu1
      const v2 = s22 / n - mu2 * mu2
      const cov = s12 / n - mu1 * mu2
      out[gy * gw + gx] =
        ((2 * mu1 * mu2 + c1) * (2 * cov + c2)) /
        ((mu1 * mu1 + mu2 * mu2 + c1) * (v1 + v2 + c2))
    }
  }
  return out
}

function dilate8(m: Uint8Array, gw: number, gh: number): Uint8Array {
  const out = new Uint8Array(gw * gh)
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      if (!m[y * gw + x]) continue
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= gh) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= gw) continue
          out[ny * gw + nx] = 1
        }
      }
    }
  }
  return out
}

function erode8(m: Uint8Array, gw: number, gh: number): Uint8Array {
  const out = new Uint8Array(gw * gh)
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      let all = 1
      for (let dy = -1; dy <= 1 && all; dy++) {
        const ny = y + dy
        for (let dx = -1; dx <= 1 && all; dx++) {
          const nx = x + dx
          if (ny < 0 || ny >= gh || nx < 0 || nx >= gw || !m[ny * gw + nx]) all = 0
        }
      }
      out[y * gw + x] = all
    }
  }
  return out
}

function components8(m: Uint8Array, gw: number, gh: number): number[][] {
  const seen = new Uint8Array(gw * gh)
  const comps: number[][] = []
  const stack: number[] = []
  for (let start = 0; start < m.length; start++) {
    if (!m[start] || seen[start]) continue
    const cells: number[] = []
    stack.push(start)
    seen[start] = 1
    while (stack.length) {
      const i = stack.pop() as number
      cells.push(i)
      const x = i % gw
      const y = (i / gw) | 0
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= gh) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= gw) continue
          const ni = ny * gw + nx
          if (m[ni] && !seen[ni]) {
            seen[ni] = 1
            stack.push(ni)
          }
        }
      }
    }
    comps.push(cells)
  }
  return comps
}

export function diffImages(moveIn: ImageData, moveOut: ImageData): DiffRegion[] {
  const s = Math.min(1, WORK_LONG_EDGE / Math.max(moveIn.width, moveIn.height))
  // 工作网格取 WIN 的整数倍，避免边缘残窗
  const tw = Math.max(WIN, Math.round((moveIn.width * s) / WIN) * WIN)
  const th = Math.max(WIN, Math.round((moveIn.height * s) / WIN) * WIN)
  const gw = tw / WIN
  const gh = th / WIN

  const [ri, gi, bi] = resamplePlanes(moveIn, tw, th)
  const [ro, go, bo] = resamplePlanes(moveOut, tw, th)
  const labIn = toLabPlanes(ri, gi, bi)
  const labOut = toLabPlanes(ro, go, bo)

  // 三通道各自算 SSIM，取最小：任一通道结构变了就算差异
  const smin = new Float64Array(gw * gh).fill(1)
  for (let c = 0; c < 3; c++) {
    const grid = ssimGrid(labIn[c], labOut[c], tw, SSIM_C1[c], SSIM_C2[c], gw, gh)
    for (let i = 0; i < smin.length; i++) {
      if (grid[i] < smin[i]) smin[i] = grid[i]
    }
  }

  const mask = new Uint8Array(gw * gh)
  for (let i = 0; i < mask.length; i++) mask[i] = smin[i] < SSIM_THRESHOLD ? 1 : 0
  const closed = erode8(dilate8(mask, gw, gh), gw, gh)

  const totalPx = tw * th
  const regions: DiffRegion[] = []
  for (const cells of components8(closed, gw, gh)) {
    if ((cells.length * WIN * WIN) / totalPx <= MIN_AREA_RATIO) continue
    let gx0 = gw
    let gx1 = 0
    let gy0 = gh
    let gy1 = 0
    let ssum = 0
    for (const i of cells) {
      const x = i % gw
      const y = (i / gw) | 0
      if (x < gx0) gx0 = x
      if (x > gx1) gx1 = x
      if (y < gy0) gy0 = y
      if (y > gy1) gy1 = y
      ssum += 1 - smin[i]
    }
    const x0 = gx0 * WIN
    const y0 = gy0 * WIN
    const w = Math.min(tw - x0, (gx1 - gx0 + 1) * WIN)
    const h = Math.min(th - y0, (gy1 - gy0 + 1) * WIN)
    regions.push({ bbox: [x0 / tw, y0 / th, w / tw, h / th], strength: ssum / cells.length })
  }
  regions.sort((a, b) => b.strength - a.strength)
  return regions.slice(0, MAX_REGIONS)
}
