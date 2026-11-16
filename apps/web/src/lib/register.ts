// T12 配准：双图降采样 512 灰度 → ORB → RANSAC 单应。
// opencv.js（13MB WASM）只在进入对比流程时加载；加载失败返回 load-failed，不阻断流程。
// 返回的 H 把退租照片坐标映射到入住照片坐标（原始分辨率坐标系），供 T13 差异检测内部对齐使用；
// 按 PLAN T12 备注，不自动裁剪、不把矫正后的图重绘给用户看。

type OpenCv = typeof import('@techstark/opencv-js')
// ?url 让 Vite 把 13MB UMD 作为静态资产发射（dev 直接可取，build 进 dist/assets）
import opencvUrl from '@techstark/opencv-js/dist/opencv.js?url'

declare global {
  interface Window {
    cv?: OpenCv
  }
}

export type RegisterResult =
  | { ok: true; H: number[]; inliers: number }
  | { ok: false; reason: 'few-inliers' | 'singular' | 'load-failed' }

const WORK = 512
const MIN_INLIERS = 20
const ORB_FEATURES = 800
const LOWE_RATIO = 0.75
const RANSAC_THRESH = 3.0

let pending: Promise<CvBundle> | null = null
let injected: OpenCv | null = null

// emscripten 的 Module 对象自带 then（promise-ready 惯例）：
// 直接 resolve 它会被当成 thenable 永远挂起，所以一律包一层普通对象再走 promise。
export interface CvBundle {
  cv: OpenCv
}

// 单测在 Node 里跑，浏览器加载路径走不到，用注入替身。
export function setOpenCv(m: OpenCv | null): void {
  injected = m
  pending = null
}

export function loadOpenCV(onProgress?: (ratio: number) => void): Promise<CvBundle> {
  if (injected) return Promise.resolve({ cv: injected })
  if (pending) return pending
  pending = doLoad(onProgress)
  pending.catch(() => {
    pending = null
  })
  return pending
}

async function doLoad(onProgress?: (ratio: number) => void): Promise<CvBundle> {
  const existing = window.cv
  if (existing?.Mat && existing.ORB) return { cv: existing }
  const code = await fetchWithProgress(opencvUrl, onProgress)
  await runScript(code)
  return { cv: await waitReady() }
}

async function fetchWithProgress(url: string, onProgress?: (ratio: number) => void): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error('对齐引擎加载失败')
  if (!res.body) return await res.text()
  const total = Number(res.headers.get('Content-Length') ?? 0)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    if (total > 0) onProgress?.(Math.min(1, received / total))
  }
  const all = new Uint8Array(received)
  let off = 0
  for (const c of chunks) {
    all.set(c, off)
    off += c.length
  }
  return new TextDecoder().decode(all)
}

function runScript(code: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
    const s = document.createElement('script')
    s.src = url
    s.onload = () => {
      URL.revokeObjectURL(url)
      resolve()
    }
    s.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('对齐引擎加载失败'))
    }
    document.head.appendChild(s)
  })
}

async function waitReady(): Promise<OpenCv> {
  const deadline = Date.now() + 30000
  for (;;) {
    const cv = window.cv
    if (cv?.Mat && cv.ORB) return cv
    if (Date.now() > deadline) throw new Error('对齐引擎初始化超时')
    await new Promise((r) => setTimeout(r, 60))
  }
}

function rgbaMat(cv: OpenCv, img: ImageData) {
  const m = new cv.Mat(img.height, img.width, cv.CV_8UC4)
  m.data.set(img.data)
  return m
}

function toGray(cv: OpenCv, img: ImageData) {
  const scale = Math.min(1, WORK / Math.max(img.width, img.height))
  const w2 = Math.max(1, Math.round(img.width * scale))
  const h2 = Math.max(1, Math.round(img.height * scale))
  const rgba = rgbaMat(cv, img)
  const small = new cv.Mat()
  const gray = new cv.Mat()
  try {
    cv.resize(rgba, small, new cv.Size(w2, h2), 0, 0, cv.INTER_AREA)
    cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY)
  } finally {
    rgba.delete()
    small.delete()
  }
  return { gray, w2, h2 }
}

// H_full = S_in⁻¹ · H_work · S_out：S_out 把退租图原始坐标缩到工作分辨率，
// H_work 在工作分辨率上映射，S_in⁻¹ 再把结果放大回入住图原始分辨率。
// H 行主序 [h0 h1 h2; h3 h4 h5; h6 h7 h8]，列向量齐次坐标。
function scaleHomography(H: number[], wIn: number, hIn: number, wOut: number, hOut: number): number[] {
  const sxA = WORK / Math.max(wIn, hIn)
  const syA = sxA
  const sxB = WORK / Math.max(wOut, hOut)
  const syB = sxB
  const toWork = [sxB, 0, 0, 0, syB, 0, 0, 0, 1]
  const toFull = [1 / sxA, 0, 0, 0, 1 / syA, 0, 0, 0, 1]
  const mul = (m: number[], n: number[]): number[] => {
    const r = new Array<number>(9)
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        r[i * 3 + j] = m[i * 3] * n[j] + m[i * 3 + 1] * n[3 + j] + m[i * 3 + 2] * n[6 + j]
      }
    }
    return r
  }
  return mul(toFull, mul(H, toWork))
}

