import type { CommunityMarker, DraftMarker, TranslationEntry } from '../types'

type ReplacePatchFile = {
  path: string
  action: 'replace'
  content: CommunityMarker[]
}

type TranslationRemoveChange = {
  entityType: TranslationEntry['entityType']
  entityId: string
  field?: TranslationEntry['field']
  locale?: string
}

type TranslationChangesFile = {
  path: 'public/data/community/translations.json'
  action: 'translation-changes'
  changes: {
    upsert?: TranslationEntry[]
    remove?: TranslationRemoveChange[]
  }
}

export type PatchFile = ReplacePatchFile | TranslationChangesFile

export type Patch = {
  branch: string
  title: string
  files: PatchFile[]
  checklist: string[]
}

type UpdateMarkerPatchOptions = {
  locale?: string
  localizedLabel?: string
  localizedLabelsByMarkerId?: Record<string, string>
  existingTranslations?: TranslationEntry[]
}

export function buildMarkerPatch(
  draft: DraftMarker,
  existingMarkers: CommunityMarker[],
  options?: {
    locale?: string
    localizedLabel?: string
    existingTranslations?: TranslationEntry[]
  },
) {
  const marker = markerFromNewDraft(draft, existingMarkers)

  const files: PatchFile[] = [
    {
      path: markerFilePathForMapId(draft.mapId),
      action: 'replace',
      content: [...existingMarkers.filter((existingMarker) => existingMarker.mapId === draft.mapId), marker],
    },
  ]

  const localizedLabel = options?.localizedLabel?.trim()
  if (options?.locale && options.locale !== 'en' && localizedLabel) {
    const translation: TranslationEntry = {
      entityType: 'marker',
      entityId: marker.id,
      field: 'label',
      locale: options.locale,
      value: localizedLabel,
      status: 'proposed',
    }

    files.push({
      path: 'public/data/community/translations.json',
      action: 'translation-changes',
      changes: {
        upsert: [translation],
      },
    })
  }

  return {
    branch: `community/${marker.id}`,
    title: `Add ${marker.label} to ${draft.mapId}`,
    files,
    checklist: [
      'Only community data changed',
      'Coordinates are normalized between 0 and 1',
      'Localized labels are stored in public/data/community/translations.json',
      'CI renders preview diff before votes are counted',
      'Auto merge waits for qualified support and checks opposition',
    ],
  }
}

export function buildChangeSetPatch({
  addDraft,
  addDrafts,
  updates,
  deleteMarkerIds,
  markers,
  translations,
  options,
}: {
  addDraft?: DraftMarker
  addDrafts?: DraftMarker[]
  updates?: Array<{ markerId: string; draft: DraftMarker }>
  deleteMarkerIds?: string[]
  markers: CommunityMarker[]
  translations: TranslationEntry[]
  options?: UpdateMarkerPatchOptions
}) {
  const markerById = new Map(markers.map((marker) => [marker.id, marker]))
  const deleteIds = new Set(deleteMarkerIds ?? [])
  const touchedMapIds = new Set<string>()
  const seenUpdateIds = new Set<string>()
  const replacements = new Map<string, CommunityMarker>()

  for (const markerId of deleteIds) {
    const marker = markerById.get(markerId)

    if (!marker) {
      throw new Error(`Cannot build change set patch for unknown delete marker: ${markerId}`)
    }

    touchedMapIds.add(marker.mapId)
  }

  for (const update of updates ?? []) {
    if (seenUpdateIds.has(update.markerId)) {
      throw new Error(`Cannot build change set patch with duplicate marker update: ${update.markerId}`)
    }
    seenUpdateIds.add(update.markerId)

    const marker = markerById.get(update.markerId)

    if (!marker) {
      throw new Error(`Cannot build change set patch for unknown update marker: ${update.markerId}`)
    }

    touchedMapIds.add(marker.mapId)

    if (!deleteIds.has(update.markerId)) {
      replacements.set(update.markerId, replacementMarkerFromDraft(marker, update.draft))
    }
  }

  const addMarkers: CommunityMarker[] = []
  for (const draft of [addDraft, ...(addDrafts ?? [])].filter((draft): draft is DraftMarker => Boolean(draft))) {
    const marker = markerFromNewDraft(draft, [...markers, ...addMarkers])

    addMarkers.push(marker)
    touchedMapIds.add(marker.mapId)
  }

  if (touchedMapIds.size === 0) {
    throw new Error('Cannot build change set patch without changes')
  }

  const files: PatchFile[] = Array.from(touchedMapIds)
    .sort()
    .map((mapId) => {
      const content = markers
        .filter((marker) => marker.mapId === mapId && !deleteIds.has(marker.id))
        .map((marker) => replacements.get(marker.id) ?? marker)

      content.push(...addMarkers.filter((marker) => marker.mapId === mapId))

      return {
        path: markerFilePathForMapId(mapId),
        action: 'replace',
        content,
      }
    })

  const localizedTranslations = localizedUpdateTranslations(new Set(replacements.keys()), options)
  const addLocalizedLabel = options?.localizedLabel?.trim()
  const addTranslation =
    addMarkers.length === 1 && options?.locale && options.locale !== 'en' && addLocalizedLabel
      ? {
          entityType: 'marker' as const,
          entityId: addMarkers[0].id,
          field: 'label' as const,
          locale: options.locale,
          value: addLocalizedLabel,
          status: 'proposed' as const,
        }
      : undefined
  const translationUpserts = [addTranslation, ...localizedTranslations].filter((translation): translation is TranslationEntry =>
    Boolean(translation),
  )
  const translationRemovals = Array.from(deleteIds)
    .filter((markerId) => translations.some((translation) => translation.entityType === 'marker' && translation.entityId === markerId))
    .map((markerId) => ({
      entityType: 'marker' as const,
      entityId: markerId,
    }))

  if (translationUpserts.length > 0 || translationRemovals.length > 0) {
    files.push({
      path: 'public/data/community/translations.json',
      action: 'translation-changes',
      changes: {
        ...(translationUpserts.length > 0 ? { upsert: translationUpserts } : {}),
        ...(translationRemovals.length > 0 ? { remove: translationRemovals } : {}),
      },
    })
  }

  const addCount = addMarkers.length
  const updateCount = replacements.size
  const deleteCount = deleteIds.size
  const mapLabel = touchedMapIds.size === 1 ? Array.from(touchedMapIds)[0] : `${touchedMapIds.size}-maps`

  return {
    branch: `community/change-set-${mapLabel}-${addCount}-add-${updateCount}-update-${deleteCount}-delete`,
    title: `Submit community marker changes (${addCount} add, ${updateCount} update, ${deleteCount} delete)`,
    files,
    checklist: [
      'Only community data changed',
      'Marker files are grouped by map',
      'Coordinates are normalized between 0 and 1',
      'Deleted marker translations were removed',
      'CI validates references before maintainers convert the issue to a PR',
    ],
  }
}

