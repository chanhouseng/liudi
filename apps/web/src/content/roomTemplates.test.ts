import { describe, expect, it } from 'vitest'

import type { RoomKind } from '@/domain/types'

import { DEFAULT_ROOM_KINDS, ROOM_TEMPLATES, findSlot, getRoomTemplate } from './roomTemplates'

const ALL_KINDS: RoomKind[] = ['bedroom', 'living', 'kitchen', 'bath', 'balcony', 'entry']

describe('房间模板', () => {
  it('默认一居室共 18 个点位（克制，不是 60 个）', () => {
    const total = DEFAULT_ROOM_KINDS.reduce(
      (n, k) => n + getRoomTemplate(k).slots.length,
      0,
    )
    expect(total).toBe(18)
  })

  it('覆盖全部 6 种房间类型，顺序与 SCREENS.md S03 一致', () => {
    expect(ROOM_TEMPLATES.map((t) => t.kind)).toEqual([
      'entry',
      'living',
      'bedroom',
      'kitchen',
      'bath',
      'balcony',
    ])
    expect(ROOM_TEMPLATES.map((t) => t.kind).sort()).toEqual([...ALL_KINDS].sort())
  })

  it('每个点位的 id 在房间内唯一，且都有名称与「为什么拍」', () => {
    for (const t of ROOM_TEMPLATES) {
      const ids = t.slots.map((s) => s.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const s of t.slots) {
        expect(s.label.length).toBeGreaterThan(0)
        expect(s.why.length).toBeGreaterThan(0)
      }
    }
  })

  it('findSlot 命中与未命中', () => {
    expect(findSlot('entry', 'door')?.label).toBe('门与门锁')
    expect(findSlot('entry', 'wall-n')).toBeUndefined()
  })
})
