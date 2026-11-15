import { describe, expect, it } from 'vitest'

import {
  computeChainHash,
  GENESIS,
  sortChain,
  verifyChain,
  type ChainPhoto,
} from './hash'

async function makeChain(n: number): Promise<ChainPhoto[]> {
  const rows: ChainPhoto[] = []
  let prev = GENESIS
  for (let i = 0; i < n; i++) {
    const sha256 = `sha-${i}`
    const takenAt = new Date(2026, 10, 15, 14, 0, i).toISOString()
    rows.push({
      id: `p${i}`,
      sha256,
      takenAt,
      prevHash: prev,
      chainHash: await computeChainHash(prev, sha256, takenAt),
    })
    prev = rows[i].chainHash
  }
  return rows
}

describe('证据链', () => {
  it('完整链校验通过', async () => {
    const rows = await makeChain(4)
    expect(await verifyChain(rows)).toEqual({ ok: true, count: 4 })
  })

  it('空链通过，计数为 0', async () => {
    expect(await verifyChain([])).toEqual({ ok: true, count: 0 })
  })

  it('乱序输入也按时间排序校验', async () => {
    const rows = await makeChain(3)
    expect(await verifyChain(sortChain(rows).reverse())).toEqual({ ok: true, count: 3 })
  })

  it('篡改 sha256 → 在该张断链', async () => {
    const rows = await makeChain(3)
    rows[1].sha256 = 'tampered'
    const r = await verifyChain(rows)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.breakIndex).toBe(1)
      expect(r.photoId).toBe('p1')
      expect(r.reason).toBe('hash-mismatch')
    }
  })

  it('篡改 takenAt → 在该张断链', async () => {
    const rows = await makeChain(3)
    rows[2].takenAt = new Date(2026, 10, 15, 23, 0, 0).toISOString()
    const r = await verifyChain(rows)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.breakIndex).toBe(2)
      expect(r.photoId).toBe('p2')
    }
  })

  it('改写 prevHash → prev-mismatch', async () => {
    const rows = await makeChain(3)
    rows[1].prevHash = 'forged'
    const r = await verifyChain(rows)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.breakIndex).toBe(1)
      expect(r.photoId).toBe('p1')
      expect(r.reason).toBe('prev-mismatch')
    }
  })

  it('首张不是 GENESIS → genesis 断链', async () => {
    const rows = await makeChain(2)
    rows[0].prevHash = ''
    const r = await verifyChain(rows)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.breakIndex).toBe(0)
      expect(r.reason).toBe('genesis')
    }
  })

  it('中间抽掉一张 → 下一张 prevHash 对不上，断链位置指向它', async () => {
    const rows = await makeChain(3)
    const [a, , c] = rows
    const r = await verifyChain([a, c])
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.breakIndex).toBe(1)
      expect(r.photoId).toBe('p2')
      expect(r.reason).toBe('prev-mismatch')
    }
  })
})