export function buildDeleteMarkerPatch({
  markerId,
  markers,
  translations,
}: {
  markerId: string
  markers: CommunityMarker[]
  translations: TranslationEntry[]
}) {
  const marker = markers.find((candidate) => candidate.id === markerId)

  if (!marker) {
    throw new Error(`Cannot build delete patch for unknown marker: ${markerId}`)
  }

  const remainingTranslations = translations.filter(
    (translation) => !(translation.entityType === 'marker' && translation.entityId === markerId),
  )
  const files: PatchFile[] = [
    {
      path: markerFilePathForMapId(marker.mapId),
      action: 'replace',
      content: markers.filter((candidate) => candidate.mapId === marker.mapId && candidate.id !== markerId),
    },
  ]

  if (remainingTranslations.length !== translations.length) {
    files.push({
      path: 'public/data/community/translations.json',
      action: 'translation-changes',
      changes: {
        remove: [
          {
            entityType: 'marker',
            entityId: markerId,
          },
        ],
      },
    })
  }

  return {
    branch: `community/delete-${markerId}`,
    title: `Delete marker ${markerId}`,
    files,
    checklist: [
      'Only community data changed',
      'Related marker translations were removed',
      'CI validates references after deletion',
      'Auto merge waits for qualified support and checks opposition',
    ],
  }
}

export function buildUpdateMarkerPatch({
  draft,
  markerId,
  markers,
  options,
}: {
  draft: DraftMarker
  markerId: string
  markers: CommunityMarker[]
  options?: UpdateMarkerPatchOptions
}) {
  return buildUpdateMarkersPatch({
    updates: [{ markerId, draft }],
    markers,
    options: options?.localizedLabel
      ? {
          ...options,
          localizedLabelsByMarkerId: {
            ...options.localizedLabelsByMarkerId,
            [markerId]: options.localizedLabel,
          },
        }
      : options,
  })
}

