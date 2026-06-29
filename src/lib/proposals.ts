import type { CommunityMarker, MarkerStatus, MarkerType } from '../types'

export type ProposalRisk = 'low' | 'medium' | 'high' | 'unknown'
export type ProposalCheckState = 'passing' | 'pending' | 'failing' | 'unknown'
export type ProposalMarkerDiffKind = 'added' | 'updated' | 'deleted'

export interface ProposalVoteSummary {
  up: number
  down: number
  net: number
}

export interface ProposalSummary {
  number: number
  title: string
  author: string
  risk: ProposalRisk
  votes: ProposalVoteSummary
  checkState: ProposalCheckState
  githubUrl: string
  updatedAt: string
  changedFileCount: number
}

export interface ProposalChangedFile {
  path: string
  status: string
  additions?: number
  deletions?: number
  changes?: number
  allowed?: boolean
}

export interface ProposalMarkerDiff {
  kind: ProposalMarkerDiffKind
  markerId: string
  before?: CommunityMarker
  after?: CommunityMarker
}

export interface ProposalDetail extends ProposalSummary {
  body: string
  changedFiles: ProposalChangedFile[]
  markerDiffs: ProposalMarkerDiff[]
  previewMarkers: CommunityMarker[]
}

type UnknownRecord = Record<string, unknown>

const MARKER_TYPES = new Set<MarkerType>([
  'camera',
  'ceiling-hatch',
  'text-label',
  'spawn',
  'skylight',
  'vertical-route',
  'ladder',
  'bomb',
])

export function normalizeProposalList(payload: unknown): ProposalSummary[] {
  const items = Array.isArray(payload)
    ? payload
    : arrayValue(recordValue(payload, 'proposals')) ??
      arrayValue(recordValue(payload, 'items')) ??
      arrayValue(recordValue(payload, 'data')) ??
      []

  return items.map(normalizeProposalSummary).filter((proposal): proposal is ProposalSummary => proposal !== null)
}

export function normalizeProposalDetail(payload: unknown): ProposalDetail | null {
  const record = proposalRecord(payload)
  if (!record) {
    return null
  }

  const summary = normalizeProposalSummary(record)
  if (!summary) {
    return null
  }

  const changedFiles = normalizeChangedFiles(
    arrayValue(record.changedFiles) ??
      arrayValue(record.files) ??
      arrayValue(recordValue(recordValue(record, 'pullRequest'), 'files')) ??
      [],
  )
  const markerDiffs = normalizeMarkerDiffs(record)
  const previewMarkers = normalizePreviewMarkers(record)

  return {
    ...summary,
    body: stringValue(record.body) ?? stringValue(record.description) ?? '',
    changedFiles,
    markerDiffs,
    previewMarkers,
    changedFileCount: summary.changedFileCount || changedFiles.length,
  }
}

export function buildProposalPreviewMarkers(baseMarkers: CommunityMarker[], detail: ProposalDetail): CommunityMarker[] {
  if (detail.previewMarkers.length > 0) {
    return detail.previewMarkers
  }

  if (detail.markerDiffs.length === 0) {
    return baseMarkers
  }

  const markerById = new Map(baseMarkers.map((marker) => [marker.id, marker]))

  for (const diff of detail.markerDiffs) {
    if (diff.kind === 'deleted') {
      markerById.delete(diff.markerId)
      continue
    }

    const nextMarker = diff.after
    if (nextMarker) {
      markerById.set(nextMarker.id, nextMarker)
    }
  }

  return Array.from(markerById.values())
}

export function proposalDeletedGhostMarkers(detail: ProposalDetail): CommunityMarker[] {
  return detail.markerDiffs
    .filter((diff) => diff.kind === 'deleted' && diff.before)
    .map((diff) => diff.before as CommunityMarker)
}

