import assert from 'node:assert/strict'
import test from 'node:test'
import { buildChangeSetPatch } from './prDraft'
import type { CommunityMarker, DraftMarker, TranslationEntry } from '../types'

const markers: CommunityMarker[] = []
const translations: TranslationEntry[] = []

test('buildChangeSetPatch preserves multiple added marker drafts', () => {
  const addDrafts: DraftMarker[] = [
    {
      mapId: 'bank',
      floorId: '1f',
      type: 'door',
      label: 'Door',
      x: 0.2,
      y: 0.3,
    },
    {
      mapId: 'bank',
      floorId: '1f',
      type: 'double-window',
      label: 'Double window',
      x: 0.4,
      y: 0.5,
    },
  ]

  const patch = buildChangeSetPatch({
    addDrafts,
    markers,
    translations,
  })

  const markerFile = patch.files.find((file) => file.path === 'public/data/community/markers/bank.json')

  assert.equal(markerFile?.action, 'replace')
  assert.equal(markerFile.content.length, 2)
  assert.deepEqual(
    markerFile.content.map((marker) => marker.type),
    ['door', 'double-window'],
  )
  assert.equal(new Set(markerFile.content.map((marker) => marker.id)).size, 2)
})

test('all marker draft families preserve size metadata', () => {
  const patch = buildChangeSetPatch({
    addDrafts: [
      {
        mapId: 'bank',
        floorId: '1f',
        type: 'floor-hatch',
        label: 'Floor hatch',
        x: 0.2,
        y: 0.3,
        size: 1.7,
      },
      {
        mapId: 'bank',
        floorId: '1f',
        type: 'ceiling-hatch',
        label: 'Ceiling hatch',
        x: 0.4,
        y: 0.5,
        size: 1.8,
      },
      {
        mapId: 'bank',
        floorId: '1f',
        type: 'camera',
        label: 'Camera',
        x: 0.5,
        y: 0.5,
        size: 1.4,
      },
      {
        mapId: 'bank',
        floorId: '1f',
        type: 'bomb',
        label: 'Bomb 1A',
        x: 0.6,
        y: 0.5,
        siteNumber: 1,
        siteLetter: 'A',
        size: 1.5,
      },
      {
        mapId: 'bank',
        floorId: '1f',
        type: 'spawn',
        label: '1 - Main Gate',
        x: 0.7,
        y: 0.5,
        spawnNumber: 1,
        spawnName: 'Main Gate',
        size: 1.6,
      },
      {
        mapId: 'bank',
        floorId: '1f',
        type: 'vertical-route',
        label: 'Vertical route down',
        x: 0.8,
        y: 0.5,
        direction: 'down',
        size: 1.9,
      },
      {
        mapId: 'bank',
        floorId: '1f',
        type: 'text-label',
        label: 'Vault',
        x: 0.9,
        y: 0.5,
        size: 2,
      },
    ],
    markers,
    translations,
  })

  const markerFile = patch.files.find((file) => file.path === 'public/data/community/markers/bank.json')

  assert.equal(markerFile?.action, 'replace')
  assert.deepEqual(
    markerFile.content.map((marker) => [marker.type, marker.size]),
    [
      ['floor-hatch', 1.7],
      ['ceiling-hatch', 1.8],
      ['camera', 1.4],
      ['bomb', 1.5],
      ['spawn', 1.6],
      ['vertical-route', 1.9],
      ['text-label', 2],
    ],
  )
})

test('default marker size is omitted from repository data', () => {
  const patch = buildChangeSetPatch({
    addDrafts: [
      {
        mapId: 'bank',
        floorId: '1f',
        type: 'camera',
        label: 'Camera',
        x: 0.2,
        y: 0.3,
        size: 1,
      },
    ],
    markers,
    translations,
  })

  const markerFile = patch.files.find((file) => file.path === 'public/data/community/markers/bank.json')

  assert.equal(markerFile?.action, 'replace')
  assert.equal(markerFile?.content[0].size, undefined)
})

test('vertical route drafts preserve down direction', () => {
  const patch = buildChangeSetPatch({
    addDrafts: [
      {
        mapId: 'bank',
        floorId: '1f',
        type: 'vertical-route',
        label: 'Vertical route down',
        x: 0.2,
        y: 0.3,
        direction: 'down',
      },
    ],
    markers,
    translations,
  })

  const markerFile = patch.files.find((file) => file.path === 'public/data/community/markers/bank.json')

  assert.equal(markerFile?.action, 'replace')
  assert.equal(markerFile.content[0].direction, 'down')
  assert.equal(markerFile.content[0].label, 'Vertical route down')
})

test('all marker draft types preserve rotation metadata', () => {
  const patch = buildChangeSetPatch({
    addDrafts: [
      {
        mapId: 'bank',
        floorId: '1f',
        type: 'door',
        label: 'Door',
        x: 0.2,
        y: 0.3,
        rotation: 45,
      },
      {
        mapId: 'bank',
        floorId: '1f',
        type: 'vertical-route',
        label: 'Vertical route down',
        x: 0.4,
        y: 0.5,
        direction: 'down',
        rotation: -30,
      },
    ],
    markers,
    translations,
  })

  const markerFile = patch.files.find((file) => file.path === 'public/data/community/markers/bank.json')

  assert.equal(markerFile?.action, 'replace')
  assert.deepEqual(
    markerFile.content.map((marker) => [marker.type, marker.rotation]),
    [
      ['door', 45],
      ['vertical-route', -30],
    ],
  )
})