export async function registerPair(moveIn: ImageData, moveOut: ImageData): Promise<RegisterResult> {
  let cv: OpenCv
  try {
    ;({ cv } = await loadOpenCV())
  } catch {
    return { ok: false, reason: 'load-failed' }
  }

  const a = toGray(cv, moveIn)
  const b = toGray(cv, moveOut)
  const kpA = new cv.KeyPointVector()
  const kpB = new cv.KeyPointVector()
  const desA = new cv.Mat()
  const desB = new cv.Mat()
  const knn = new cv.DMatchVectorVector()
  const mask = new cv.Mat()
  let Hmat: ReturnType<typeof cv.findHomography> | null = null
  try {
    const orb = new cv.ORB(ORB_FEATURES)
    try {
      orb.detectAndCompute(a.gray, new cv.Mat(), kpA, desA)
      orb.detectAndCompute(b.gray, new cv.Mat(), kpB, desB)
    } finally {
      orb.delete()
    }
    if (desB.rows === 0 || desA.rows === 0) return { ok: false, reason: 'few-inliers' }

    const bf = new cv.BFMatcher(cv.NORM_HAMMING, false)
    try {
      bf.knnMatch(desB, desA, knn, 2)
    } finally {
      bf.delete()
    }

    const src: number[] = []
    const dst: number[] = []
    for (let i = 0; i < knn.size(); i++) {
      const pair = knn.get(i)
      if (pair.size() < 2) continue
      const m0 = pair.get(0)
      const m1 = pair.get(1)
      if (m0.distance >= LOWE_RATIO * m1.distance) continue
      const pb = kpB.get(m0.queryIdx).pt
      const pa = kpA.get(m0.trainIdx).pt
      src.push(pb.x, pb.y)
      dst.push(pa.x, pa.y)
    }
    if (src.length < 16) return { ok: false, reason: 'few-inliers' }

    const srcMat = cv.matFromArray(src.length / 2, 1, cv.CV_32FC2, src)
    const dstMat = cv.matFromArray(dst.length / 2, 1, cv.CV_32FC2, dst)
    try {
      Hmat = cv.findHomography(srcMat, dstMat, cv.RANSAC, RANSAC_THRESH, mask)
    } finally {
      srcMat.delete()
      dstMat.delete()
    }
    if (!Hmat || Hmat.empty()) return { ok: false, reason: 'few-inliers' }

    const h = Array.from(Hmat.data64F)
    const det = h[0] * h[4] - h[1] * h[3]
    if (!h.every((v) => Number.isFinite(v)) || Math.abs(det) < 1e-8) {
      return { ok: false, reason: 'singular' }
    }
    const inliers = cv.countNonZero(mask)
    if (inliers < MIN_INLIERS) return { ok: false, reason: 'few-inliers' }

    return {
      ok: true,
      H: scaleHomography(h, moveIn.width, moveIn.height, moveOut.width, moveOut.height),
      inliers,
    }
  } finally {
    a.gray.delete()
    b.gray.delete()
    kpA.delete()
    kpB.delete()
    desA.delete()
    desB.delete()
    knn.delete()
    mask.delete()
    Hmat?.delete()
  }
}

// 用 H 把退租照片重采样到入住照片画幅（原始分辨率坐标系），供差异检测内部使用，不用于展示。
export async function warpTo(
  src: ImageData,
  H: number[],
  outW: number,
  outH: number,
): Promise<ImageData> {
  const { cv } = await loadOpenCV()
  const mat = rgbaMat(cv, src)
  const dst = new cv.Mat()
  try {
    const Hmat = cv.matFromArray(3, 3, cv.CV_64F, H)
    try {
      cv.warpPerspective(mat, dst, Hmat, new cv.Size(outW, outH))
    } finally {
      Hmat.delete()
    }
    const out = new Uint8ClampedArray(dst.data) // data 长度恰好 outH*outW*4
    return { data: out, width: outW, height: outH, colorSpace: 'srgb' }
  } finally {
    mat.delete()
    dst.delete()
  }
}

// ---- 手动对齐（配准失败时的降级路径）----

export interface ManualGesture {
  tx: number
  ty: number
  scale: number
  rot: number
}

export interface ViewportGeom {
  containerW: number
  containerH: number
  inW: number
  inH: number
  outW: number
  outH: number
}

// 把 overlay 上的手势换算成 3×3 仿射（行主序，退租像素 → 入住像素）。
// 约定：两图都按 contain 铺进容器；退租 overlay 元素摆在自己的 contain 矩形处，
// transformOrigin '0 0'，transform = translate(tx,ty) rotate(rot) scale(scale)。
export function gestureToHomography(g: ManualGesture, geo: ViewportGeom): number[] {
  const kOut = Math.min(geo.containerW / geo.outW, geo.containerH / geo.outH)
  const kIn = Math.min(geo.containerW / geo.inW, geo.containerH / geo.inH)
  const offOutX = (geo.containerW - geo.outW * kOut) / 2
  const offOutY = (geo.containerH - geo.outH * kOut) / 2
  const offInX = (geo.containerW - geo.inW * kIn) / 2
  const offInY = (geo.containerH - geo.inH * kIn) / 2
  const rad = (g.rot * Math.PI) / 180
  const cos = Math.cos(rad) * g.scale
  const sin = Math.sin(rad) * g.scale
  const k = kOut / kIn
  return [
    cos * k, -sin * k, (offOutX + g.tx - offInX) / kIn,
    sin * k, cos * k, (offOutY + g.ty - offInY) / kIn,
    0, 0, 1,
  ]
}
