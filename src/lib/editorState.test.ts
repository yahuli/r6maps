import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveSelectedMarker, shouldRestoreAddActionAfterDeleteCleanup, shouldShowDraftMarker } from './editorState'
import type { CommunityMarker, DraftMarker } from '../types'

const markerA: CommunityMarker = {
  id: 'marker-a',
  mapId: 'bank',
  floorId: '1f',
  type: 'door',
  label: 'Door A',
  x: 0.2,
  y: 0.3,
  source: 'community',
  status: 'published',
}

const markerB: CommunityMarker = {
  ...markerA,
  id: 'marker-b',
  label: 'Door B',
  x: 0.4,
}

const draft: DraftMarker = {
  mapId: 'bank',
  floorId: '1f',
  type: 'door',
  label: 'Door',
  x: 0.5,
  y: 0.5,
}

test('resolveSelectedMarker does not fall back to the first marker after selection is cleared', () => {
  assert.equal(resolveSelectedMarker([markerA, markerB], ''), undefined)
  assert.equal(resolveSelectedMarker([markerA, markerB], 'missing'), undefined)
  assert.equal(resolveSelectedMarker([markerA, markerB], 'marker-b')?.id, 'marker-b')
})

test('shouldShowDraftMarker hides the draft marker after delete action', () => {
  assert.equal(
    shouldShowDraftMarker({
      canEdit: true,
      draft,
      draftAction: 'delete',
      floorId: '1f',
      hasFloor: true,
      mapId: 'bank',
    }),
    false,
  )

  assert.equal(
    shouldShowDraftMarker({
      canEdit: true,
      draft,
      draftAction: 'add',
      floorId: '1f',
      hasFloor: true,
      mapId: 'bank',
    }),
    true,
  )
})

test('shouldRestoreAddActionAfterDeleteCleanup keeps delete action when selection was cleared', () => {
  assert.equal(
    shouldRestoreAddActionAfterDeleteCleanup({
      draftAction: 'delete',
      pendingDeleteCount: 0,
      selectedMarkerId: '',
    }),
    false,
  )

  assert.equal(
    shouldRestoreAddActionAfterDeleteCleanup({
      draftAction: 'delete',
      pendingDeleteCount: 0,
      selectedMarkerId: 'marker-a',
    }),
    true,
  )
})