export function proposalMarkerDiffKindById(detail: ProposalDetail): Map<string, ProposalMarkerDiffKind> {
  const diffById = new Map<string, ProposalMarkerDiffKind>()

  for (const diff of detail.markerDiffs) {
    diffById.set(diff.markerId, diff.kind)
    if (diff.after) {
      diffById.set(diff.after.id, diff.kind)
    }
    if (diff.before) {
      diffById.set(diff.before.id, diff.kind)
    }
  }

  return diffById
}

export function firstProposalMarker(detail: ProposalDetail): CommunityMarker | undefined {
  return (
    detail.markerDiffs.find((diff) => diff.after)?.after ??
    detail.markerDiffs.find((diff) => diff.before)?.before ??
    detail.previewMarkers[0]
  )
}

function proposalRecord(payload: unknown): UnknownRecord | null {
  const record = asRecord(payload)

  if (!record) {
    return null
  }

  return asRecord(record.proposal) ?? asRecord(record.data) ?? record
}

function normalizeProposalSummary(value: unknown): ProposalSummary | null {
  const record = asRecord(value)

  if (!record) {
    return null
  }

  const pullRequest = asRecord(record.pullRequest)
  const number =
    numberValue(record.number) ??
    numberValue(record.prNumber) ??
    numberValue(record.pullRequestNumber) ??
    numberValue(pullRequest?.number)

  if (number === undefined || !Number.isInteger(number) || number <= 0) {
    return null
  }

  const votes = normalizeVotes(record)
  const changedFiles = arrayValue(record.changedFiles) ?? arrayValue(record.files)

  return {
    number,
    title: stringValue(record.title) ?? stringValue(pullRequest?.title) ?? `#${number}`,
    author: authorName(record) ?? 'unknown',
    risk: normalizeRisk(record),
    votes,
    checkState: normalizeCheckState(record),
    githubUrl:
      stringValue(record.githubUrl) ??
      stringValue(record.htmlUrl) ??
      stringValue(record.prUrl) ??
      stringValue(record.url) ??
      stringValue(pullRequest?.htmlUrl) ??
      stringValue(pullRequest?.url) ??
      '',
    updatedAt: stringValue(record.updatedAt) ?? stringValue(record.createdAt) ?? stringValue(pullRequest?.updatedAt) ?? '',
    changedFileCount:
      numberValue(record.changedFileCount) ??
      numberValue(record.fileCount) ??
      numberValue(pullRequest?.changedFiles) ??
      changedFiles?.length ??
      0,
  }
}

function normalizeVotes(record: UnknownRecord): ProposalVoteSummary {
  const votes = asRecord(record.votes) ?? asRecord(record.voteSummary) ?? asRecord(record.reactions) ?? {}
  const up =
    numberValue(votes.approvals) ??
    numberValue(votes.up) ??
    numberValue(votes.upVotes) ??
    numberValue(votes.support) ??
    numberValue(votes.positive) ??
    numberValue(votes['+1']) ??
    numberValue(record.upVotes) ??
    0
  const down =
    numberValue(votes.rejections) ??
    numberValue(votes.down) ??
    numberValue(votes.downVotes) ??
    numberValue(votes.opposition) ??
    numberValue(votes.negative) ??
    numberValue(votes['-1']) ??
    numberValue(record.downVotes) ??
    0

  return {
    up,
    down,
    net: numberValue(votes.net) ?? numberValue(record.netVotes) ?? up - down,
  }
}

function normalizeRisk(record: UnknownRecord): ProposalRisk {
  const risk = asRecord(record.risk)
  const label =
    stringValue(risk?.level) ??
    stringValue(risk?.label) ??
    stringValue(record.risk) ??
    stringValue(record.riskLevel) ??
    stringValue(record.riskLabel) ??
    labels(record).find((item) => item.startsWith('risk-')) ??
    ''
  const normalized = label.toLowerCase()

  if (normalized.includes('high')) {
    return 'high'
  }
  if (normalized.includes('medium')) {
    return 'medium'
  }
  if (normalized.includes('low')) {
    return 'low'
  }

  return 'unknown'
}

