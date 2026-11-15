import type { RoomKind } from '@/domain/types'

export interface SlotTemplate {
  id: string
  label: string
  why: string
}

export interface RoomTemplate {
  kind: RoomKind
  label: string
  slots: SlotTemplate[]
}

// 一居室默认 6 房间共 18 个点位（克制上限，见 T05 验收）。
// 「为什么拍」文案对齐 SCREENS.md S04 示例，不要改写。
export const ROOM_TEMPLATES: RoomTemplate[] = [
  {
    kind: 'entry',
    label: '玄关',
    slots: [
      { id: 'door', label: '门与门锁', why: '好不好转，只有现在拍得清' },
      { id: 'floor', label: '地面', why: '划痕和烫痕要拍清反光' },
      { id: 'meter-e', label: '电表', why: '退租那天按这个数算' },
    ],
  },
  {
    kind: 'living',
    label: '客厅',
    slots: [
      { id: 'wall-n', label: '墙面-北', why: '污渍和钉眼最容易扯皮' },
      { id: 'wall-s', label: '墙面-南', why: '家具靠墙的压痕要留档' },
      { id: 'floor', label: '地面', why: '划痕和烫痕要拍清反光' },
      { id: 'window', label: '窗户与纱窗', why: '纱窗破没破，白天拍才清楚' },
    ],
  },
  {
    kind: 'bedroom',
    label: '卧室',
    slots: [
      { id: 'wall-n', label: '墙面-北', why: '污渍和钉眼最容易扯皮' },
      { id: 'floor', label: '地面', why: '划痕和烫痕要拍清反光' },
      { id: 'window', label: '窗户与窗帘', why: '窗帘杆和轨道要留档' },
    ],
  },
  {
    kind: 'kitchen',
    label: '厨房',
    slots: [
      { id: 'counter', label: '台面与水槽', why: '油渍和水垢，退租时最容易扯皮' },
      { id: 'meter-gas', label: '燃气表', why: '退租那天按这个数算' },
      { id: 'hood', label: '油烟机', why: '滤网油垢程度要留底' },
    ],
  },
  {
    kind: 'bath',
    label: '卫生间',
    slots: [
      { id: 'fixture', label: '洁具', why: '釉面划痕和黄渍要拍清' },
      { id: 'wall-tile', label: '墙面瓷砖', why: '霉缝和空鼓最容易扯皮' },
      { id: 'drain', label: '地漏与排水', why: '排水快不慢，现在试一次' },
    ],
  },
  {
    kind: 'balcony',
    label: '阳台',
    slots: [
      { id: 'floor', label: '地面', why: '晾晒痕迹和地漏要拍清' },
      { id: 'meter-w', label: '水表', why: '退租那天按这个数算' },
    ],
  },
]

export const DEFAULT_ROOM_KINDS: RoomKind[] = ROOM_TEMPLATES.map((t) => t.kind)

export function getRoomTemplate(kind: RoomKind): RoomTemplate {
  const t = ROOM_TEMPLATES.find((r) => r.kind === kind)
  if (!t) throw new Error(`未知的房间类型：${kind}`)
  return t
}

export function findSlot(kind: RoomKind, slotId: string): SlotTemplate | undefined {
  return getRoomTemplate(kind).slots.find((s) => s.id === slotId)
}
