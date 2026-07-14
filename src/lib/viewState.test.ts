import assert from 'node:assert/strict'
import test from 'node:test'
import { getWorkspacePanelFloorIds } from './viewState'
import type { MapFloor } from '../types'

const floors: MapFloor[] = [
  { id: 'b1', name: 'Basement', sort: -1, image: 'b1.webp' },
  { id: '1f', name: 'First floor', sort: 1, image: '1f.webp' },
  { id: '2f', name: 'Second floor', sort: 2, image: '2f.webp' },
  { id: 'roof', name: 'Roof', sort: 3, image: 'roof.webp' },
]

test('highest playable floor pairs with a distinct adjacent floor', () => {
  assert.deepEqual(getWorkspacePanelFloorIds(floors, '2f', true), ['1f', '2f'])
})

test('explicit secondary floor is kept when it differs from the primary floor', () => {
  assert.deepEqual(getWorkspacePanelFloorIds(floors, '1f', true, 'b1'), ['b1', '1f'])
})

test('duplicate secondary floor falls back to an adjacent floor', () => {
  assert.deepEqual(getWorkspacePanelFloorIds(floors, '2f', true, '2f'), ['1f', '2f'])
})

test('explicit higher secondary floor stays on the right', () => {
  assert.deepEqual(getWorkspacePanelFloorIds(floors, '1f', true, '2f'), ['1f', '2f'])
})

test('invalid secondary floor falls back to the sorted adjacent floor', () => {
  assert.deepEqual(getWorkspacePanelFloorIds(floors, '1f', true, 'missing'), ['1f', '2f'])
})

test('single view only returns the selected floor', () => {
  assert.deepEqual(getWorkspacePanelFloorIds(floors, '2f', false, 'b1'), ['2f'])
})

test('floor ordering uses sort values instead of input order', () => {
  assert.deepEqual(getWorkspacePanelFloorIds([...floors].reverse(), '2f', true, 'b1'), ['b1', '2f'])
})
