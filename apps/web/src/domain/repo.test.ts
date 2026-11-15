import { describe, expect, it } from 'vitest'

import {
  buildExportPayload,
  collectCaseTree,
  newId,
  parseImportPayload,
  type CaseTreeSnapshot,
} from './repo'
import type { Photo } from './types'

const snap: CaseTreeSnapshot = {
  rooms: [
    { id: 'r1', caseId: 'c1' },
    { id: 'r2', caseId: 'c1' },
    { id: 'r3', caseId: 'c2' },
  ],
  captures: [
    { id: 'cp1', roomId: 'r1' },
    { id: 'cp2', roomId: 'r3' },
  ],
  photos: [
    { id: 'p1', captureId: 'cp1' },
    { id: 'p2', captureId: 'cp2' },
  ],
  defects: [
    { id: 'd1', photoId: 'p1' },
    { id: 'd2', photoId: 'p2' },
  ],
  findings: [{ id: 'f1', roomId: 'r1' }],
  judgements: [{ findingId: 'f1' }, { findingId: 'f-x' }],
  deductions: [
    { id: 'dd1', caseId: 'c1' },
    { id: 'dd2', caseId: 'c2' },
  ],
  letters: [{ id: 'l1', caseId: 'c1' }],
}

describe('collectCaseTree', () => {
  it('只收集本案件的后代，不碰其他案件', () => {
    expect(collectCaseTree('c1', snap)).toEqual({
      roomIds: ['r1', 'r2'],
      captureIds: ['cp1'],
      photoIds: ['p1'],
      defectIds: ['d1'],
      findingIds: ['f1'],
      judgementKeys: ['f1'],
      deductionIds: ['dd1'],
      letterIds: ['l1'],
    })
  })

  it('不存在的案件返回全空', () => {
    const ids = collectCaseTree('c-none', snap)
    expect(ids.roomIds).toHaveLength(0)
    expect(ids.photoIds).toHaveLength(0)
    expect(ids.deductionIds).toHaveLength(0)
  })
})

describe('newId', () => {
  it('生成唯一 ID', () => {
    expect(newId()).not.toEqual(newId())
  })
})

describe('buildExportPayload', () => {
  it('剥离照片二进制，仅保留哈希与元数据', () => {
    const photo: Photo = {
      id: 'p1',
      captureId: 'cp1',
      slot: 'wall-n',
      blob: new Blob(['a']),
      thumb: new Blob(['b']),
      takenAt: '2026-11-15T00:00:00.000Z',
      sha256: 'aa',
      prevHash: 'GENESIS',
      chainHash: 'cc',
    }
    const payload = buildExportPayload(
      {
        cases: [],
        rooms: [],
        captures: [],
        photos: [photo],
        defects: [],
        findings: [],
        judgements: [],
        deductions: [],
        letters: [],
      },
      '2026-11-15T00:00:00.000Z',
    )
    expect(payload.version).toBe(1)
    expect(payload.exportedAt).toBe('2026-11-15T00:00:00.000Z')
    expect(payload.photos).toEqual([
      {
        id: 'p1',
        captureId: 'cp1',
        slot: 'wall-n',
        takenAt: '2026-11-15T00:00:00.000Z',
        sha256: 'aa',
        prevHash: 'GENESIS',
        chainHash: 'cc',
      },
    ])
  })
})

describe('parseImportPayload', () => {
  it('坏 JSON 返回失败原因', () => {
    expect(parseImportPayload('{oops')).toEqual({ ok: false, reason: '不是有效的 JSON' })
  })

  it('版本不支持返回失败', () => {
    const raw = JSON.stringify({ version: 2 })
    expect(parseImportPayload(raw).ok).toBe(false)
  })

  it('含照片行的合法载荷提示照片缺失', () => {
    const raw = JSON.stringify({
      version: 1,
      exportedAt: '2026-11-15T00:00:00.000Z',
      cases: [],
      rooms: [],
      captures: [],
      photos: [{ id: 'p1' }],
      defects: [],
      findings: [],
      judgements: [],
      deductions: [],
      letters: [],
    })
    const result = parseImportPayload(raw)
    expect(result).toMatchObject({ ok: true, missingPhotos: true })
  })
})