export function buildUpdateMarkersPatch({
  updates,
  markers,
  options,
}: {
  updates: Array<{ markerId: string; draft: DraftMarker }>
  markers: CommunityMarker[]
  options?: UpdateMarkerPatchOptions
}) {
  if (updates.length === 0) {
    throw new Error('Cannot build update patch without marker updates')
  }

  const markerById = new Map(markers.map((marker) => [marker.id, marker]))
  const seenUpdateIds = new Set<string>()
  const replacements = new Map<string, CommunityMarker>()
  let mapId: string | undefined

  for (const update of updates) {
    if (seenUpdateIds.has(update.markerId)) {
      throw new Error(`Cannot build update patch with duplicate marker update: ${update.markerId}`)
    }
    seenUpdateIds.add(update.markerId)

    const marker = markerById.get(update.markerId)

    if (!marker) {
      throw new Error(`Cannot build update patch for unknown marker: ${update.markerId}`)
    }
    if (mapId && marker.mapId !== mapId) {
      throw new Error('Cannot build a single update patch across multiple maps')
    }

    mapId = marker.mapId
    replacements.set(update.markerId, replacementMarkerFromDraft(marker, update.draft))
  }

  const updateIds = new Set(replacements.keys())
  const files: PatchFile[] = [
    {
      path: markerFilePathForMapId(mapId ?? updates[0].draft.mapId),
      action: 'replace',
      content: markers
        .filter((candidate) => candidate.mapId === mapId)
        .map((candidate) => replacements.get(candidate.id) ?? candidate),
    },
  ]
  const localizedTranslations = localizedUpdateTranslations(updateIds, options)

  if (localizedTranslations.length > 0) {
    files.push({
      path: 'public/data/community/translations.json',
      action: 'translation-changes',
      changes: {
        upsert: localizedTranslations,
      },
    })
  }

  const firstUpdateId = updates[0].markerId

  return {
    branch: updates.length === 1 ? `community/update-${firstUpdateId}` : `community/update-${mapId}-${updates.length}-markers`,
    title: updates.length === 1 ? `Update marker ${firstUpdateId}` : `Update ${updates.length} markers in ${mapId}`,
    files,
    checklist: [
      'Only community data changed',
      'Existing marker ids are preserved',
      'Coordinates are normalized between 0 and 1',
      'CI validates references after update',
      'Auto merge waits for qualified support and checks opposition',
    ],
  }
}

function replacementMarkerFromDraft(marker: CommunityMarker, draft: DraftMarker): CommunityMarker {
  const normalizedDraft = normalizeDraftMarker({
    ...draft,
    mapId: marker.mapId,
    floorId: marker.floorId,
  })

  return {
    id: marker.id,
    mapId: marker.mapId,
    floorId: marker.floorId,
    type: normalizedDraft.type,
    label: normalizedDraft.label,
    x: roundCoordinate(normalizedDraft.x),
    y: roundCoordinate(normalizedDraft.y),
    ...markerMetadataFromDraft(normalizedDraft),
    source: marker.source,
    status: marker.status,
  }
}

function markerFromNewDraft(draft: DraftMarker, existingMarkers: CommunityMarker[]): CommunityMarker {
  const normalizedDraft = normalizeDraftMarker(draft)
  const normalizedLabel = normalizedDraft.label
  const slug = normalizedLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 42)
  const markerId = uniqueMarkerId(
    `${normalizedDraft.mapId}-${normalizedDraft.floorId}-${normalizedDraft.type}-${slug || 'marker'}`,
    existingMarkers,
  )

  return {
    id: markerId,
    mapId: normalizedDraft.mapId,
    floorId: normalizedDraft.floorId,
    type: normalizedDraft.type,
    label: normalizedLabel,
    x: roundCoordinate(normalizedDraft.x),
    y: roundCoordinate(normalizedDraft.y),
    ...markerMetadataFromDraft(normalizedDraft),
    source: 'community',
    status: 'proposed',
  }
}

function localizedUpdateTranslations(updateIds: Set<string>, options?: UpdateMarkerPatchOptions): TranslationEntry[] {
  if (!options?.locale || options.locale === 'en') {
    return []
  }

  const locale = options.locale

  return Array.from(updateIds).flatMap((markerId) => {
    const localizedLabel =
      options.localizedLabelsByMarkerId?.[markerId]?.trim() ??
      (updateIds.size === 1 ? options.localizedLabel?.trim() : undefined)

    if (!localizedLabel) {
      return []
    }

    return [
      {
        entityType: 'marker',
        entityId: markerId,
        field: 'label',
        locale,
        value: localizedLabel,
        status: 'proposed',
      },
    ]
  })
}

function markerFilePathForMapId(mapId: string) {
  return `public/data/community/markers/${mapId}.json`
}

export function summarizePatchForPreview(patch: Patch) {
  return {
    branch: patch.branch,
    title: patch.title,
    files: patch.files.map((file) => {
      if (file.action === 'translation-changes') {
        return {
          path: file.path,
          action: file.action,
          upsertCount: file.changes.upsert?.length ?? 0,
          removeCount: file.changes.remove?.length ?? 0,
          sample: [...(file.changes.upsert ?? []), ...(file.changes.remove ?? [])].slice(-3),
        }
      }

      return {
        path: file.path,
        action: file.action,
        itemCount: file.content.length,
        sample: file.content.slice(-3),
      }
    }),
    checklist: patch.checklist,
  }
}

