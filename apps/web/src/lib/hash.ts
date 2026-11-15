import type { ID } from '@/domain/types'

// 证据链（PLAN.md T07）：chainHash = SHA256(prevChainHash + sha256 + takenAtISO)，首张 prevHash = GENESIS。
// 只用 WebCrypto，不引第三方。链只覆盖 photoId/sha256/takenAt 元数据，不重算图像哈希。
export const GENESIS = 'GENESIS'

export interface ChainPhoto {
  id: ID
  sha256: string
  takenAt: string
  prevHash: string
  chainHash: string
}

export type ChainVerifyResult =
  | { ok: true; count: number }
  | {
      ok: false
      breakIndex: number
      photoId: ID
      reason: 'genesis' | 'prev-mismatch' | 'hash-mismatch'
    }

export async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('crypto.subtle 不可用（需要 https 或 localhost）')
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function computeChainHash(
  prevChainHash: string,
  sha256: string,
  takenAtISO: string,
): Promise<string> {
  return sha256Hex(prevChainHash + sha256 + takenAtISO)
}

function byChainOrder(a: ChainPhoto, b: ChainPhoto): number {
  if (a.takenAt !== b.takenAt) return a.takenAt < b.takenAt ? -1 : 1
  return a.id < b.id ? -1 : 1
}

export function sortChain<T extends ChainPhoto>(photos: T[]): T[] {
  return [...photos].sort(byChainOrder)
}

export async function verifyChain(photos: ChainPhoto[]): Promise<ChainVerifyResult> {
  const sorted = sortChain(photos)
  let prev = GENESIS
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i]
    if (p.prevHash !== prev) {
      return {
        ok: false,
        breakIndex: i,
        photoId: p.id,
        reason: i === 0 && p.prevHash !== GENESIS ? 'genesis' : 'prev-mismatch',
      }
    }
    const expect = await computeChainHash(p.prevHash, p.sha256, p.takenAt)
    if (p.chainHash !== expect) {
      return { ok: false, breakIndex: i, photoId: p.id, reason: 'hash-mismatch' }
    }
    prev = p.chainHash
  }
  return { ok: true, count: sorted.length }
}
