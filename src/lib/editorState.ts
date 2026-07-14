import type { CommunityMarker, DraftMarker } from '../types'

export type EditorDraftAction = 'add' | 'delete' | 'update'

export function resolveSelectedMarker(markers: CommunityMarker[], selectedMarkerId: string) {
  if (!selectedMarkerId) {
    return undefined
  }

  return markers.find((marker) => marker.id === selectedMarkerId)
}

export function shouldShowDraftMarker({
  canEdit,
  draft,
  draftAction,
  floorId,
  hasFloor,
  mapId,
}: {
  canEdit: boolean
  draft: DraftMarker
  draftAction: EditorDraftAction
  floorId?: string
  hasFloor: boolean
  mapId: string
}) {
  return canEdit && hasFloor && draftAction !== 'delete' && draft.mapId === mapId && draft.floorId === floorId
}

export function shouldRestoreAddActionAfterDeleteCleanup({
  draftAction,
  pendingDeleteCount,
  selectedMarkerId,
}: {
  draftAction: EditorDraftAction
  pendingDeleteCount: number
  selectedMarkerId: string
}) {
  return draftAction === 'delete' && pendingDeleteCount === 0 && selectedMarkerId !== ''
}