function normalizeCheckState(record: UnknownRecord): ProposalCheckState {
  const checks = asRecord(record.checks) ?? asRecord(record.checkStatus) ?? asRecord(record.statusCheck)
  const raw =
    stringValue(record.checkState) ??
    stringValue(record.checkStatus) ??
    stringValue(record.status) ??
    stringValue(checks?.state) ??
    stringValue(checks?.status) ??
    stringValue(checks?.conclusion) ??
    ''
  const passed = booleanValue(record.checksPassed) ?? booleanValue(checks?.passed)
  const normalized = raw.toLowerCase()

  if (passed === true || ['success', 'passing', 'passed', 'complete', 'completed'].includes(normalized)) {
    return 'passing'
  }
  if (['failure', 'failed', 'error', 'cancelled', 'failing'].includes(normalized)) {
    return 'failing'
  }
  if (['pending', 'queued', 'in_progress', 'running', 'neutral'].includes(normalized)) {
    return 'pending'
  }
  if (['missing', 'unknown'].includes(normalized)) {
    return 'unknown'
  }
  if (passed === false) {
    return 'failing'
  }

  return 'unknown'
}

function normalizeChangedFiles(files: unknown[]): ProposalChangedFile[] {
  return files
    .map((file) => {
      if (typeof file === 'string') {
        return { path: file, status: '' }
      }

      const record = asRecord(file)
      const path =
        stringValue(record?.path) ?? stringValue(record?.filename) ?? stringValue(record?.file) ?? stringValue(record?.name)

      if (!path) {
        return null
      }

      return {
        path,
        status: stringValue(record?.status) ?? stringValue(record?.changeType) ?? '',
        additions: numberValue(record?.additions),
        deletions: numberValue(record?.deletions),
        changes: numberValue(record?.changes),
        allowed: booleanValue(record?.allowed),
      }
    })
    .filter((file): file is ProposalChangedFile => file !== null)
}

function normalizeMarkerDiffs(record: UnknownRecord): ProposalMarkerDiff[] {
  const directDiffs =
    arrayValue(record.markerDiffs) ??
    arrayValue(record.markerDiff) ??
    arrayValue(recordValue(recordValue(record, 'diff'), 'markers')) ??
    arrayValue(recordValue(recordValue(record, 'preview'), 'diff')) ??
    arrayValue(recordValue(recordValue(record, 'markerPreview'), 'diff')) ??
    arrayValue(recordValue(recordValue(record, 'markerPreview'), 'markerDiffs')) ??
    []
  const diffs = directDiffs
    .map((diff) => normalizeMarkerDiff(diff))
    .filter((diff): diff is ProposalMarkerDiff => diff !== null)

  diffs.push(...normalizeDiffMarkersByKind(record, 'addedMarkers', 'added'))
  diffs.push(...normalizeDiffMarkersByKind(record, 'updatedMarkers', 'updated'))
  diffs.push(...normalizeDiffMarkersByKind(record, 'deletedMarkers', 'deleted'))
  diffs.push(...normalizePreviewMarkerFileDiffs(record))

  return dedupeDiffs(diffs)
}

function normalizeDiffMarkersByKind(
  record: UnknownRecord,
  field: 'addedMarkers' | 'updatedMarkers' | 'deletedMarkers',
  kind: ProposalMarkerDiffKind,
): ProposalMarkerDiff[] {
  const diffs: ProposalMarkerDiff[] = []

  for (const marker of arrayValue(record[field]) ?? []) {
    const normalizedMarker = normalizeMarker(marker)
    if (!normalizedMarker) {
      continue
    }

    diffs.push({
      kind,
      markerId: normalizedMarker.id,
      ...(kind === 'deleted' ? { before: normalizedMarker } : { after: normalizedMarker }),
    })
  }

  return diffs
}