function roundCoordinate(value: number) {
  return Math.round(value * 1000) / 1000
}

function uniqueMarkerId(baseId: string, existingMarkers: CommunityMarker[]) {
  const existingIds = new Set(existingMarkers.map((marker) => marker.id))

  if (!existingIds.has(baseId)) {
    return baseId
  }

  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${baseId}-${suffix}`

    if (!existingIds.has(candidate)) {
      return candidate
    }
  }
}

function normalizeDraftMarker(draft: DraftMarker): DraftMarker {
  if (draft.type === 'bomb') {
    const siteNumber = positiveIntegerOrDefault(draft.siteNumber, 1)
    const siteLetter = draft.siteLetter === 'B' ? 'B' : 'A'

    return {
      ...draft,
      label: `Bomb ${siteNumber}${siteLetter}`,
      siteNumber,
      siteLetter,
    }
  }

  if (draft.type === 'spawn') {
    const spawnNumber = positiveIntegerOrDefault(draft.spawnNumber, 1)
    const spawnName = draft.spawnName?.trim() || spawnNameFromLabel(draft.label) || 'Main Gate'

    return {
      ...draft,
      label: `${spawnNumber} - ${spawnName}`,
      spawnNumber,
      spawnName,
    }
  }

  if (draft.type === 'vertical-route') {
    const direction = draft.direction === 'down' ? 'down' : 'up'

    return {
      ...draft,
      label: `Vertical route ${direction}`,
      direction,
    }
  }

  if (draft.type === 'text-label') {
    return {
      ...draft,
      label: draft.label.trim() || 'Area label',
    }
  }

  return {
    ...draft,
    label: draft.label.trim() || defaultMarkerLabel(draft.type),
  }
}

function markerMetadataFromDraft(draft: DraftMarker) {
  const size = normalizedMarkerSize(draft.size)
  const visualMetadata = {
    ...(size && size !== 1 ? { size } : {}),
    ...markerRotationMetadataFromDraft(draft),
  }

  if (draft.type === 'bomb') {
    return {
      siteNumber: draft.siteNumber,
      siteLetter: draft.siteLetter,
      ...visualMetadata,
    }
  }

  if (draft.type === 'spawn') {
    return {
      spawnNumber: draft.spawnNumber,
      spawnName: draft.spawnName?.trim(),
      ...visualMetadata,
    }
  }

  if (draft.type === 'vertical-route') {
    return {
      direction: draft.direction,
      ...visualMetadata,
    }
  }

  return visualMetadata
}

function markerRotationMetadataFromDraft(draft: DraftMarker) {
  const rotation = normalizedMarkerRotation(draft.rotation)

  return rotation !== undefined && rotation !== 0 ? { rotation } : {}
}

function normalizedMarkerSize(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined
  }

  return Math.round(Math.min(2.5, Math.max(0.5, value)) * 10) / 10
}

function normalizedMarkerRotation(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined
  }

  return Math.round(Math.min(180, Math.max(-180, value)))
}

function positiveIntegerOrDefault(value: number | undefined, fallback: number) {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback
}

function spawnNameFromLabel(label: string) {
  return label.replace(/^\d+\s*-\s*/, '').trim()
}

function defaultMarkerLabel(type: DraftMarker['type']) {
  if (type === 'camera') return 'Security camera'
  if (type === 'ceiling-hatch') return 'Ceiling hatch'
  if (type === 'floor-hatch') return 'Floor hatch'
  if (type === 'breakable-wall') return 'Breakable wall'
  if (type === 'line-of-sight-wall') return 'Line of sight wall'
  if (type === 'line-of-sight-floor') return 'Line of sight floor'
  if (type === 'text-label') return 'Label'
  if (type === 'spawn') return '1 - Main Gate'
  if (type === 'skylight') return 'Skylight'
  if (type === 'drone-tunnel') return 'Drone tunnel'
  if (type === 'vertical-route') return 'Vertical route up'
  if (type === 'ladder') return 'Ladder'
  if (type === 'fire-extinguisher') return 'Fire extinguisher'
  if (type === 'gas-pipe') return 'Gas pipe'
  if (type === 'insertion-point') return 'Insertion point'
  if (type === 'compass') return 'Compass'
  if (type === 'wall') return 'Wall'
  if (type === 'door') return 'Door'
  if (type === 'double-door') return 'Double door'
  if (type === 'window') return 'Window'
  if (type === 'double-window') return 'Double window'
  return 'New community marker'
}
