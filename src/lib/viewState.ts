import type { MapFloor } from '../types'

export type ViewerMode = 'view' | 'edit'

export interface ViewerRouteState {
  mapId?: string
  floorArg?: string
  filter: string
  mode: ViewerMode
}

export interface ViewerTransform {
  scale: number
  x: number
  y: number
}

export interface ReferencePoint {
  x: number
  y: number
  originFloorId: string
  originFloorSort: number
}

export interface PointerPosition {
  pointerId: number
  clientX: number
  clientY: number
}

export interface ReferenceClickCandidate {
  pointerId: number
  clientX: number
  clientY: number
  point: ReferencePoint
}

export const DEFAULT_SPLIT_VIEW = true
export const VIEWER_MIN_SCALE = 0.45
export const VIEWER_MAX_SCALE = 5
export const REFERENCE_CLICK_MAX_DISTANCE_PX = 5
export const PING_MARKER_BASE_RADIUS = 7
export const PING_MARKER_MIN_RADIUS = 4
export const PING_MARKER_MAX_RADIUS = 10
export const PING_MARKER_BORDER_PERCENT = 0.2
export const PING_MARKER_MIN_BORDER = 1

export type PingOtherFloorDirection = 'origin' | 'up' | 'down'

export interface PingMarkerRadius {
  radius: number
  accentRadius: number
  strokeWidth: number
}

export function beginReferenceClick(pointer: PointerPosition, point: ReferencePoint): ReferenceClickCandidate {
  return {
    pointerId: pointer.pointerId,
    clientX: pointer.clientX,
    clientY: pointer.clientY,
    point,
  }
}

export function isReferenceClick(
  candidate: ReferenceClickCandidate | null,
  pointer: PointerPosition,
  blocked = false,
): boolean {
  if (!candidate || blocked || candidate.pointerId !== pointer.pointerId) {
    return false
  }

  return Math.hypot(pointer.clientX - candidate.clientX, pointer.clientY - candidate.clientY) <= REFERENCE_CLICK_MAX_DISTANCE_PX
}

export function hasReferencePointerMoved(candidate: ReferenceClickCandidate | null, pointer: PointerPosition): boolean {
  if (!candidate || candidate.pointerId !== pointer.pointerId) {
    return false
  }

  return Math.hypot(pointer.clientX - candidate.clientX, pointer.clientY - candidate.clientY) > 0
}

export function getPingMarkerRadius(scale: number): PingMarkerRadius {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1
  let radius = Math.round(PING_MARKER_BASE_RADIUS / safeScale)
  radius = Math.max(PING_MARKER_MIN_RADIUS, radius)
  radius = Math.min(PING_MARKER_MAX_RADIUS, radius)
  const strokeWidth = Math.max(PING_MARKER_MIN_BORDER, Math.floor(radius * PING_MARKER_BORDER_PERCENT))

  radius -= strokeWidth

  return {
    radius,
    accentRadius: radius * 2,
    strokeWidth,
  }
}

export function getPingOtherFloorDirection(
  point: ReferencePoint,
  floorId: string,
  floorSort: number,
): PingOtherFloorDirection {
  if (point.originFloorId === floorId) {
    return 'origin'
  }

  return point.originFloorSort < floorSort ? 'down' : 'up'
}

export function parseViewerHash(hash: string): ViewerRouteState {
  const parts = hash.replace(/^#/, '').split('/').filter(Boolean)

  return {
    mapId: parts[0],
    floorArg: parts[1],
    filter: parts[2] ?? 'all',
    mode: parts.includes('edit') ? 'edit' : 'view',
  }
}

export function routeFloorArgFromId(floorId: string): string {
  const numeric = floorId.match(/^(\d+)f$/)

  return numeric ? numeric[1] : floorId
}

export function buildViewerHash(mapId: string, floorId: string, mode: ViewerMode): string {
  const base = `#${mapId}/${routeFloorArgFromId(floorId)}/all`

  return mode === 'edit' ? `${base}/edit` : base
}

export function resolveRouteFloorId(floors: MapFloor[], floorArg?: string): string | undefined {
  if (floors.length === 0) {
    return undefined
  }

  if (!floorArg) {
    return floors[0]?.id
  }

  const exact = floors.find((floor) => floor.id === floorArg)
  if (exact) {
    return exact.id
  }

  const numeric = floors.find((floor) => floor.id === `${floorArg}f` || String(floor.sort) === floorArg)

  return numeric?.id ?? floors[0]?.id
}

export function getAdjacentFloorId(floors: MapFloor[], selectedFloorId: string): string | undefined {
  const sorted = [...floors].sort((left, right) => left.sort - right.sort)
  const index = sorted.findIndex((floor) => floor.id === selectedFloorId)

  if (index < 0) {
    return sorted[1]?.id ?? sorted[0]?.id
  }

  const next = sorted[index + 1]
  if (next && next.id !== 'roof') {
    return next.id
  }

  return sorted[index - 1]?.id
}

export function getPanelFloorIds(floors: MapFloor[], selectedFloorId: string, split: boolean): string[] {
  if (!split) {
    return [selectedFloorId]
  }

  const adjacent = getAdjacentFloorId(floors, selectedFloorId)

  if (!adjacent || adjacent === selectedFloorId) {
    return [selectedFloorId]
  }

  const floorById = new Map(floors.map((floor) => [floor.id, floor]))

  return [selectedFloorId, adjacent].sort((leftId, rightId) => {
    const leftSort = floorById.get(leftId)?.sort ?? 0
    const rightSort = floorById.get(rightId)?.sort ?? 0

    return leftSort - rightSort
  })
}

export function getWorkspacePanelFloorIds(
  floors: MapFloor[],
  selectedFloorId: string,
  split: boolean,
  secondaryFloorId?: string | null,
): string[] {
  const automaticFloorIds = getPanelFloorIds(floors, selectedFloorId, split)

  if (!split) {
    return automaticFloorIds
  }

  const validSecondaryFloorId = floors.some(
    (floor) => floor.id === secondaryFloorId && floor.id !== selectedFloorId,
  )
    ? secondaryFloorId
    : automaticFloorIds.find((floorId) => floorId !== selectedFloorId)

  if (!validSecondaryFloorId || validSecondaryFloorId === selectedFloorId) {
    return [selectedFloorId]
  }

  const floorSortById = new Map(floors.map((floor) => [floor.id, floor.sort]))

  return [selectedFloorId, validSecondaryFloorId].sort(
    (leftId, rightId) => (floorSortById.get(leftId) ?? 0) - (floorSortById.get(rightId) ?? 0),
  )
}

export function clampViewerTransform(transform: ViewerTransform): ViewerTransform {
  return {
    ...transform,
    scale: Math.min(VIEWER_MAX_SCALE, Math.max(VIEWER_MIN_SCALE, Number(transform.scale.toFixed(3)))),
  }
}