function normalizeMarkerDiff(value: unknown, fallbackMapId?: string): ProposalMarkerDiff | null {
  const record = asRecord(value)
  if (!record) {
    return null
  }

  const before =
    normalizeMarker(record.before, fallbackMapId) ??
    normalizeMarker(record.old, fallbackMapId) ??
    normalizeMarker(record.original, fallbackMapId) ??
    undefined
  const after =
    normalizeMarker(record.after, fallbackMapId) ??
    normalizeMarker(record.new, fallbackMapId) ??
    normalizeMarker(record.next, fallbackMapId) ??
    normalizeMarker(record.marker, fallbackMapId) ??
    undefined
  const kind = normalizeDiffKind(stringValue(record.kind) ?? stringValue(record.type) ?? stringValue(record.status) ?? stringValue(record.action), {
    before,
    after,
  })
  const markerId = stringValue(record.markerId) ?? stringValue(record.id) ?? after?.id ?? before?.id

  if (!kind || !markerId) {
    return null
  }

  return {
    kind,
    markerId,
    ...(before ? { before } : {}),
    ...(after ? { after } : {}),
  }
}

function normalizePreviewMarkerFileDiffs(record: UnknownRecord): ProposalMarkerDiff[] {
  const diffs: ProposalMarkerDiff[] = []

  for (const markerFile of previewMarkerFiles(record)) {
    const fileRecord = asRecord(markerFile)
    if (!fileRecord) {
      continue
    }

    const mapId = stringValue(fileRecord.mapId)
    const diff = asRecord(fileRecord.diff)
    if (!diff) {
      continue
    }

    for (const marker of arrayValue(diff.added) ?? []) {
      const after = normalizeMarker(marker, mapId)
      if (after) {
        diffs.push({ kind: 'added', markerId: after.id, after })
      }
    }

    for (const update of arrayValue(diff.updated) ?? []) {
      const normalized = normalizeMarkerDiff(update, mapId)
      if (normalized) {
        diffs.push({ ...normalized, kind: 'updated' })
      }
    }

    for (const marker of arrayValue(diff.deleted) ?? []) {
      const before = normalizeMarker(marker, mapId)
      if (before) {
        diffs.push({ kind: 'deleted', markerId: before.id, before })
      }
    }
  }

  return diffs
}

function normalizeDiffKind(
  raw: string | undefined,
  markers: { before?: CommunityMarker; after?: CommunityMarker },
): ProposalMarkerDiffKind | null {
  const normalized = raw?.toLowerCase() ?? ''

  if (['added', 'add', 'created', 'new'].includes(normalized)) {
    return 'added'
  }
  if (['updated', 'update', 'modified', 'changed', 'renamed'].includes(normalized)) {
    return 'updated'
  }
  if (['deleted', 'delete', 'removed', 'remove'].includes(normalized)) {
    return 'deleted'
  }
  if (markers.before && markers.after) {
    return 'updated'
  }
  if (markers.after) {
    return 'added'
  }
  if (markers.before) {
    return 'deleted'
  }

  return null
}

function normalizePreviewMarkers(record: UnknownRecord): CommunityMarker[] {
  const candidates =
    arrayValue(record.previewMarkers) ??
    arrayValue(record.markersPreview) ??
    arrayValue(recordValue(recordValue(record, 'preview'), 'markers')) ??
    arrayValue(recordValue(recordValue(record, 'markerPreview'), 'markers')) ??
    arrayValue(record.markers) ??
    []

  const markers = candidates.map((marker) => normalizeMarker(marker)).filter((marker): marker is CommunityMarker => marker !== null)

  for (const markerFile of previewMarkerFiles(record)) {
    const fileRecord = asRecord(markerFile)
    if (!fileRecord) {
      continue
    }

    const mapId = stringValue(fileRecord.mapId)
    for (const marker of markerArrayValue(fileRecord.content)) {
      const normalizedMarker = normalizeMarker(marker, mapId)
      if (normalizedMarker) {
        markers.push(normalizedMarker)
      }
    }
  }

  return dedupeMarkers(markers)
}

