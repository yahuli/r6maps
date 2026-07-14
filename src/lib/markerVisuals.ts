import type { MarkerType } from '../types'

export const R6CALLS_MARKER_TYPE_ORDER = [
  'bomb',
  'floor-hatch',
  'ceiling-hatch',
  'breakable-wall',
  'line-of-sight-wall',
  'line-of-sight-floor',
  'skylight',
  'drone-tunnel',
  'camera',
  'ladder',
  'fire-extinguisher',
  'gas-pipe',
  'insertion-point',
  'text-label',
  'compass',
  'wall',
  'door',
  'double-door',
  'window',
  'double-window',
] as const satisfies readonly MarkerType[]

export type R6CallsMarkerType = (typeof R6CALLS_MARKER_TYPE_ORDER)[number]

export const R6CALLS_EDIT_SYMBOL_TYPES = new Set<MarkerType>(R6CALLS_MARKER_TYPE_ORDER)
export const R6CALLS_LEGEND_MARKER_TYPES = [...R6CALLS_MARKER_TYPE_ORDER]

export function hasR6CallsEditSymbol(markerType: MarkerType): markerType is R6CallsMarkerType {
  return R6CALLS_EDIT_SYMBOL_TYPES.has(markerType)
}