function normalizeMarker(value: unknown, fallbackMapId?: string): CommunityMarker | null {
  const record = asRecord(value)

  if (!record) {
    return null
  }

  const id = stringValue(record.id) ?? stringValue(record.markerId)
  const mapId = stringValue(record.mapId) ?? fallbackMapId
  const floorId = stringValue(record.floorId)
  const type = stringValue(record.type)
  const x = numberValue(record.x)
  const y = numberValue(record.y)

  if (!id || !mapId || !floorId || !type || !MARKER_TYPES.has(type as MarkerType) || x === undefined || y === undefined) {
    return null
  }

  return {
    id,
    mapId,
    floorId,
    type: type as MarkerType,
    label: stringValue(record.label) ?? type,
    x,
    y,
    ...(numberValue(record.siteNumber) !== undefined ? { siteNumber: numberValue(record.siteNumber) } : {}),
    ...(record.siteLetter === 'A' || record.siteLetter === 'B' ? { siteLetter: record.siteLetter } : {}),
    ...(numberValue(record.spawnNumber) !== undefined ? { spawnNumber: numberValue(record.spawnNumber) } : {}),
    ...(stringValue(record.spawnName) !== undefined ? { spawnName: stringValue(record.spawnName) as string } : {}),
    ...(record.direction === 'up' || record.direction === 'down' ? { direction: record.direction } : {}),
    ...(numberValue(record.size) !== undefined ? { size: numberValue(record.size) } : {}),
    ...(numberValue(record.rotation) !== undefined ? { rotation: numberValue(record.rotation) } : {}),
    source: record.source === 'official' ? 'official' : 'community',
    status: markerStatus(record.status),
  }
}

function markerStatus(value: unknown): MarkerStatus {
  return value === 'published' || value === 'deprecated' || value === 'proposed' ? value : 'proposed'
}

function dedupeDiffs(diffs: ProposalMarkerDiff[]): ProposalMarkerDiff[] {
  const seen = new Set<string>()

  return diffs.filter((diff) => {
    const mapId = diff.after?.mapId ?? diff.before?.mapId ?? ''
    const key = `${diff.kind}:${mapId}:${diff.markerId}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function dedupeMarkers(markers: CommunityMarker[]): CommunityMarker[] {
  const seen = new Set<string>()

  return markers.filter((marker) => {
    const key = `${marker.mapId}:${marker.id}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function previewMarkerFiles(record: UnknownRecord): unknown[] {
  return arrayValue(recordValue(recordValue(record, 'preview'), 'markerFiles')) ?? []
}

function markerArrayValue(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value
  }

  if (typeof value !== 'string' || !value.trim()) {
    return []
  }

  try {
    const parsed = JSON.parse(value) as unknown

    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function authorName(record: UnknownRecord): string | undefined {
  const author = asRecord(record.author)
  const user = asRecord(record.user)
  const createdBy = asRecord(record.createdBy)

  return (
    stringValue(record.authorLogin) ??
    stringValue(author?.login) ??
    stringValue(author?.name) ??
    stringValue(user?.login) ??
    stringValue(user?.name) ??
    stringValue(createdBy?.login) ??
    stringValue(createdBy?.name) ??
    stringValue(record.author)
  )
}

function labels(record: UnknownRecord): string[] {
  const items = arrayValue(record.labels) ?? []

  return items
    .map((label) => {
      if (typeof label === 'string') {
        return label
      }
      return stringValue(recordValue(label, 'name'))
    })
    .filter((label): label is string => Boolean(label))
    .map((label) => label.toLowerCase())
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : null
}

function recordValue(value: unknown, key: string): unknown {
  return asRecord(value)?.[key]
}

function arrayValue(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  return undefined
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}
