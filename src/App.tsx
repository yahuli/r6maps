import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Eye,
  ExternalLink,
  FileJson,
  GitPullRequestArrow,
  Maximize2,
  Minus,
  MousePointer2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  XCircle,
} from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import {
  InspectorTabs,
  WorkspaceModeSwitch,
  WorkspaceToolRail,
  type InspectorTab,
} from './components/WorkspaceChrome'
import { loadCommunityMarkers } from './lib/communityMarkers'
import {
  resolveSelectedMarker,
  shouldRestoreAddActionAfterDeleteCleanup,
  shouldShowDraftMarker,
  type EditorDraftAction,
} from './lib/editorState'
import { createTranslator, localizeEntity } from './lib/i18n'
import { buildChangeSetPatch, summarizePatchForPreview, type Patch } from './lib/prDraft'
import {
  buildProposalPreviewMarkers,
  firstProposalMarker,
  normalizeProposalDetail,
  normalizeProposalList,
  proposalDeletedGhostMarkers,
  proposalMarkerDiffKindById,
  type ProposalCheckState,
  type ProposalDetail,
  type ProposalMarkerDiffKind,
  type ProposalRisk,
  type ProposalSummary,
  type ProposalVoteSummary,
} from './lib/proposals'
import { R6CALLS_LEGEND_MARKER_TYPES, hasR6CallsEditSymbol } from './lib/markerVisuals'
import {
  DEFAULT_SPLIT_VIEW,
  beginReferenceClick,
  buildViewerHash,
  clampViewerTransform,
  getPingMarkerRadius,
  getPingOtherFloorDirection,
  getWorkspacePanelFloorIds,
  hasReferencePointerMoved,
  isReferenceClick,
  parseViewerHash,
  resolveRouteFloorId,
} from './lib/viewState'
import type { ReferenceClickCandidate, ReferencePoint } from './lib/viewState'
import type {
  CommunityMarker,
  DraftMarker,
  LocaleInfo,
  MarkerDirection,
  MarkerType,
  OfficialMap,
  TranslationEntry,
  UiMessages,
} from './types'

type MarkerGlyphData = Pick<CommunityMarker, 'type'> &
  Partial<
    Pick<CommunityMarker, 'siteNumber' | 'siteLetter' | 'spawnNumber' | 'spawnName' | 'direction' | 'label' | 'size' | 'rotation'>
  >
type ToolDragState = { toolId: string; pointerId: number }
type PendingAddDraft = { clientId: string; draft: DraftMarker }
type DraftAction = EditorDraftAction
type AppRoute = { kind: 'viewer' } | { kind: 'proposal-list' } | { kind: 'proposal-detail'; number: number }
type ProposalListState =
  | { status: 'idle' | 'loading' | 'unavailable' }
  | { status: 'ready'; proposals: ProposalSummary[] }
  | { status: 'error'; message: string }
type ProposalDetailState =
  | { status: 'idle' | 'loading' | 'unavailable' }
  | { status: 'ready'; detail: ProposalDetail }
  | { status: 'error'; message: string }

type MarkerToolDefinition = {
  id: string
  type: MarkerType
  labelKey: string
  defaultLabel: string
  direction?: MarkerDirection
}

const R6CALLS_MARKER_TOOLS: MarkerToolDefinition[] = [
  { id: 'bomb', type: 'bomb', labelKey: 'markerTypeBomb', defaultLabel: 'Bomb' },
  {
    id: 'floor-hatch',
    type: 'floor-hatch',
    labelKey: 'markerTypeFloorHatch',
    defaultLabel: 'Floor hatch',
  },
  {
    id: 'ceiling-hatch',
    type: 'ceiling-hatch',
    labelKey: 'markerTypeCeilingHatch',
    defaultLabel: 'Ceiling hatch',
  },
  {
    id: 'breakable-wall',
    type: 'breakable-wall',
    labelKey: 'markerTypeBreakableWall',
    defaultLabel: 'Breakable wall',
  },
  {
    id: 'line-of-sight-wall',
    type: 'line-of-sight-wall',
    labelKey: 'markerTypeLineOfSightWall',
    defaultLabel: 'Line of sight wall',
  },
  {
    id: 'line-of-sight-floor',
    type: 'line-of-sight-floor',
    labelKey: 'markerTypeLineOfSightFloor',
    defaultLabel: 'Line of sight floor',
  },
  { id: 'skylight', type: 'skylight', labelKey: 'markerTypeSkylight', defaultLabel: 'Skylight' },
  {
    id: 'drone-tunnel',
    type: 'drone-tunnel',
    labelKey: 'markerTypeDroneTunnel',
    defaultLabel: 'Drone tunnel',
  },
  {
    id: 'camera',
    type: 'camera',
    labelKey: 'markerTypeCamera',
    defaultLabel: 'Security camera',
  },
  { id: 'ladder', type: 'ladder', labelKey: 'markerTypeLadder', defaultLabel: 'Ladder' },
  {
    id: 'fire-extinguisher',
    type: 'fire-extinguisher',
    labelKey: 'markerTypeFireExtinguisher',
    defaultLabel: 'Fire extinguisher',
  },
  { id: 'gas-pipe', type: 'gas-pipe', labelKey: 'markerTypeGasPipe', defaultLabel: 'Gas pipe' },
  {
    id: 'insertion-point',
    type: 'insertion-point',
    labelKey: 'markerTypeInsertionPoint',
    defaultLabel: 'Insertion point',
  },
  { id: 'text-label', type: 'text-label', labelKey: 'markerTypeTextLabel', defaultLabel: 'Label' },
  { id: 'compass', type: 'compass', labelKey: 'markerTypeCompass', defaultLabel: 'Compass' },
  { id: 'wall', type: 'wall', labelKey: 'markerTypeWall', defaultLabel: 'Wall' },
  { id: 'door', type: 'door', labelKey: 'markerTypeDoor', defaultLabel: 'Door' },
  { id: 'double-door', type: 'double-door', labelKey: 'markerTypeDoubleDoor', defaultLabel: 'Double door' },
  { id: 'window', type: 'window', labelKey: 'markerTypeWindow', defaultLabel: 'Window' },
  {
    id: 'double-window',
    type: 'double-window',
    labelKey: 'markerTypeDoubleWindow',
    defaultLabel: 'Double window',
  },
]

const EXTRA_MARKER_TOOLS: MarkerToolDefinition[] = [
  { id: 'spawn', type: 'spawn', labelKey: 'markerTypeSpawn', defaultLabel: '1 - Main Gate' },
  {
    id: 'vertical-route-up',
    type: 'vertical-route',
    labelKey: 'markerTypeVerticalRouteUp',
    defaultLabel: 'Vertical route up',
    direction: 'up',
  },
  {
    id: 'vertical-route-down',
    type: 'vertical-route',
    labelKey: 'markerTypeVerticalRouteDown',
    defaultLabel: 'Vertical route down',
    direction: 'down',
  },
]

const MARKER_TOOLS = [...R6CALLS_MARKER_TOOLS, ...EXTRA_MARKER_TOOLS]
const MARKER_TOOL_GROUPS: Array<{ labelKey: string; toolIds: string[] }> = [
  { labelKey: 'toolGroupObjectives', toolIds: ['bomb', 'spawn', 'insertion-point'] },
  {
    labelKey: 'toolGroupStructure',
    toolIds: [
      'floor-hatch',
      'ceiling-hatch',
      'breakable-wall',
      'line-of-sight-wall',
      'line-of-sight-floor',
      'wall',
      'door',
      'double-door',
      'window',
      'double-window',
    ],
  },
  {
    labelKey: 'toolGroupFacilities',
    toolIds: ['skylight', 'drone-tunnel', 'camera', 'ladder', 'fire-extinguisher', 'gas-pipe'],
  },
  {
    labelKey: 'toolGroupCallouts',
    toolIds: ['text-label', 'compass', 'vertical-route-up', 'vertical-route-down'],
  },
]
const MARKER_DEFAULT_LABELS = new Map<MarkerType, string>()
for (const tool of MARKER_TOOLS) {
  if (!MARKER_DEFAULT_LABELS.has(tool.type)) {
    MARKER_DEFAULT_LABELS.set(tool.type, tool.defaultLabel)
  }
}
const MARKER_TOOL_BY_ID = new Map(MARKER_TOOLS.map((tool) => [tool.id, tool]))
const R6CALLS_LEGEND_TOOLS = R6CALLS_MARKER_TOOLS.filter((tool) =>
  R6CALLS_LEGEND_MARKER_TYPES.includes(tool.type as (typeof R6CALLS_LEGEND_MARKER_TYPES)[number]),
)
const DIRECTION_ICON_FILES = {
  up: 'up@2x.png',
  down: 'down@2x.png',
} as const

const DEFAULT_GITHUB_REPOSITORY = 'yahuli/r6maps'
const COMMUNITY_DATA_ISSUE_LABEL = 'community-data'
const PENDING_SUBMISSION_KEY = 'r6maps.pendingSubmissionPayload'
const PENDING_ADD_MARKER_ID_PREFIX = 'pending-add:'

function localizeFloorName(floor: OfficialMap['floors'][number], locale: string, translations: TranslationEntry[]) {
  return localizeEntity({
    entityType: 'floor',
    entityId: floor.id,
    field: 'name',
    fallback: floor.name,
    locale,
    translations,
  })
}

type IssueOpsPayload = {
  kind: 'r6maps-community-change-set'
  version: 1
  summary: ReturnType<typeof summarizePatchForPreview>
  patch: Patch
}

type SubmissionAuthResponse = {
  loginUrl: string
}

type SubmissionApiResult = {
  pullRequest: {
    number: number
    url: string
  }
  branch: string
}

function App() {
  const isCompact = useCompactViewport()
  const [maps, setMaps] = useState<OfficialMap[]>([])
  const [markers, setMarkers] = useState<CommunityMarker[]>([])
  const [translations, setTranslations] = useState<TranslationEntry[]>([])
  const [locales, setLocales] = useState<LocaleInfo[]>([])
  const [uiMessages, setUiMessages] = useState<UiMessages>({})
  const [dataLoaded, setDataLoaded] = useState(false)
  const [selectedLocale, setSelectedLocale] = useState(() => getInitialLocale())
  const [selectedMapId, setSelectedMapId] = useState('calypso-casino')
  const [selectedFloorId, setSelectedFloorId] = useState('1f')
  const [selectedMarkerId, setSelectedMarkerId] = useState('')
  const [showOfficialLayer, setShowOfficialLayer] = useState(true)
  const [showCommunityLayer, setShowCommunityLayer] = useState(true)
  const [editMode, setEditMode] = useState(false)
  const [splitView, setSplitView] = useState(() =>
    typeof window === 'undefined' || !window.matchMedia('(max-width: 760px)').matches ? DEFAULT_SPLIT_VIEW : false,
  )
  const [secondaryFloorId, setSecondaryFloorId] = useState<string | null>(null)
  const [legendOpen, setLegendOpen] = useState(false)
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('markers')
  const [toolSearch, setToolSearch] = useState('')
  const [referencePoint, setReferencePoint] = useState<ReferencePoint | null>(null)
  const [viewerTransform, setViewerTransform] = useState({ scale: 1, x: 0, y: 0 })
  const panPointer = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const draftDragPointer = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null)
  const [draft, setDraft] = useState<DraftMarker>({
    mapId: 'calypso-casino',
    floorId: '1f',
    type: 'ceiling-hatch',
    label: 'Vault hatch',
    x: 0.58,
    y: 0.36,
  })
  const [draftTranslationLocale, setDraftTranslationLocale] = useState(() => getInitialLocale())
  const [draftTranslationValue, setDraftTranslationValue] = useState('')
  const [draftAction, setDraftAction] = useState<DraftAction>('add')
  const [pendingAddDrafts, setPendingAddDrafts] = useState<PendingAddDraft[]>([])
  const [activeAddDraftId, setActiveAddDraftId] = useState<string | null>(null)
  const [pendingDeleteMarkerIds, setPendingDeleteMarkerIds] = useState<string[]>([])
  const [updatingMarkerId, setUpdatingMarkerId] = useState<string | null>(null)
  const [pendingMarkerUpdates, setPendingMarkerUpdates] = useState<Record<string, DraftMarker>>({})
  const [draggingDraft, setDraggingDraft] = useState(false)
  const [draggingTool, setDraggingTool] = useState<ToolDragState | null>(null)
  const [activePlacementToolId, setActivePlacementToolId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submissionNotice, setSubmissionNotice] = useState('')
  const [createdPullRequestUrl, setCreatedPullRequestUrl] = useState('')
  const [submitPayloadPreview, setSubmitPayloadPreview] = useState('')
  const [appRoute, setAppRoute] = useState<AppRoute>(() => parseAppHash(window.location.hash))
  const [proposalListState, setProposalListState] = useState<ProposalListState>({ status: 'idle' })
  const [proposalDetailState, setProposalDetailState] = useState<ProposalDetailState>({ status: 'idle' })
  const [proposalListReloadKey, setProposalListReloadKey] = useState(0)
  const [proposalDetailReloadKey, setProposalDetailReloadKey] = useState(0)
  const pendingAutoSubmissionAttempted = useRef(false)
  const proposalInitialSelection = useRef<number | null>(null)
  const draftRef = useRef<DraftMarker>(draft)
  const pendingAddDraftSerial = useRef(0)

  useEffect(() => {
    async function loadData() {
      const [officialMaps, communityMarkers, communityTranslations, availableLocales, messages] = await Promise.all([
        fetchJson<OfficialMap[]>('data/official/maps.json'),
        loadCommunityMarkers(fetchJson),
        fetchJson<TranslationEntry[]>('data/community/translations.json'),
        fetchJson<LocaleInfo[]>('data/i18n/locales.json'),
        fetchJson<UiMessages>('data/i18n/ui.json'),
      ])

      setMaps(officialMaps)
      setMarkers(communityMarkers)
      setTranslations(communityTranslations)
      setLocales(availableLocales)
      setUiMessages(messages)
      setDataLoaded(true)
    }

    void loadData()
  }, [])

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  useEffect(() => {
    function applyRouteFromHash() {
      setAppRoute(parseAppHash(window.location.hash))
    }

    applyRouteFromHash()
    window.addEventListener('hashchange', applyRouteFromHash)

    return () => window.removeEventListener('hashchange', applyRouteFromHash)
  }, [])

  useEffect(() => {
    if (appRoute.kind !== 'viewer' || !dataLoaded || maps.length === 0) {
      return
    }

    const route = parseViewerHash(window.location.hash)
    const nextMap = route.mapId ? maps.find((map) => map.id === route.mapId) : undefined
    const map = nextMap ?? maps.find((candidate) => candidate.id === 'calypso-casino') ?? maps[0]
    const floorId = resolveRouteFloorId(map.floors, route.floorArg) ?? map.floors[0]?.id ?? '1f'

    setSelectedMapId(map.id)
    setSelectedFloorId(floorId)
    setEditMode(route.mode === 'edit' && !isCompact)
    setSelectedMarkerId('')
    setActivePlacementToolId(null)

    if (route.mode === 'edit' && isCompact) {
      const viewHash = buildViewerHash(map.id, floorId, 'view')
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${viewHash}`)
    }
  }, [appRoute, dataLoaded, isCompact, maps])

  const selectedMap = maps.find((map) => map.id === selectedMapId) ?? maps[0]
  const selectedFloor = selectedMap?.floors.find((floor) => floor.id === selectedFloorId) ?? selectedMap?.floors[0]
  const t = useMemo(() => createTranslator(uiMessages, selectedLocale), [selectedLocale, uiMessages])
  const isProposalListRoute = appRoute.kind === 'proposal-list'
  const isProposalDetailRoute = appRoute.kind === 'proposal-detail'
  const isProposalRoute = isProposalListRoute || isProposalDetailRoute
  const activeProposalNumber = appRoute.kind === 'proposal-detail' ? appRoute.number : null
  const canEdit = appRoute.kind === 'viewer' && editMode && !isCompact
  const panelFloorIds = useMemo(() => {
    if (!selectedMap || !selectedFloor) {
      return []
    }

    return getWorkspacePanelFloorIds(selectedMap.floors, selectedFloor.id, splitView, secondaryFloorId)
  }, [secondaryFloorId, selectedFloor, selectedMap, splitView])
  const isSplitLayout = splitView && panelFloorIds.length > 1
  const pendingDeleteMarkerIdSet = useMemo(() => new Set(pendingDeleteMarkerIds), [pendingDeleteMarkerIds])
  const normalizedDraft = normalizeDraftForPatch(draft)
  const effectivePendingAddDrafts = useMemo(
    () =>
      pendingAddDrafts.map((pendingAddDraft) =>
        draftAction === 'add' && pendingAddDraft.clientId === activeAddDraftId
          ? { ...pendingAddDraft, draft: normalizedDraft }
          : pendingAddDraft,
      ),
    [activeAddDraftId, draftAction, normalizedDraft, pendingAddDrafts],
  )
  const pendingAddMarkers = useMemo(
    () => effectivePendingAddDrafts.map((pendingAddDraft) => markerFromPendingAddDraft(pendingAddDraft)),
    [effectivePendingAddDrafts],
  )
  const markersWithPendingUpdates = useMemo(
    () =>
      markers.map((marker) =>
        pendingMarkerUpdates[marker.id] ? markerWithPendingDraftUpdate(marker, pendingMarkerUpdates[marker.id]) : marker,
      ),
    [markers, pendingMarkerUpdates],
  )
  const selectedMapName = selectedMap
    ? localizeEntity({
        entityType: 'map',
        entityId: selectedMap.id,
        field: 'name',
        fallback: selectedMap.name,
        locale: selectedLocale,
        translations,
      })
    : ''
  const visibleMarkers = useMemo(
    () =>
      [...markersWithPendingUpdates, ...pendingAddMarkers].filter(
        (marker) =>
          marker.mapId === selectedMap?.id &&
          panelFloorIds.includes(marker.floorId) &&
          !pendingDeleteMarkerIdSet.has(marker.id) &&
          (showCommunityLayer || marker.source !== 'community'),
      ),
    [markersWithPendingUpdates, panelFloorIds, pendingAddMarkers, pendingDeleteMarkerIdSet, selectedMap?.id, showCommunityLayer],
  )
  const selectedMarker = resolveSelectedMarker(visibleMarkers, selectedMarkerId)
  const sourceLabel =
    selectedMap?.source.provider === 'r6maps-legacy' ? t('sourceLegacy') : t('sourceOfficial')
  const pendingAddDraftsForPatch = effectivePendingAddDrafts.map((pendingAddDraft) => pendingAddDraft.draft)
  const effectivePendingMarkerUpdates =
    draftAction === 'update' && updatingMarkerId
      ? {
          ...pendingMarkerUpdates,
          [updatingMarkerId]: normalizedDraft,
        }
      : pendingMarkerUpdates
  const pendingUpdateEntries = Object.entries(effectivePendingMarkerUpdates).filter(
    ([markerId]) => !pendingDeleteMarkerIdSet.has(markerId),
  )
  const pendingAddCount = pendingAddDraftsForPatch.length
  const pendingUpdateCount = pendingUpdateEntries.length
  const pendingDeleteCount = pendingDeleteMarkerIds.length
  const hasPendingChanges = pendingAddCount + pendingUpdateCount + pendingDeleteCount > 0
  const prPatch =
    dataLoaded && hasPendingChanges
      ? buildChangeSetPatch({
          addDrafts: pendingAddDraftsForPatch,
          updates: pendingUpdateEntries.map(([markerId, pendingDraft]) => ({ markerId, draft: pendingDraft })),
          deleteMarkerIds: pendingDeleteMarkerIds,
          markers,
          translations,
          options: {
            locale: draftTranslationLocale,
            localizedLabel:
              draftAction === 'add' && pendingAddCount === 1 && draftTranslationValue.trim()
                ? draftTranslationValue.trim()
                : undefined,
            localizedLabelsByMarkerId:
              draftAction === 'update' && updatingMarkerId && draftTranslationValue.trim()
                ? { [updatingMarkerId]: draftTranslationValue.trim() }
                : undefined,
            existingTranslations: translations,
          },
        })
      : null
  const canSubmitChanges = dataLoaded && Boolean(prPatch)
  const submissionApiBase = submissionApiBaseUrl()
  const pendingChangeSummary = t('pendingChangeSummary')
    .replace('{add}', String(pendingAddCount))
    .replace('{update}', String(pendingUpdateCount))
    .replace('{delete}', String(pendingDeleteCount))
  const languageOptions = locales.length > 0 ? locales : [{ id: 'en', name: 'English', nativeName: 'English' }]
  const visibleToolGroups = useMemo(() => {
    const query = toolSearch.trim().toLocaleLowerCase()

    return MARKER_TOOL_GROUPS.map((group) => ({
      ...group,
      tools: group.toolIds
        .map((toolId) => MARKER_TOOL_BY_ID.get(toolId))
        .filter((tool): tool is MarkerToolDefinition => Boolean(tool))
        .filter((tool) => !query || t(tool.labelKey).toLocaleLowerCase().includes(query)),
    })).filter((group) => group.tools.length > 0)
  }, [t, toolSearch])
  const currentViewerHash =
    selectedMap && selectedFloor ? buildViewerHash(selectedMap.id, selectedFloor.id, 'view') : '#calypso-casino/1/all'
  const activeProposalDetail =
    proposalDetailState.status === 'ready' && proposalDetailState.detail.number === activeProposalNumber
      ? proposalDetailState.detail
      : null
  const proposalPreviewMarkers = useMemo(
    () => (activeProposalDetail ? buildProposalPreviewMarkers(markers, activeProposalDetail) : []),
    [activeProposalDetail, markers],
  )
  const proposalDeletedMarkers = useMemo(
    () => (activeProposalDetail ? proposalDeletedGhostMarkers(activeProposalDetail) : []),
    [activeProposalDetail],
  )
  const proposalDiffKindByMarkerId = useMemo(
    () => (activeProposalDetail ? proposalMarkerDiffKindById(activeProposalDetail) : new Map<string, ProposalMarkerDiffKind>()),
    [activeProposalDetail],
  )
  const proposalVisibleMarkers = useMemo(
    () =>
      [...proposalPreviewMarkers, ...proposalDeletedMarkers].filter(
        (marker) => marker.mapId === selectedMap?.id && panelFloorIds.includes(marker.floorId),
      ),
    [panelFloorIds, proposalDeletedMarkers, proposalPreviewMarkers, selectedMap?.id],
  )
  const submitPayloadToApi = useCallback(
    async (payload: IssueOpsPayload, options: { redirectOnAuth: boolean }) => {
      setSubmitting(true)

      try {
        const response = await fetch(apiUrl(submissionApiBase, '/api/submissions'), {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-R6Maps-Return-To': window.location.href,
          },
          body: JSON.stringify(payload),
        })
        const body = await readJsonResponse<SubmissionApiResult | SubmissionAuthResponse>(response)

        if (response.status === 401 && 'loginUrl' in body) {
          if (options.redirectOnAuth) {
            writePendingSubmissionPayload(payload)
            setSubmissionNotice(t('loginGitHub'))
            window.location.assign(body.loginUrl)
            return true
          }

          clearPendingSubmissionPayload()
          setSubmissionNotice(t('apiSubmissionFallback'))
          return false
        }

        if (!response.ok || !('pullRequest' in body)) {
          throw new Error(`Submission API failed with status ${response.status}`)
        }

        clearPendingSubmissionPayload()
        setCreatedPullRequestUrl(body.pullRequest.url)
        setSubmissionNotice(t('pullRequestCreated'))
        window.open(body.pullRequest.url, '_blank', 'noopener,noreferrer')
        return true
      } catch {
        clearPendingSubmissionPayload()
        setSubmissionNotice(t('apiSubmissionFallback'))
        return false
      } finally {
        setSubmitting(false)
      }
    },
    [submissionApiBase, t],
  )

  useEffect(() => {
    if (!isProposalListRoute) {
      return
    }

    if (!submissionApiBase) {
      setProposalListState({ status: 'unavailable' })
      return
    }

    const controller = new AbortController()

    setProposalListState({ status: 'loading' })
    void fetch(apiUrl(submissionApiBase, '/api/proposals'), { signal: controller.signal })
      .then(async (response) => {
        const body = await readJsonResponse<unknown>(response)

        if (!response.ok) {
          throw new Error(`Proposal API failed with status ${response.status}`)
        }

        setProposalListState({ status: 'ready', proposals: normalizeProposalList(body) })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return
        }

        setProposalListState({ status: 'error', message: errorMessage(error) })
      })

    return () => controller.abort()
  }, [isProposalListRoute, proposalListReloadKey, submissionApiBase])

  useEffect(() => {
    if (activeProposalNumber === null) {
      return
    }

    proposalInitialSelection.current = null

    if (!submissionApiBase) {
      setProposalDetailState({ status: 'unavailable' })
      return
    }

    const controller = new AbortController()

    setProposalDetailState({ status: 'loading' })
    void fetch(apiUrl(submissionApiBase, `/api/proposals/${activeProposalNumber}`), { signal: controller.signal })
      .then(async (response) => {
        const body = await readJsonResponse<unknown>(response)

        if (!response.ok) {
          throw new Error(`Proposal API failed with status ${response.status}`)
        }

        const detail = normalizeProposalDetail(body)
        if (!detail) {
          throw new Error('Proposal API returned an unsupported detail shape')
        }

        setProposalDetailState({ status: 'ready', detail })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return
        }

        setProposalDetailState({ status: 'error', message: errorMessage(error) })
      })

    return () => controller.abort()
  }, [activeProposalNumber, proposalDetailReloadKey, submissionApiBase])

  useEffect(() => {
    if (!activeProposalDetail || maps.length === 0 || proposalInitialSelection.current === activeProposalDetail.number) {
      return
    }

    proposalInitialSelection.current = activeProposalDetail.number

    const marker = firstProposalMarker(activeProposalDetail)
    const map = marker ? maps.find((candidate) => candidate.id === marker.mapId) : undefined
    if (!marker || !map) {
      return
    }

    setSelectedMapId(map.id)
    setSelectedFloorId(map.floors.find((floor) => floor.id === marker.floorId)?.id ?? map.floors[0]?.id ?? '1f')
    setSelectedMarkerId(marker.id)
    resetViewerTransform()
  }, [activeProposalDetail, maps])

  useEffect(() => {
    if (selectedMap && selectedFloor && draftAction !== 'update') {
      setDraft((current) => ({
        ...current,
        mapId: selectedMap.id,
        floorId: selectedFloor.id,
      }))
    }
  }, [draftAction, selectedFloor, selectedMap])

  useEffect(() => {
    if (isCompact && editMode) {
      setEditMode(false)
    }
  }, [editMode, isCompact])

  useEffect(() => {
    if (isCompact) {
      setSplitView(false)
    }
  }, [isCompact])

  useEffect(() => {
    if (!hasPendingChanges) {
      return
    }

    function warnAboutPendingChanges(event: BeforeUnloadEvent) {
      event.preventDefault()
    }

    window.addEventListener('beforeunload', warnAboutPendingChanges)
    return () => window.removeEventListener('beforeunload', warnAboutPendingChanges)
  }, [hasPendingChanges])

  useEffect(() => {
    if (!dataLoaded || !submissionApiBase || pendingAutoSubmissionAttempted.current) {
      return
    }

    const pendingPayload = readPendingSubmissionPayload()
    if (!pendingPayload) {
      pendingAutoSubmissionAttempted.current = true
      return
    }

    pendingAutoSubmissionAttempted.current = true
    void submitPayloadToApi(pendingPayload, { redirectOnAuth: false })
  }, [dataLoaded, submissionApiBase, submitPayloadToApi])

  useEffect(() => {
    if (!draggingTool) {
      return
    }

    function clearToolDrag(event: PointerEvent) {
      if (event.pointerId === draggingTool?.pointerId) {
        setDraggingTool(null)
      }
    }

    window.addEventListener('pointerup', clearToolDrag)
    window.addEventListener('pointercancel', clearToolDrag)

    return () => {
      window.removeEventListener('pointerup', clearToolDrag)
      window.removeEventListener('pointercancel', clearToolDrag)
    }
  }, [draggingTool])

  useEffect(() => {
    if (appRoute.kind !== 'viewer' || !dataLoaded || !selectedMap || !selectedFloor) {
      return
    }

    const nextHash = buildViewerHash(selectedMap.id, selectedFloor.id, canEdit ? 'edit' : 'view')

    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${nextHash}`)
    }
  }, [appRoute.kind, canEdit, dataLoaded, selectedFloor, selectedMap])

  useEffect(() => {
    if (!dataLoaded) {
      return
    }

    setPendingDeleteMarkerIds((current) => {
      const next = current.filter((markerId) => markers.some((marker) => marker.id === markerId))

      return next.length === current.length ? current : next
    })

    if (
      shouldRestoreAddActionAfterDeleteCleanup({
        draftAction,
        pendingDeleteCount: pendingDeleteMarkerIds.length,
        selectedMarkerId,
      })
    ) {
      setDraftAction('add')
    }
    if (draftAction === 'update' && updatingMarkerId && !markers.some((marker) => marker.id === updatingMarkerId)) {
      setDraftAction('add')
      setUpdatingMarkerId(null)
    }
  }, [dataLoaded, draftAction, markers, pendingDeleteMarkerIds.length, selectedMarkerId, updatingMarkerId])

  function handleMapSelect(mapId: string) {
    const nextMap = maps.find((map) => map.id === mapId)
    persistActiveDraft()
    setSelectedMapId(mapId)
    setSelectedFloorId(nextMap?.floors.find((floor) => floor.id === '1f')?.id ?? nextMap?.floors[0]?.id ?? '1f')
    setSecondaryFloorId(null)
    setSelectedMarkerId('')
    setDraftAction('add')
    setActiveAddDraftId(null)
    setUpdatingMarkerId(null)
    setActivePlacementToolId(null)
    setSubmitPayloadPreview('')
    resetViewerTransform()
  }

  function handleFloorSelect(floorId: string) {
    persistActiveDraft()
    setSelectedFloorId(floorId)
    setSecondaryFloorId((current) => (current === floorId ? null : current))
    setSelectedMarkerId('')
    setDraftAction('add')
    setActiveAddDraftId(null)
    setUpdatingMarkerId(null)
    setActivePlacementToolId(null)
    setSubmitPayloadPreview('')
  }

  function handleLocaleChange(locale: string) {
    setSelectedLocale(locale)
    setDraftTranslationLocale(locale)
    setDraftTranslationValue(resolveMarkerTranslation(translations, updatingMarkerId, locale))
    try {
      localStorage.setItem('r6maps-locale', locale)
    } catch {
      // Browsers can disable storage; the selector still works for this session.
    }
  }

  function queuePendingAddDraft(nextDraft: DraftMarker) {
    const activeClientId = activeAddDraftId
    const activeDraft = normalizeDraftForPatch(draftRef.current)
    const normalizedNextDraft = normalizeDraftForPatch(nextDraft)

    pendingAddDraftSerial.current += 1
    const clientId = `add-${pendingAddDraftSerial.current}`

    setPendingAddDrafts((current) => [
      ...current.map((pendingDraft) =>
        draftAction === 'add' && activeClientId && pendingDraft.clientId === activeClientId
          ? { ...pendingDraft, draft: activeDraft }
          : pendingDraft,
      ),
      { clientId, draft: normalizedNextDraft },
    ])
    setActiveAddDraftId(clientId)
    setSelectedMarkerId(pendingAddMarkerId(clientId))

    return clientId
  }

  function saveActiveAddDraft(nextDraft = draftRef.current) {
    if (!activeAddDraftId) {
      return
    }

    const clientId = activeAddDraftId
    const normalizedNextDraft = normalizeDraftForPatch(nextDraft)

    setPendingAddDrafts((current) =>
      current.map((pendingDraft) =>
        pendingDraft.clientId === clientId ? { ...pendingDraft, draft: normalizedNextDraft } : pendingDraft,
      ),
    )
  }

  function persistActiveDraft() {
    if (draftAction === 'add' && activeAddDraftId) {
      saveActiveAddDraft()
      return
    }

    if (draftAction === 'update' && updatingMarkerId) {
      const markerId = updatingMarkerId
      const nextDraft = normalizeDraftForPatch(draftRef.current)
      setPendingMarkerUpdates((current) => ({ ...current, [markerId]: nextDraft }))
    }
  }

  function handleMarkerSelect(markerId: string) {
    setActivePlacementToolId(null)
    const pendingClientId = pendingAddClientIdFromMarkerId(markerId)

    if (pendingClientId) {
      const pendingDraft = effectivePendingAddDrafts.find((candidate) => candidate.clientId === pendingClientId)

      if (draftAction === 'add' && activeAddDraftId && activeAddDraftId !== pendingClientId) {
        saveActiveAddDraft()
      }

      if (pendingDraft) {
        setSelectedMarkerId(markerId)
        setDraftAction('add')
        setActiveAddDraftId(pendingClientId)
        setUpdatingMarkerId(null)
        setSubmitPayloadPreview('')
        draftRef.current = pendingDraft.draft
        setDraft(pendingDraft.draft)
      }

      return
    }

    if (draftAction === 'add' && activeAddDraftId) {
      saveActiveAddDraft()
    }

    setSelectedMarkerId(markerId)
  }

  function updateDraftAtCoordinate(mapId: string, floorId: string, x: number, y: number, tool?: MarkerToolDefinition) {
    setDraft((current) => {
      const nextDraft = draftAtCoordinate(current, mapId, floorId, x, y, tool)

      draftRef.current = nextDraft

      return nextDraft
    })
  }

  function startDraftDrag(event: React.PointerEvent<SVGGElement>, mapId: string, floorId: string, x: number, y: number) {
    if (!canEdit) {
      return
    }

    const offsetX = draft.x - x
    const offsetY = draft.y - y

    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    draftDragPointer.current = { pointerId: event.pointerId, offsetX, offsetY }
    if (draftAction !== 'update' || !updatingMarkerId) {
      const nextDraft = draftAtCoordinate(draft, mapId, floorId, clamp(x + offsetX), clamp(y + offsetY))

      setDraftAction('add')
      setUpdatingMarkerId(null)
      setSubmitPayloadPreview('')
      if (activeAddDraftId) {
        setPendingAddDrafts((current) =>
          current.map((pendingDraft) =>
            pendingDraft.clientId === activeAddDraftId
              ? { ...pendingDraft, draft: normalizeDraftForPatch(nextDraft) }
              : pendingDraft,
          ),
        )
        setSelectedMarkerId(pendingAddMarkerId(activeAddDraftId))
      } else {
        queuePendingAddDraft(nextDraft)
      }
      draftRef.current = nextDraft
      setDraft(nextDraft)
    }
    setDraggingDraft(true)
    if (draftAction === 'update' && updatingMarkerId) {
      updateDraftAtCoordinate(mapId, floorId, clamp(x + offsetX), clamp(y + offsetY))
    }
  }

  function startMarkerDrag(
    event: React.PointerEvent<SVGGElement>,
    marker: CommunityMarker,
    mapId: string,
    floorId: string,
    x: number,
    y: number,
  ) {
    if (!canEdit) {
      return
    }

    setActivePlacementToolId(null)

    const pendingClientId = pendingAddClientIdFromMarkerId(marker.id)
    const pendingAddDraft = pendingClientId
      ? effectivePendingAddDrafts.find((candidate) => candidate.clientId === pendingClientId)?.draft
      : undefined
    const existingDraft = pendingAddDraft ?? pendingMarkerUpdates[marker.id] ?? draftFromCommunityMarker(marker)
    const offsetX = existingDraft.x - x
    const offsetY = existingDraft.y - y
    const nextDraft = {
      ...existingDraft,
      mapId,
      floorId,
      x: clamp(x + offsetX),
      y: clamp(y + offsetY),
    }

    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    draftDragPointer.current = { pointerId: event.pointerId, offsetX, offsetY }

    if (pendingClientId) {
      setSelectedMarkerId(marker.id)
      setDraftAction('add')
      setActiveAddDraftId(pendingClientId)
      setUpdatingMarkerId(null)
      setDraggingDraft(true)
      setSubmitPayloadPreview('')
      draftRef.current = nextDraft
      setDraft(nextDraft)
      return
    }

    if (draftAction === 'add' && activeAddDraftId) {
      saveActiveAddDraft()
    }

    setSelectedMarkerId(marker.id)
    setDraftAction('update')
    setActiveAddDraftId(null)
    setUpdatingMarkerId(marker.id)
    setDraggingDraft(true)
    setDraftTranslationValue(
      draftTranslationLocale === 'en'
        ? ''
        : (translations.find(
            (translation) =>
              translation.entityType === 'marker' &&
              translation.entityId === marker.id &&
              translation.field === 'label' &&
              translation.locale === draftTranslationLocale &&
              translation.status !== 'deprecated',
          )?.value ?? ''),
    )
    draftRef.current = nextDraft
    setDraft(nextDraft)
  }

  function moveDraft(event: React.PointerEvent<SVGElement>, mapId: string, floorId: string, x: number, y: number) {
    const drag = draftDragPointer.current

    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }

    updateDraftAtCoordinate(mapId, floorId, clamp(x + drag.offsetX), clamp(y + drag.offsetY))
  }

  function stopDraftDrag(event: React.PointerEvent<SVGElement>) {
    const drag = draftDragPointer.current

    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }

    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    } catch {
      // Pointer capture can already be gone after cancellation.
    }

    draftDragPointer.current = null
    if (draftAction === 'update' && updatingMarkerId) {
      setPendingMarkerUpdates((current) => ({
        ...current,
        [updatingMarkerId]: normalizeDraftForPatch(draftRef.current),
      }))
    } else if (draftAction === 'add') {
      if (activeAddDraftId) {
        saveActiveAddDraft()
      } else {
        queuePendingAddDraft(draftRef.current)
      }
    }
    setDraggingDraft(false)
  }

  function deleteSelectedMarker() {
    if (!selectedMarker) {
      return
    }

    const pendingClientId = pendingAddClientIdFromMarkerId(selectedMarker.id)

    if (pendingClientId) {
      setDraftAction('delete')
      setPendingAddDrafts((current) => current.filter((pendingDraft) => pendingDraft.clientId !== pendingClientId))
      if (activeAddDraftId === pendingClientId) {
        setActiveAddDraftId(null)
      }
      setSelectedMarkerId('')
      setSubmitPayloadPreview('')
      return
    }

    if (draftAction === 'add' && activeAddDraftId) {
      saveActiveAddDraft()
    }

    setDraftAction('delete')
    setActiveAddDraftId(null)
    setPendingDeleteMarkerIds((current) => (current.includes(selectedMarker.id) ? current : [...current, selectedMarker.id]))
    setSelectedMarkerId('')
    setUpdatingMarkerId(null)
    setSubmitPayloadPreview('')
    setPendingMarkerUpdates((current) => omitMarkerUpdate(current, selectedMarker.id))
  }

  function zoomBy(delta: number) {
    setViewerTransform((current) => clampViewerTransform({ ...current, scale: current.scale + delta }))
  }

  function setZoom(scale: number) {
    setViewerTransform((current) => clampViewerTransform({ ...current, scale }))
  }

  function handleZoomInput(event: React.FormEvent<HTMLInputElement>) {
    setZoom(Number(event.currentTarget.value))
  }

  function resetViewerTransform() {
    setViewerTransform({ scale: 1, x: 0, y: 0 })
  }

  function startPan(event: React.PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || draggingDraft) {
      return
    }

    event.preventDefault()
    panPointer.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function movePan(event: React.PointerEvent<SVGSVGElement>) {
    const pointer = panPointer.current
    if (!pointer || pointer.pointerId !== event.pointerId) {
      return
    }

    const dx = event.clientX - pointer.x
    const dy = event.clientY - pointer.y
    panPointer.current = { ...pointer, x: event.clientX, y: event.clientY }
    setViewerTransform((current) => clampViewerTransform({ ...current, x: current.x + dx, y: current.y + dy }))
  }

  function stopPan(event: React.PointerEvent<SVGSVGElement>) {
    if (panPointer.current?.pointerId === event.pointerId) {
      panPointer.current = null
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  async function submitChanges() {
    if (!dataLoaded || !prPatch) {
      return
    }

    const payload = buildIssueOpsPayload(prPatch)
    setSubmissionNotice('')
    setCreatedPullRequestUrl('')
    setSubmitPayloadPreview('')
    setCopied(false)

    if (submissionApiBase) {
      const submitted = await submitPayloadToApi(payload, { redirectOnAuth: true })
      if (submitted) {
        return
      }
    }

    await submitPayloadWithIssueFallback(payload)
  }

  async function submitPayloadWithIssueFallback(payload: IssueOpsPayload) {
    const repository = githubIssueRepository()
    const issueBody = buildIssueOpsIssueBody(payload)
    const copiedPayload = await copySubmissionPayload(issueBody)

    if (!copiedPayload) {
      setCopied(false)
      setSubmitPayloadPreview(issueBody)
      return
    }

    const issueUrl = buildGitHubIssueUrl(repository.repo, payload.patch.title)
    const openedWindow = window.open(issueUrl, '_blank', 'noopener,noreferrer')

    setCopied(true)
    setSubmitPayloadPreview(openedWindow && repository.configured ? '' : issueBody)
    window.setTimeout(() => setCopied(false), 1600)
  }

  const shellClassName = [
    'app-shell',
    canEdit ? 'editor-active' : isProposalListRoute ? 'proposal-list-active' : isProposalDetailRoute ? 'proposal-preview-active' : 'viewer-active',
  ].join(' ')

  return (
    <div className={shellClassName}>
      <header className="topbar">
        <div className="brand">
          <div>
            <h1>R6MAPS</h1>
            <p>{isProposalListRoute ? t('proposals') : isProposalDetailRoute ? t('proposalPreview') : t('tacticalAtlas')}</p>
          </div>
        </div>

        {!isProposalRoute && (
          <WorkspaceModeSwitch
            canEdit={canEdit}
            compact={isCompact}
            labels={{ browse: t('browseMode'), edit: t('editMode') }}
            onChange={(editing) => {
              if (!editing) {
                persistActiveDraft()
              }
              setActivePlacementToolId(null)
              setEditMode(editing)
              setInspectorTab('markers')
            }}
          />
        )}

        {!isProposalListRoute && (
          <div className="viewer-controls" aria-label="Map controls">
            <label className="compact-select">
              <span>{t('officialMaps')}</span>
              <select value={selectedMap?.id ?? ''} onChange={(event) => handleMapSelect(event.target.value)}>
                {maps.map((map) => (
                  <option key={map.id} value={map.id}>
                    {localizeEntity({
                      entityType: 'map',
                      entityId: map.id,
                      field: 'name',
                      fallback: map.name,
                      locale: selectedLocale,
                      translations,
                    })}
                  </option>
                ))}
              </select>
            </label>

            <div className="toolbar-controls floor-controls" aria-label="Floor controls">
              {selectedMap?.floors.map((floor) => (
                <button
                  className={floor.id === selectedFloor?.id ? 'segmented selected' : 'segmented'}
                  key={floor.id}
                  type="button"
                  onClick={() => handleFloorSelect(floor.id)}
                >
                  {localizeFloorName(floor, selectedLocale, translations)}
                </button>
              ))}
            </div>

            <button
              className={splitView ? 'segmented split-control selected' : 'segmented split-control'}
              type="button"
              onClick={() => setSplitView((current) => !current)}
            >
              {t('splitView')}
            </button>

            <div className="zoom-controls" aria-label="Zoom controls">
              <button className="icon-button" type="button" title={t('zoomOut')} onClick={() => zoomBy(-0.15)}>
                <Minus size={16} />
              </button>
              <input
                aria-label="Zoom"
                max="5"
                min="0.45"
                step="0.05"
                type="range"
                value={viewerTransform.scale}
                onInput={handleZoomInput}
                onChange={handleZoomInput}
              />
              <button className="icon-button" type="button" title={t('zoomIn')} onClick={() => zoomBy(0.15)}>
                <Plus size={16} />
              </button>
              <button className="icon-button" type="button" title={t('resetView')} onClick={resetViewerTransform}>
                <Maximize2 size={16} />
              </button>
            </div>
          </div>
        )}

        <div className="topbar-actions" aria-label="Global actions">
          <label className="language-select">
            <span>{t('language')}</span>
            <select value={selectedLocale} onChange={(event) => handleLocaleChange(event.target.value)}>
              {languageOptions.map((locale) => (
                <option key={locale.id} value={locale.id}>
                  {locale.nativeName}
                </option>
              ))}
            </select>
          </label>
          {isProposalRoute ? (
            <a className="primary-button secondary-button" href={currentViewerHash}>
              <Eye size={17} />
              {t('viewMap')}
            </a>
          ) : (
            <a className="utility-link" href="#/proposals" onClick={persistActiveDraft}>
              <GitPullRequestArrow size={17} />
              <span>{t('proposals')}</span>
            </a>
          )}
        </div>
      </header>

      <main className={isProposalListRoute ? 'proposal-list-page' : isProposalDetailRoute ? 'workspace proposal-preview' : canEdit ? 'workspace editing' : 'workspace viewing'}>
        {isProposalListRoute ? (
          <ProposalListPage
            state={proposalListState}
            t={t}
            onRefresh={() => setProposalListReloadKey((current) => current + 1)}
          />
        ) : isProposalDetailRoute ? (
          <ProposalPreviewWorkspace
            detailState={proposalDetailState}
            diffKindByMarkerId={proposalDiffKindByMarkerId}
            isSplitLayout={isSplitLayout}
            maps={maps}
            panelFloorIds={panelFloorIds}
            proposalMarkers={proposalVisibleMarkers}
            selectedFloor={selectedFloor}
            selectedLocale={selectedLocale}
            selectedMap={selectedMap}
            selectedMapName={selectedMapName}
            selectedMarkerId={selectedMarkerId}
            showOfficialLayer={showOfficialLayer}
            sourceLabel={sourceLabel}
            t={t}
            transform={viewerTransform}
            translations={translations}
            onMarkerSelect={setSelectedMarkerId}
            onPanMove={movePan}
            onPanStart={startPan}
            onPanStop={stopPan}
            onReferencePointChange={setReferencePoint}
            onRefresh={() => setProposalDetailReloadKey((current) => current + 1)}
            onWheelZoom={(delta) => zoomBy(delta)}
            referencePoint={referencePoint}
          />
        ) : (
          <>
            <section className="map-stage" aria-label="Map viewer and editor">
          <div className={isSplitLayout ? 'map-panes split' : 'map-panes'}>
            {panelFloorIds.map((floorId) => {
              const floor = selectedMap?.floors.find((candidate) => candidate.id === floorId)
              const isPrimaryFloorPane = floorId === selectedFloor?.id
              const otherFloorId = panelFloorIds.find((candidate) => candidate !== floorId)
              const activePendingAddMarkerId =
                draftAction === 'add' && activeAddDraftId ? pendingAddMarkerId(activeAddDraftId) : null
              const hiddenMarkerId =
                draftAction === 'update' && !draggingDraft
                  ? updatingMarkerId
                  : draftAction === 'add'
                    ? activePendingAddMarkerId
                    : null
              const ghostedMarkerId =
                draftAction === 'update' && draggingDraft
                  ? updatingMarkerId
                  : draftAction === 'add' && draggingDraft
                    ? activePendingAddMarkerId
                    : null
              const paneMarkers = visibleMarkers.filter(
                (marker) => marker.floorId === floorId && marker.id !== hiddenMarkerId,
              )

              return (
                <MapPane
                  canEdit={canEdit}
                  draft={normalizedDraft}
                  draftAction={draftAction}
                  draggingDraft={draggingDraft}
                  floor={floor}
                  floorName={floor ? localizeFloorName(floor, selectedLocale, translations) : undefined}
                  floorOptions={(selectedMap?.floors ?? []).map((candidate) => ({
                    id: candidate.id,
                    label: localizeFloorName(candidate, selectedLocale, translations),
                  }))}
                  disabledFloorId={otherFloorId}
                  ghostedMarkerId={ghostedMarkerId}
                  isSelectedFloor={floor?.id === selectedFloor?.id}
                  linkedView={isSplitLayout}
                  key={floorId}
                  mapId={selectedMap?.id ?? ''}
                  markers={paneMarkers}
                  referencePoint={referencePoint}
                  selectedMarkerId={selectedMarker?.id}
                  showOfficialLayer={showOfficialLayer}
                  t={t}
                  transform={viewerTransform}
                  activeToolPointerId={draggingTool?.pointerId ?? null}
                  activeTool={
                    draggingTool
                      ? (MARKER_TOOL_BY_ID.get(draggingTool.toolId) ?? null)
                      : activePlacementToolId
                        ? (MARKER_TOOL_BY_ID.get(activePlacementToolId) ?? null)
                        : null
                  }
                  onDraftDragMove={moveDraft}
                  onDraftDragStart={startDraftDrag}
                  onDraftDragStop={stopDraftDrag}
                  onDraftLabelChange={(label) => setDraft((current) => ({ ...current, label }))}
                  onDropTool={(tool, mapId, droppedFloorId, x, y) => {
                    const nextDraft = draftAtCoordinate(draftRef.current, mapId, droppedFloorId, x, y, tool)

                    setDraftAction('add')
                    setUpdatingMarkerId(null)
                    setActivePlacementToolId(null)
                    setDraftTranslationValue('')
                    setSubmitPayloadPreview('')
                    queuePendingAddDraft(nextDraft)
                    draftRef.current = nextDraft
                    setDraft(nextDraft)
                  }}
                  onMarkerSelect={handleMarkerSelect}
                  onMarkerDragStart={startMarkerDrag}
                  onFloorSelect={(nextFloorId) => {
                    if (isPrimaryFloorPane) {
                      handleFloorSelect(nextFloorId)
                    } else {
                      setSecondaryFloorId(nextFloorId)
                    }
                  }}
                  onPanMove={movePan}
                  onPanStart={startPan}
                  onPanStop={stopPan}
                  onReferencePointChange={setReferencePoint}
                  onToolDragEnd={() => setDraggingTool(null)}
                  onWheelZoom={(delta) => zoomBy(delta)}
                  getMarkerLabel={(marker) =>
                    localizeEntity({
                      entityType: 'marker',
                      entityId: marker.id,
                      field: 'label',
                      fallback: marker.label,
                      locale: selectedLocale,
                      translations,
                    })
                  }
                />
              )
            })}
          </div>

          <WorkspaceToolRail
            canDelete={Boolean(selectedMarker)}
            compact={isCompact}
            editing={canEdit}
            labels={{
              clearReference: t('clearReference'),
              deleteMarker: t('deleteMarker'),
              layers: t('layers'),
              legend: t('markerLegend'),
              reset: t('resetView'),
              split: t('splitView'),
              zoomIn: t('zoomIn'),
              zoomOut: t('zoomOut'),
            }}
            legendOpen={legendOpen}
            referenceActive={Boolean(referencePoint)}
            splitView={splitView}
            onDelete={deleteSelectedMarker}
            onInspectorLayers={() => setInspectorTab('layers')}
            onLegendToggle={() => setLegendOpen((current) => !current)}
            onReferenceClear={() => setReferencePoint(null)}
            onReset={resetViewerTransform}
            onSplitToggle={() => setSplitView((current) => !current)}
            onZoomIn={() => zoomBy(0.15)}
            onZoomOut={() => zoomBy(-0.15)}
          />

          {!canEdit && legendOpen && <MarkerReferenceLegend tools={R6CALLS_LEGEND_TOOLS} t={t} />}

          <div className="status-strip">
            <span>{selectedMapName || 'Loading maps'}</span>
            <span>{panelFloorIds.map((floorId) => selectedMap?.floors.find((floor) => floor.id === floorId)).filter(Boolean).map((floor) => localizeFloorName(floor!, selectedLocale, translations)).join(' / ') || t('noFloorSelected')}</span>
            <span className={isSplitLayout ? 'status-sync active' : 'status-sync'}>{isSplitLayout ? t('syncedView') : t('singleView')}</span>
            <span className="status-source">{sourceLabel}</span>
            <span>{hasPendingChanges ? pendingChangeSummary : t('noPendingChanges')}</span>
          </div>
        </section>

        {canEdit && (
          <aside className="inspector" aria-label="Edit inspector">
            <InspectorTabs
              active={inspectorTab}
              labels={{ markers: t('inspectorMarkers'), layers: t('layers'), changes: t('inspectorChanges') }}
              onChange={setInspectorTab}
            />

            <div
              aria-labelledby={`inspector-tab-${inspectorTab}`}
              className="inspector-scroll"
              id="inspector-panel"
              role="tabpanel"
              tabIndex={0}
            >
              {inspectorTab === 'markers' && (
                <>
                  <section className="inspector-section selected-marker-section">
                    <div className="section-heading">
                      <MousePointer2 size={16} />
                      <span>{t('selectedMarker')}</span>
                    </div>
                    {selectedMarker ? (
                      <div className="marker-detail">
                        <span className={`marker-badge ${selectedMarker.type}`}>{t(markerToolLabelKey(selectedMarker))}</span>
                        <strong>
                          {formatMarkerDisplayLabel(
                            selectedMarker,
                            localizeEntity({
                              entityType: 'marker',
                              entityId: selectedMarker.id,
                              field: 'label',
                              fallback: selectedMarker.label,
                              locale: selectedLocale,
                              translations,
                            }),
                            t,
                          )}
                        </strong>
                        <dl>
                          <div>
                            <dt>{t('status')}</dt>
                            <dd>{selectedMarker.status}</dd>
                          </div>
                          <div>
                            <dt>{t('position')}</dt>
                            <dd>{selectedMarker.x.toFixed(3)}, {selectedMarker.y.toFixed(3)}</dd>
                          </div>
                        </dl>
                        <button className="danger-button" type="button" onClick={deleteSelectedMarker}>
                          <Trash2 size={15} />
                          {t('deleteMarker')}
                        </button>
                      </div>
                    ) : (
                      <p className="muted">{t('selectMarkerHint')}</p>
                    )}
                  </section>

                  <section className="inspector-section marker-library-section">
                    <div className="section-heading section-heading-stack">
                      <div>
                        <strong>{t('addMapMarker')}</strong>
                        <span>{t('dragMarkerHint')}</span>
                      </div>
                    </div>
                    <label className="tool-search">
                      <Search size={16} />
                      <input
                        aria-label={t('searchMarkerTypes')}
                        placeholder={t('searchMarkerTypes')}
                        type="search"
                        value={toolSearch}
                        onChange={(event) => setToolSearch(event.target.value)}
                      />
                    </label>
                    <div className="tool-groups">
                      {visibleToolGroups.map((group) => (
                        <section className="tool-group" key={group.labelKey}>
                          <h3>{t(group.labelKey)}</h3>
                          <AnnotationToolbar
                            tools={group.tools}
                            selectedToolId={activePlacementToolId}
                            onSelect={(tool) => {
                              if (activePlacementToolId === tool.id) {
                                setActivePlacementToolId(null)
                                return
                              }

                              persistActiveDraft()
                              setDraftAction('add')
                              setActiveAddDraftId(null)
                              setUpdatingMarkerId(null)
                              setActivePlacementToolId(tool.id)
                              setDraftTranslationValue('')
                              setDraft((current) => draftWithToolDefaults(current, tool))
                            }}
                            onToolDragStart={(toolId, pointerId) => setDraggingTool({ toolId, pointerId })}
                            onToolDragEnd={(pointerId) =>
                              setDraggingTool((current) =>
                                pointerId == null || current?.pointerId === pointerId ? null : current,
                              )
                            }
                            t={t}
                          />
                        </section>
                      ))}
                      {visibleToolGroups.length === 0 && <p className="tool-empty">{t('noMarkerTypesFound')}</p>}
                    </div>
                  </section>

                  <section className="inspector-section marker-properties-section">
                    <div className="section-heading">
                      <GitPullRequestArrow size={16} />
                      <span>{t('markerProperties')}</span>
                    </div>
                    <label className="field">
                      <span>{t('label')}</span>
                      <input value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} />
                    </label>
                    <MarkerMetadataFields draft={draft} t={t} onChange={(nextDraft) => setDraft(syncDraftLabel(nextDraft))} />
                  </section>
                </>
              )}

              {inspectorTab === 'layers' && (
                <>
                  <section className="inspector-section">
                    <div className="section-heading">
                      <Eye size={16} />
                      <span>{t('layers')}</span>
                    </div>
                    <Toggle checked={showOfficialLayer} label={t('officialBlueprintLayer')} onChange={setShowOfficialLayer} />
                    <Toggle checked={showCommunityLayer} label={t('communityMarkers')} onChange={setShowCommunityLayer} />
                  </section>
                  <section className="inspector-section layer-summary">
                    <div className="section-heading">
                      <FileJson size={16} />
                      <span>{t('mapContext')}</span>
                    </div>
                    <dl>
                      <div><dt>{t('officialMaps')}</dt><dd>{selectedMapName}</dd></div>
                      <div><dt>{t('visibleMarkers')}</dt><dd>{visibleMarkers.length}</dd></div>
                      <div><dt>{t('splitView')}</dt><dd>{isSplitLayout ? t('syncedView') : t('singleView')}</dd></div>
                    </dl>
                    <p>{sourceLabel}</p>
                  </section>
                </>
              )}

              {inspectorTab === 'changes' && (
                <>
                  <section className="inspector-section">
                    <div className="section-heading">
                      <GitPullRequestArrow size={16} />
                      <span>{t('inspectorChanges')}</span>
                    </div>
                    <label className="field">
                      <span>{t('translationLocale')}</span>
                      <select
                        value={draftTranslationLocale}
                        onChange={(event) => {
                          setDraftTranslationLocale(event.target.value)
                          setDraftTranslationValue(
                            resolveMarkerTranslation(translations, updatingMarkerId, event.target.value),
                          )
                        }}
                      >
                        {languageOptions.map((locale) => (
                          <option key={locale.id} value={locale.id}>{locale.nativeName}</option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>{t('localizedLabel')}</span>
                      <input
                        value={draftTranslationValue}
                        onChange={(event) => setDraftTranslationValue(event.target.value)}
                        placeholder={draft.label}
                      />
                    </label>
                    <div className={pendingDeleteCount > 0 ? 'patch-mode delete' : pendingUpdateCount > 0 ? 'patch-mode update' : 'patch-mode'}>
                      {hasPendingChanges ? pendingChangeSummary : t('noPendingChanges')}
                    </div>
                    <pre className="patch-preview">
                      {prPatch
                        ? JSON.stringify(summarizePatchForPreview(prPatch), null, 2)
                        : dataLoaded
                          ? t('noPatchQueued')
                          : t('loadingRepositoryData')}
                    </pre>
                    {submissionNotice && (
                      <p className="patch-preview-hint">
                        {createdPullRequestUrl ? (
                          <a href={createdPullRequestUrl} rel="noreferrer" target="_blank">{submissionNotice}</a>
                        ) : submissionNotice}
                      </p>
                    )}
                    {submitPayloadPreview && (
                      <details className="advanced-change-data">
                        <summary>{t('manualPayloadCopyHint')}</summary>
                        <pre className="patch-preview">{submitPayloadPreview}</pre>
                      </details>
                    )}
                  </section>
                  <details className="inspector-section advanced-change-data">
                    <summary>{t('repositoryData')}</summary>
                    <div className="repo-tree">
                      <span>public/data/official/maps.json</span>
                      <span>public/data/community/markers/index.json</span>
                      <span>public/data/community/markers/{'{mapId}'}.json</span>
                    </div>
                  </details>
                </>
              )}
            </div>

            <footer className="inspector-submit-bar">
              <span>{hasPendingChanges ? pendingChangeSummary : t('noPendingChanges')}</span>
              <button
                className="primary-button"
                type="button"
                disabled={!canSubmitChanges || submitting}
                onClick={submitChanges}
              >
                <GitPullRequestArrow size={17} />
                {submitting ? t('submittingChanges') : copied ? t('copiedPatch') : t('submitChanges')}
              </button>
            </footer>
          </aside>
        )}
          </>
        )}
      </main>
    </div>
  )
}

function noop() {}

function ProposalListPage({
  state,
  t,
  onRefresh,
}: {
  state: ProposalListState
  t: (key: string) => string
  onRefresh: () => void
}) {
  return (
    <section className="proposal-list-shell" aria-label={t('proposals')}>
      <div className="proposal-page-header">
        <div>
          <h2>{t('proposals')}</h2>
          <p>{t('proposalsDescription')}</p>
        </div>
        <button className="primary-button secondary-button" type="button" onClick={onRefresh}>
          <RefreshCw size={16} />
          {t('refresh')}
        </button>
      </div>

      {state.status === 'unavailable' && (
        <ProposalEmptyState
          icon={<AlertTriangle size={22} />}
          title={t('proposalApiUnavailableTitle')}
          message={t('proposalApiUnavailableMessage')}
        />
      )}
      {state.status === 'loading' && (
        <ProposalEmptyState icon={<CircleDashed size={22} />} title={t('loadingProposals')} message={t('loadingRepositoryData')} />
      )}
      {state.status === 'error' && (
        <ProposalEmptyState icon={<XCircle size={22} />} title={t('proposalApiErrorTitle')} message={state.message || t('proposalApiErrorMessage')} />
      )}
      {state.status === 'ready' && state.proposals.length === 0 && (
        <ProposalEmptyState icon={<GitPullRequestArrow size={22} />} title={t('noProposalsTitle')} message={t('noProposalsMessage')} />
      )}
      {state.status === 'ready' && state.proposals.length > 0 && (
        <div className="proposal-list">
          {state.proposals.map((proposal) => (
            <article className="proposal-card" key={proposal.number}>
              <div className="proposal-card-main">
                <div className="proposal-title-row">
                  <span className="proposal-number">#{proposal.number}</span>
                  <h3>{proposal.title}</h3>
                </div>
                <div className="proposal-meta">
                  <span>{t('proposalAuthor').replace('{author}', proposal.author)}</span>
                  <span>{t('proposalFilesChanged').replace('{count}', String(proposal.changedFileCount))}</span>
                  {proposal.updatedAt && <span>{formatProposalDate(proposal.updatedAt)}</span>}
                </div>
                <div className="proposal-badges">
                  <span className={`risk-badge ${proposal.risk}`}>{proposalRiskLabel(proposal.risk, t)}</span>
                  <span className={`check-badge ${proposal.checkState}`}>
                    <ProposalCheckIcon state={proposal.checkState} />
                    {proposalCheckLabel(proposal.checkState, t)}
                  </span>
                  <span className="vote-pill">{formatProposalVotes(proposal.votes, t)}</span>
                </div>
              </div>
              <div className="proposal-actions">
                <a className="primary-button" href={proposalDetailHash(proposal.number)}>
                  <Eye size={16} />
                  {t('preview')}
                </a>
                {proposal.githubUrl && (
                  <a className="primary-button secondary-button" href={proposal.githubUrl} rel="noreferrer" target="_blank">
                    <ExternalLink size={16} />
                    GitHub
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function ProposalPreviewWorkspace({
  detailState,
  diffKindByMarkerId,
  isSplitLayout,
  maps,
  panelFloorIds,
  proposalMarkers,
  selectedFloor,
  selectedLocale,
  selectedMap,
  selectedMapName,
  selectedMarkerId,
  showOfficialLayer,
  sourceLabel,
  t,
  transform,
  translations,
  referencePoint,
  onMarkerSelect,
  onPanMove,
  onPanStart,
  onPanStop,
  onReferencePointChange,
  onRefresh,
  onWheelZoom,
}: {
  detailState: ProposalDetailState
  diffKindByMarkerId: Map<string, ProposalMarkerDiffKind>
  isSplitLayout: boolean
  maps: OfficialMap[]
  panelFloorIds: string[]
  proposalMarkers: CommunityMarker[]
  selectedFloor?: OfficialMap['floors'][number]
  selectedLocale: string
  selectedMap?: OfficialMap
  selectedMapName: string
  selectedMarkerId: string
  showOfficialLayer: boolean
  sourceLabel: string
  t: (key: string) => string
  transform: { scale: number; x: number; y: number }
  translations: TranslationEntry[]
  referencePoint: ReferencePoint | null
  onMarkerSelect: (markerId: string) => void
  onPanMove: (event: React.PointerEvent<SVGSVGElement>) => void
  onPanStart: (event: React.PointerEvent<SVGSVGElement>) => void
  onPanStop: (event: React.PointerEvent<SVGSVGElement>) => void
  onReferencePointChange: (point: ReferencePoint | null) => void
  onRefresh: () => void
  onWheelZoom: (delta: number) => void
}) {
  const previewDraft: DraftMarker = {
    mapId: selectedMap?.id ?? '',
    floorId: selectedFloor?.id ?? '',
    type: 'camera',
    label: '',
    x: 0.5,
    y: 0.5,
  }

  return (
    <>
      <section className="map-stage proposal-map-stage" aria-label={t('proposalPreview')}>
        <div className={isSplitLayout ? 'map-panes split' : 'map-panes'}>
          {panelFloorIds.map((floorId) => {
            const floor = selectedMap?.floors.find((candidate) => candidate.id === floorId)
            const paneMarkers = proposalMarkers.filter((marker) => marker.floorId === floorId)

            return (
              <MapPane
                activeToolPointerId={null}
                activeTool={null}
                canEdit={false}
                draft={previewDraft}
                draftAction="delete"
                draggingDraft={false}
                floor={floor}
                floorName={floor ? localizeFloorName(floor, selectedLocale, translations) : undefined}
                ghostedMarkerId={null}
                isSelectedFloor={floor?.id === selectedFloor?.id}
                key={floorId}
                mapId={selectedMap?.id ?? ''}
                markers={paneMarkers}
                referencePoint={referencePoint}
                selectedMarkerId={selectedMarkerId}
                showOfficialLayer={showOfficialLayer}
                t={t}
                transform={transform}
                getMarkerDiffKind={(marker) => diffKindByMarkerId.get(marker.id)}
                getMarkerLabel={(marker) =>
                  localizeEntity({
                    entityType: 'marker',
                    entityId: marker.id,
                    field: 'label',
                    fallback: marker.label,
                    locale: selectedLocale,
                    translations,
                  })
                }
                onDraftDragMove={noop}
                onDraftDragStart={noop}
                onDraftDragStop={noop}
                onDraftLabelChange={noop}
                onDropTool={noop}
                onMarkerDragStart={noop}
                onMarkerSelect={onMarkerSelect}
                onPanMove={onPanMove}
                onPanStart={onPanStart}
                onPanStop={onPanStop}
                onReferencePointChange={onReferencePointChange}
                onToolDragEnd={noop}
                onWheelZoom={onWheelZoom}
              />
            )
          })}
        </div>

        <div className="status-strip">
          <span>{selectedMapName || t('loadingRepositoryData')}</span>
          <span>{selectedFloor ? localizeFloorName(selectedFloor, selectedLocale, translations) : t('noFloorSelected')}</span>
          <span>{sourceLabel}</span>
          <span>
            {proposalMarkers.length} {t('proposalPreviewMarkers')}
          </span>
          <span>{t('proposalDiffLegend')}</span>
        </div>
      </section>

      <aside className="inspector proposal-inspector" aria-label={t('proposalDetails')}>
        <ProposalDetailPanel
          maps={maps}
          selectedLocale={selectedLocale}
          state={detailState}
          t={t}
          translations={translations}
          onMarkerSelect={onMarkerSelect}
          onRefresh={onRefresh}
        />
      </aside>
    </>
  )
}

function ProposalDetailPanel({
  maps,
  onMarkerSelect,
  selectedLocale,
  state,
  t,
  translations,
  onRefresh,
}: {
  maps: OfficialMap[]
  onMarkerSelect: (markerId: string) => void
  selectedLocale: string
  state: ProposalDetailState
  t: (key: string) => string
  translations: TranslationEntry[]
  onRefresh: () => void
}) {
  if (state.status === 'unavailable') {
    return (
      <section className="panel proposal-detail-panel">
        <ProposalEmptyState
          icon={<AlertTriangle size={22} />}
          title={t('proposalApiUnavailableTitle')}
          message={t('proposalApiUnavailableMessage')}
        />
      </section>
    )
  }

  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <section className="panel proposal-detail-panel">
        <ProposalEmptyState icon={<CircleDashed size={22} />} title={t('loadingProposal')} message={t('loadingRepositoryData')} />
      </section>
    )
  }

  if (state.status === 'error') {
    return (
      <section className="panel proposal-detail-panel">
        <ProposalEmptyState icon={<XCircle size={22} />} title={t('proposalApiErrorTitle')} message={state.message || t('proposalApiErrorMessage')} />
        <button className="primary-button proposal-wide-button" type="button" onClick={onRefresh}>
          <RefreshCw size={16} />
          {t('refresh')}
        </button>
      </section>
    )
  }

  if (state.status !== 'ready') {
    return null
  }

  const detail = state.detail

  return (
    <>
      <section className="panel proposal-detail-panel">
        <div className="panel-title">
          <GitPullRequestArrow size={16} />
          {t('proposalDetails')}
        </div>
        <div className="proposal-detail-header">
          <span className="proposal-number">#{detail.number}</span>
          <h2>{detail.title}</h2>
          <p>{t('proposalAuthor').replace('{author}', detail.author)}</p>
        </div>
        <div className="proposal-badges detail-badges">
          <span className={`risk-badge ${detail.risk}`}>{proposalRiskLabel(detail.risk, t)}</span>
          <span className={`check-badge ${detail.checkState}`}>
            <ProposalCheckIcon state={detail.checkState} />
            {proposalCheckLabel(detail.checkState, t)}
          </span>
          <span className="vote-pill">{formatProposalVotes(detail.votes, t)}</span>
        </div>
        <div className="proposal-detail-actions">
          <button className="primary-button secondary-button" type="button" onClick={onRefresh}>
            <RefreshCw size={16} />
            {t('refresh')}
          </button>
          {detail.githubUrl && (
            <a className="primary-button secondary-button" href={detail.githubUrl} rel="noreferrer" target="_blank">
              <ExternalLink size={16} />
              GitHub
            </a>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-title">
          <FileJson size={16} />
          {t('changedFiles')}
        </div>
        {detail.changedFiles.length > 0 ? (
          <div className="changed-file-list">
            {detail.changedFiles.map((file) => (
              <div className="changed-file-row" key={`${file.path}:${file.status}`}>
                <span>{file.path}</span>
                <small>
                  {file.status || t('changed')}
                  {file.additions !== undefined || file.deletions !== undefined
                    ? ` +${file.additions ?? 0} / -${file.deletions ?? 0}`
                    : ''}
                </small>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">{t('noChangedFiles')}</p>
        )}
      </section>

      <section className="panel">
        <div className="panel-title">
          <MousePointer2 size={16} />
          {t('markerDiff')}
        </div>
        <div className="proposal-diff-legend">
          <span className="legend-added">{t('diffAdded')}</span>
          <span className="legend-updated">{t('diffUpdated')}</span>
          <span className="legend-deleted">{t('diffDeleted')}</span>
        </div>
        {detail.markerDiffs.length > 0 ? (
          <div className="marker-diff-list">
            {detail.markerDiffs.map((diff) => {
              const marker = diff.after ?? diff.before
              const markerMap = marker ? maps.find((map) => map.id === marker.mapId) : undefined
              const markerFloor = markerMap?.floors.find((floor) => floor.id === marker?.floorId)
              const markerMapName = markerMap
                ? localizeEntity({
                    entityType: 'map',
                    entityId: markerMap.id,
                    field: 'name',
                    fallback: markerMap.name,
                    locale: selectedLocale,
                    translations,
                  })
                : marker?.mapId
              const markerFloorName = markerFloor ? localizeFloorName(markerFloor, selectedLocale, translations) : marker?.floorId

              return (
                <button
                  className={`marker-diff-row ${diff.kind}`}
                  key={`${diff.kind}:${diff.markerId}`}
                  type="button"
                  onClick={() => marker && onMarkerSelect(marker.id)}
                >
                  <span>{proposalDiffLabel(diff.kind, t)}</span>
                  <strong>{marker ? formatMarkerDisplayLabel(marker, marker.label, t) : diff.markerId}</strong>
                  {marker && <small>{`${markerMapName} / ${markerFloorName}`}</small>}
                </button>
              )
            })}
          </div>
        ) : (
          <p className="muted">{t('noMarkerDiff')}</p>
        )}
      </section>
    </>
  )
}

function ProposalEmptyState({ icon, title, message }: { icon: ReactNode; title: string; message: string }) {
  return (
    <div className="proposal-empty-state">
      {icon}
      <strong>{title}</strong>
      <p>{message}</p>
    </div>
  )
}

function MapPane({
  activeToolPointerId,
  activeTool,
  canEdit,
  draft,
  draftAction,
  draggingDraft,
  disabledFloorId,
  floor,
  floorName,
  floorOptions,
  ghostedMarkerId,
  getMarkerLabel,
  getMarkerDiffKind,
  isSelectedFloor,
  linkedView,
  mapId,
  markers,
  referencePoint,
  selectedMarkerId,
  showOfficialLayer,
  t,
  transform,
  onDraftDragMove,
  onDraftDragStart,
  onDraftDragStop,
  onDraftLabelChange,
  onDropTool,
  onFloorSelect,
  onMarkerDragStart,
  onMarkerSelect,
  onPanMove,
  onPanStart,
  onPanStop,
  onReferencePointChange,
  onToolDragEnd,
  onWheelZoom,
}: {
  activeToolPointerId: number | null
  activeTool: MarkerToolDefinition | null
  canEdit: boolean
  draft: DraftMarker
  draftAction: DraftAction
  draggingDraft: boolean
  disabledFloorId?: string
  floor?: { id: string; name: string; image?: string; sort: number }
  floorName?: string
  floorOptions?: Array<{ id: string; label: string }>
  ghostedMarkerId: string | null
  getMarkerLabel: (marker: CommunityMarker) => string
  getMarkerDiffKind?: (marker: CommunityMarker) => ProposalMarkerDiffKind | undefined
  isSelectedFloor: boolean
  linkedView?: boolean
  mapId: string
  markers: CommunityMarker[]
  referencePoint: ReferencePoint | null
  selectedMarkerId?: string
  showOfficialLayer: boolean
  t: (key: string) => string
  transform: { scale: number; x: number; y: number }
  onDraftDragMove: (event: React.PointerEvent<SVGElement>, mapId: string, floorId: string, x: number, y: number) => void
  onDraftDragStart: (event: React.PointerEvent<SVGGElement>, mapId: string, floorId: string, x: number, y: number) => void
  onDraftDragStop: (event: React.PointerEvent<SVGElement>) => void
  onDraftLabelChange: (label: string) => void
  onDropTool: (tool: MarkerToolDefinition, mapId: string, floorId: string, x: number, y: number) => void
  onFloorSelect?: (floorId: string) => void
  onMarkerDragStart: (
    event: React.PointerEvent<SVGGElement>,
    marker: CommunityMarker,
    mapId: string,
    floorId: string,
    x: number,
    y: number,
  ) => void
  onMarkerSelect: (markerId: string) => void
  onPanMove: (event: React.PointerEvent<SVGSVGElement>) => void
  onPanStart: (event: React.PointerEvent<SVGSVGElement>) => void
  onPanStop: (event: React.PointerEvent<SVGSVGElement>) => void
  onReferencePointChange: (point: ReferencePoint | null) => void
  onToolDragEnd: () => void
  onWheelZoom: (delta: number) => void
}) {
  const surfaceRef = useRef<SVGRectElement | null>(null)
  const referenceClickCandidate = useRef<ReferenceClickCandidate | null>(null)

  function coordinateFromClient(clientX: number, clientY: number) {
    const rect = surfaceRef.current?.getBoundingClientRect()

    if (!rect || rect.width === 0 || rect.height === 0) {
      return { x: 0.5, y: 0.5 }
    }

    return {
      x: clamp((clientX - rect.left) / rect.width),
      y: clamp((clientY - rect.top) / rect.height),
    }
  }

  const showDraft = shouldShowDraftMarker({
    canEdit,
    draft,
    draftAction,
    floorId: floor?.id,
    hasFloor: Boolean(floor),
    mapId,
  })
  const displayFloorName = floorName ?? t('noFloorSelected')

  return (
    <article className="map-pane" aria-label={displayFloorName}>
      <div className="pane-header">
        {floor && floorOptions && onFloorSelect ? (
          <label className={isSelectedFloor ? 'pane-title selected' : 'pane-title'}>
            <span className="sr-only">{t('floor')}</span>
            <select value={floor.id} onChange={(event) => onFloorSelect(event.target.value)}>
              {floorOptions.map((option) => (
                <option disabled={option.id === disabledFloorId} key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className={isSelectedFloor ? 'pane-title selected' : 'pane-title'}>{displayFloorName}</div>
        )}
        {linkedView && <span className="pane-sync-indicator">{t('syncedView')}</span>}
      </div>
      <svg
        className="blueprint"
        viewBox="0 0 1000 620"
        preserveAspectRatio="xMidYMid slice"
        role="group"
        aria-label={displayFloorName}
        onDragOver={(event) => {
          if (canEdit) {
            event.preventDefault()
          }
        }}
        onDrop={(event) => {
          if (!canEdit || !floor) {
            return
          }

          const markerToolId = event.dataTransfer.getData('application/x-r6maps-marker-tool-id')
          const markerType = event.dataTransfer.getData('application/x-r6maps-marker-type') as MarkerType
          const tool = MARKER_TOOL_BY_ID.get(markerToolId) ?? MARKER_TOOLS.find((candidate) => candidate.type === markerType)

          if (!tool) {
            return
          }

          event.preventDefault()
          const point = coordinateFromClient(event.clientX, event.clientY)
          onDropTool(tool, mapId, floor.id, point.x, point.y)
          onToolDragEnd()
        }}
        onPointerDown={(event) => {
          referenceClickCandidate.current =
            floor && !draggingDraft && !isReferenceBlockedTarget(event.target)
              ? beginReferenceClick(event, {
                  ...coordinateFromClient(event.clientX, event.clientY),
                  originFloorId: floor.id,
                  originFloorSort: floor.sort,
                })
              : null
          onPanStart(event)
        }}
        onPointerMove={(event) => {
          if (hasReferencePointerMoved(referenceClickCandidate.current, event)) {
            referenceClickCandidate.current = null
          }
          if (showDraft && floor) {
            const point = coordinateFromClient(event.clientX, event.clientY)
            onDraftDragMove(event, mapId, floor.id, point.x, point.y)
          }
          onPanMove(event)
        }}
        onPointerUp={(event) => {
          onDraftDragStop(event)
          onPanStop(event)
          const blocked = !floor || draggingDraft || isReferenceBlockedTarget(event.target)
          const candidate = referenceClickCandidate.current
          referenceClickCandidate.current = null
          if (
            candidate &&
            floor &&
            canEdit &&
            activeTool &&
            activeToolPointerId === null &&
            isReferenceClick(candidate, event, blocked)
          ) {
            const point = coordinateFromClient(event.clientX, event.clientY)
            onDropTool(activeTool, mapId, floor.id, point.x, point.y)
            return
          }
          if (candidate && floor && isReferenceClick(candidate, event, blocked)) {
            const point = coordinateFromClient(event.clientX, event.clientY)
            onReferencePointChange({
              ...point,
              originFloorId: floor.id,
              originFloorSort: floor.sort,
            })
          }
        }}
        onPointerUpCapture={(event) => {
          if (!canEdit || !floor || !activeTool || activeToolPointerId !== event.pointerId) {
            return
          }

          const point = coordinateFromClient(event.clientX, event.clientY)
          onDropTool(activeTool, mapId, floor.id, point.x, point.y)
          onToolDragEnd()
          event.stopPropagation()
        }}
        onPointerCancel={(event) => {
          referenceClickCandidate.current = null
          onDraftDragStop(event)
          onPanStop(event)
        }}
        onWheel={(event) => {
          onWheelZoom(event.deltaY < 0 ? 0.15 : -0.15)
        }}
      >
        <g
          className="map-content"
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transformOrigin: 'center',
          }}
        >
          <rect ref={surfaceRef} className="map-surface" x="0" y="0" width="1000" height="620" />
          <BlueprintRooms floor={floor} showOfficialLayer={showOfficialLayer} />
          {markers.map((marker) => (
            <MarkerNode
              key={marker.id}
              marker={marker}
              label={getMarkerLabel(marker)}
              selected={marker.id === selectedMarkerId}
              ghosted={marker.id === ghostedMarkerId}
              diffKind={getMarkerDiffKind?.(marker)}
              t={t}
              onDragStart={
                canEdit && floor
                  ? (event) => {
                      const point = coordinateFromClient(event.clientX, event.clientY)
                      onMarkerDragStart(event, marker, mapId, floor.id, point.x, point.y)
                    }
                  : undefined
              }
              onSelect={() => onMarkerSelect(marker.id)}
            />
          ))}
          {showDraft && floor && (
            <g
              className={draggingDraft ? 'draft-marker dragging' : 'draft-marker'}
              transform={`translate(${draft.x * 1000} ${draft.y * 620})`}
              onPointerDown={(event) => {
                const point = coordinateFromClient(event.clientX, event.clientY)
                onDraftDragStart(event, mapId, floor.id, point.x, point.y)
              }}
              onPointerMove={(event) => {
                const point = coordinateFromClient(event.clientX, event.clientY)
                onDraftDragMove(event, mapId, floor.id, point.x, point.y)
              }}
              onPointerUp={onDraftDragStop}
              onPointerCancel={onDraftDragStop}
            >
              {draft.type === 'text-label' ? (
                <g transform={`rotate(${markerRotation(draft)}) scale(${markerSize(draft)})`}>
                  <foreignObject x="-75" y="-18" width="150" height="38">
                    <input
                      aria-label={t('textLabel')}
                      className="text-label-input"
                      placeholder={t('textLabelPlaceholder')}
                      value={draft.label}
                      onChange={(event) => onDraftLabelChange(event.target.value)}
                      onPointerDown={(event) => event.stopPropagation()}
                      onPointerMove={(event) => event.stopPropagation()}
                      onPointerUp={(event) => event.stopPropagation()}
                    />
                  </foreignObject>
                  <circle className="text-label-drag-handle" cx="82" cy="0" r="6">
                    <title>{t('textLabelDragHandle')}</title>
                  </circle>
                </g>
              ) : (
                <>
                  <title>{formatMarkerDisplayLabel(draft, undefined, t)}</title>
                  <circle className="marker-hit-area" r={markerHitRadius(draft)} />
                  <MarkerSymbol marker={draft} />
                </>
              )}
            </g>
          )}
          {referencePoint && floor && (
            <PingMarkerOverlay
              floorId={floor.id}
              floorSort={floor.sort}
              point={referencePoint}
              scale={transform.scale}
              onHide={() => onReferencePointChange(null)}
            />
          )}
        </g>
      </svg>
    </article>
  )
}

function isReferenceBlockedTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('.map-marker, .draft-marker, .text-label-input'))
}

function PingMarkerOverlay({
  floorId,
  floorSort,
  point,
  scale,
  onHide,
}: {
  floorId: string
  floorSort: number
  point: ReferencePoint
  scale: number
  onHide: () => void
}) {
  const x = point.x * 1000
  const y = point.y * 620
  const radius = getPingMarkerRadius(scale)
  const direction = getPingOtherFloorDirection(point, floorId, floorSort)

  return (
    <g className="ping-marker-layer" aria-hidden="true">
      <line className="ping-marker vertical" x1={x} y1="0" x2={x} y2="620" />
      <line className="ping-marker horizontal" x1="0" y1={y} x2="1000" y2={y} />
      <circle className="ping-marker accent" cx={x} cy={y} r={radius.accentRadius} strokeWidth={radius.strokeWidth} />
      <circle
        className={direction === 'origin' ? 'ping-marker center' : 'ping-marker center other-floor'}
        cx={x}
        cy={y}
        r={radius.radius}
        strokeWidth={radius.strokeWidth}
        onClick={(event) => {
          event.stopPropagation()
          onHide()
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerMove={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
      />
    </g>
  )
}

function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="toggle">
      <input checked={checked} type="checkbox" onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

function AnnotationToolbar({
  onToolDragEnd,
  onToolDragStart,
  selectedToolId,
  tools,
  onSelect,
  t,
}: {
  onToolDragEnd?: (pointerId?: number) => void
  onToolDragStart?: (toolId: string, pointerId: number) => void
  selectedToolId: string | null
  tools?: MarkerToolDefinition[]
  onSelect: (tool: MarkerToolDefinition) => void
  t: (key: string) => string
}) {
  const availableTools = tools ?? MARKER_TOOLS

  return (
    <div className="annotation-toolbar" role="toolbar" aria-label="Annotation tools">
      {availableTools.map((tool) => {
        const label = t(tool.labelKey)
        const selected = tool.id === selectedToolId

        return (
          <button
            aria-label={label}
            aria-pressed={selected}
            className={selected ? 'annotation-tool selected' : 'annotation-tool'}
            draggable
            key={tool.id}
            title={label}
            type="button"
            onClick={() => onSelect(tool)}
            onPointerDown={(event) => {
              if (event.button === 0) {
                onToolDragStart?.(tool.id, event.pointerId)
              }
            }}
            onPointerUp={(event) => onToolDragEnd?.(event.pointerId)}
            onPointerCancel={(event) => onToolDragEnd?.(event.pointerId)}
            onDragEnd={() => onToolDragEnd?.()}
            onDragStart={(event) => {
              event.dataTransfer.setData('application/x-r6maps-marker-tool-id', tool.id)
              event.dataTransfer.setData('application/x-r6maps-marker-type', tool.type)
              event.dataTransfer.effectAllowed = 'copy'
            }}
          >
            <svg viewBox="-18 -18 36 36" aria-hidden="true">
              <MarkerSymbol compact marker={draftPreviewForTool(tool)} />
            </svg>
            <span>{label}</span>
          </button>
        )
      })}
    </div>
  )
}

function MarkerMetadataFields({
  draft,
  t,
  onChange,
}: {
  draft: DraftMarker
  t: (key: string) => string
  onChange: (draft: DraftMarker) => void
}) {
  let typeSpecificFields: ReactNode = null

  if (draft.type === 'bomb') {
    typeSpecificFields = (
      <>
        <label className="field compact-field">
          <span>{t('siteNumber')}</span>
          <input
            min="1"
            type="number"
            value={draft.siteNumber ?? 1}
            onChange={(event) =>
              onChange({
                ...draft,
                siteNumber: positiveIntegerFromInput(event.target.value, draft.siteNumber ?? 1),
              })
            }
          />
        </label>
        <label className="field compact-field">
          <span>{t('siteLetter')}</span>
          <select
            value={draft.siteLetter ?? 'A'}
            onChange={(event) =>
              onChange({
                ...draft,
                siteLetter: event.target.value === 'B' ? 'B' : 'A',
              })
            }
          >
            <option value="A">A</option>
            <option value="B">B</option>
          </select>
        </label>
      </>
    )
  } else if (draft.type === 'spawn') {
    typeSpecificFields = (
      <>
        <label className="field compact-field">
          <span>{t('spawnNumber')}</span>
          <input
            min="1"
            type="number"
            value={draft.spawnNumber ?? 1}
            onChange={(event) =>
              onChange({
                ...draft,
                spawnNumber: positiveIntegerFromInput(event.target.value, draft.spawnNumber ?? 1),
              })
            }
          />
        </label>
        <label className="field compact-field wide-field">
          <span>{t('spawnName')}</span>
          <input value={draft.spawnName ?? ''} onChange={(event) => onChange({ ...draft, spawnName: event.target.value })} />
        </label>
      </>
    )
  } else if (draft.type === 'vertical-route') {
    typeSpecificFields = (
      <>
        <label className="field compact-field wide-field">
          <span>{t('direction')}</span>
          <select
            value={draft.direction ?? 'up'}
            onChange={(event) =>
              onChange({
                ...draft,
                direction: event.target.value === 'down' ? 'down' : 'up',
              })
            }
          >
            <option value="up">{t('directionUp')}</option>
            <option value="down">{t('directionDown')}</option>
          </select>
        </label>
      </>
    )
  }

  return (
    <div className="metadata-grid marker-size-grid">
      {typeSpecificFields}
      <MarkerSizeFields
        draft={draft}
        label={draft.type === 'text-label' ? t('textLabelSize') : t('markerSize')}
        onChange={onChange}
      />
      <MarkerRotationFields draft={draft} t={t} onChange={onChange} />
    </div>
  )
}

function MarkerSizeFields({
  draft,
  label,
  onChange,
}: {
  draft: DraftMarker
  label: string
  onChange: (draft: DraftMarker) => void
}) {
  const size = markerSize(draft)

  return (
    <>
      <label className="field compact-field wide-field">
        <span>{label}</span>
        <input
          max="2.5"
          min="0.5"
          step="0.1"
          type="range"
          value={size}
          onChange={(event) =>
            onChange({
              ...draft,
              size: normalizedSizeFromInput(event.target.value, size),
            })
          }
        />
      </label>
      <label className="field compact-field">
        <span>{label}</span>
        <input
          max="2.5"
          min="0.5"
          step="0.1"
          type="number"
          value={size}
          onChange={(event) =>
            onChange({
              ...draft,
              size: normalizedSizeFromInput(event.target.value, size),
            })
          }
        />
      </label>
    </>
  )
}

function MarkerRotationFields({
  draft,
  t,
  onChange,
}: {
  draft: DraftMarker
  t: (key: string) => string
  onChange: (draft: DraftMarker) => void
}) {
  return (
    <>
      <label className="field compact-field wide-field">
        <span>{t('textLabelRotation')}</span>
        <input
          max="180"
          min="-180"
          step="1"
          type="range"
          value={markerRotation(draft)}
          onChange={(event) =>
            onChange({
              ...draft,
              rotation: normalizedRotationFromInput(event.target.value, markerRotation(draft)),
            })
          }
        />
      </label>
      <label className="field compact-field">
        <span>{t('textLabelRotation')}</span>
        <input
          max="180"
          min="-180"
          step="1"
          type="number"
          value={markerRotation(draft)}
          onChange={(event) =>
            onChange({
              ...draft,
              rotation: normalizedRotationFromInput(event.target.value, markerRotation(draft)),
            })
          }
        />
      </label>
    </>
  )
}

function useCompactViewport() {
  const [isCompact, setIsCompact] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia('(max-width: 760px)').matches,
  )

  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)')
    const update = () => setIsCompact(query.matches)

    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return isCompact
}

function BlueprintRooms({ floor, showOfficialLayer }: { floor?: { image?: string }; showOfficialLayer: boolean }) {
  if (!showOfficialLayer) {
    return null
  }

  if (floor?.image) {
    return (
      <image
        className="blueprint-image"
        href={`${import.meta.env.BASE_URL}${floor.image}`}
        width="1000"
        height="620"
        preserveAspectRatio="xMidYMid slice"
      />
    )
  }

  return (
    <g className="rooms">
      <rect x="115" y="80" width="770" height="460" rx="8" />
      <path d="M115 235 H885 M115 385 H885 M300 80 V540 M520 80 V540 M700 80 V540" />
      <path d="M300 235 C382 215 445 218 520 235 M520 385 C598 405 642 402 700 385" />
      <rect x="160" y="120" width="110" height="74" rx="4" />
      <rect x="735" y="420" width="105" height="76" rx="4" />
      <rect x="555" y="120" width="104" height="72" rx="4" />
      <text x="175" y="162">service</text>
      <text x="352" y="164">counting</text>
      <text x="574" y="163">vault</text>
      <text x="742" y="314">casino</text>
      <text x="158" y="465">marina</text>
      <text x="382" y="465">lounge</text>
      <text x="742" y="465">security</text>
    </g>
  )
}

function MarkerNode({
  diffKind,
  ghosted = false,
  marker,
  label,
  selected,
  t,
  onDragStart,
  onSelect,
}: {
  diffKind?: ProposalMarkerDiffKind
  ghosted?: boolean
  marker: CommunityMarker
  label: string
  selected: boolean
  t: (key: string) => string
  onDragStart?: (event: React.PointerEvent<SVGGElement>) => void
  onSelect: () => void
}) {
  const displayLabel = formatMarkerDisplayLabel(marker, label, t)
  const markerExtent = 13 * markerSize(marker)
  const className = [
    'map-marker',
    marker.type,
    selected ? 'selected' : '',
    ghosted ? 'drag-source-ghost' : '',
    diffKind ? `proposal-marker-${diffKind}` : '',
  ]
    .filter(Boolean)
    .join(' ')

  function selectMarkerFromKeyboard(event: React.KeyboardEvent<SVGGElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return
    }

    event.stopPropagation()
    if (event.key === ' ') {
      event.preventDefault()
    }
    onSelect()
  }

  function stopMarkerPointerEvent(event: React.PointerEvent<SVGGElement>) {
    event.stopPropagation()
  }

  function handleMarkerPointerDown(event: React.PointerEvent<SVGGElement>) {
    if (onDragStart) {
      onDragStart(event)
      return
    }

    stopMarkerPointerEvent(event)
  }

  function handleMarkerPointerMove(event: React.PointerEvent<SVGGElement>) {
    if (!onDragStart) {
      stopMarkerPointerEvent(event)
    }
  }

  function handleMarkerPointerEnd(event: React.PointerEvent<SVGGElement>) {
    if (!onDragStart) {
      stopMarkerPointerEvent(event)
    }
  }

  if (marker.type === 'text-label') {
    return (
      <g
        aria-label={displayLabel}
        className={className}
        focusable="true"
        role="button"
        tabIndex={0}
        onClick={(event) => {
          event.stopPropagation()
          onSelect()
        }}
        onKeyDown={selectMarkerFromKeyboard}
        onPointerCancel={handleMarkerPointerEnd}
        onPointerDown={handleMarkerPointerDown}
        onPointerMove={handleMarkerPointerMove}
        onPointerUp={handleMarkerPointerEnd}
        transform={`translate(${marker.x * 1000} ${marker.y * 620})`}
      >
        <title>{displayLabel}</title>
        <TextLabelTransform marker={marker}>
          <text className="map-text-label-text">{displayLabel}</text>
        </TextLabelTransform>
      </g>
    )
  }

  return (
    <g
      aria-label={displayLabel}
      className={className}
      focusable="true"
      role="button"
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation()
        onSelect()
      }}
      onKeyDown={selectMarkerFromKeyboard}
      onPointerCancel={handleMarkerPointerEnd}
      onPointerDown={handleMarkerPointerDown}
      onPointerMove={handleMarkerPointerMove}
      onPointerUp={handleMarkerPointerEnd}
      transform={`translate(${marker.x * 1000} ${marker.y * 620})`}
    >
      <title>{displayLabel}</title>
      <circle className="marker-hit-area" r={markerHitRadius(marker)} />
      <MarkerSymbol marker={marker} />
      <foreignObject className="marker-popover-shell" x={markerExtent + 5} y="-31" width="190" height="62">
        <div className="marker-popover">{displayLabel}</div>
      </foreignObject>
    </g>
  )
}

function TextLabelTransform({ children, marker }: { children: ReactNode; marker: MarkerGlyphData }) {
  return <g transform={`rotate(${markerRotation(marker)}) scale(${markerSize(marker)})`}>{children}</g>
}

function MarkerReferenceLegend({ tools, t }: { tools: MarkerToolDefinition[]; t: (key: string) => string }) {
  return (
    <aside className="marker-reference-legend" aria-label={t('markerLegend')}>
      <div className="marker-reference-title">{t('markerLegend')}</div>
      <ul>
        {tools.map((tool) => (
          <li key={tool.id}>
            <svg aria-hidden="true" viewBox="-18 -18 36 36">
              <MarkerSymbol compact marker={draftPreviewForTool(tool)} />
            </svg>
            <span>{t(tool.labelKey)}</span>
          </li>
        ))}
      </ul>
    </aside>
  )
}

function MarkerSymbol({ marker, compact = false }: { marker: MarkerGlyphData; compact?: boolean }) {
  const iconSize = compact ? 24 : 26
  const iconOffset = -iconSize / 2

  if (hasR6CallsEditSymbol(marker.type)) {
    return (
      <MarkerSymbolTransform marker={marker}>
        <R6CallsEditSymbol marker={marker} />
      </MarkerSymbolTransform>
    )
  }

  if (marker.type === 'vertical-route') {
    return (
      <MarkerSymbolTransform marker={marker}>
        <MarkerIcon file={directionIconFile(marker.direction)} offset={iconOffset} size={iconSize} />
      </MarkerSymbolTransform>
    )
  }

  return (
    <MarkerSymbolTransform marker={marker}>
      <g className="marker-symbol badge-symbol spawn-symbol">
        <rect x="-13" y="-10" width="26" height="20" rx="8" />
        <text y="4">{marker.spawnNumber ?? 1}</text>
      </g>
    </MarkerSymbolTransform>
  )
}

const R6CALLS_GAS_PIPE_PATH =
  'M344.33 175.061c0-.1.047-.136.184-.136h.08v-4.029h-.08c-.137 0-.185-.035-.185-.136v-.095h.922c.81 0 .923.006.94.052.028.07.028.068-.031.127a.23.23 0 0 1-.14.052h-.089l.01.517c.005.284-.004.53-.02.547-.017.016-.214.079-.44.139l-.409.109.314.147.314.147-.388.207a4 4 0 0 0-.402.23c-.008.013.169.127.393.253.225.126.402.24.393.253a2.4 2.4 0 0 1-.278.183 2 2 0 0 0-.263.174c0 .01.175.077.388.15l.388.131v.842h.089c.104 0 .204.088.177.156a.3.3 0 0 0-.018.062c0 .008-.416.014-.925.014h-.925zm2.229-1.105c-.166-.078-.488-.343-.544-.449-.028-.052-.015-.051.156.007.25.084.41.057.674-.114q.396-.257.562-.257.213-.003-.007-.163a.84.84 0 0 0-.644-.141.5.5 0 0 1-.177.02c-.008-.008.056-.082.143-.165.086-.083.147-.161.135-.173-.012-.013-.136-.022-.276-.02-.226.001-.326.023-.58.13-.058.024-.056.014.016-.118.104-.19.31-.397.476-.476.197-.095.518-.105.76-.023.222.075.447.194.594.317l.1.082-.14.001a.9.9 0 0 0-.281.06l-.141.057.333.018c.438.024.63.114.972.458l.247.249-.28.019c-.334.023-.455.072-.927.38-.621.403-.835.458-1.17.3z'

function R6CallsEditSymbol({ marker }: { marker: MarkerGlyphData }) {
  return (
    <g className={`marker-symbol r6calls-edit-symbol r6calls-edit-symbol-${marker.type}`}>
      {r6CallsEditSymbolShape(marker)}
    </g>
  )
}

function r6CallsEditSymbolShape(marker: MarkerGlyphData) {
  switch (marker.type) {
    case 'bomb':
      return (
        <>
          <rect className="r6calls-danger-fill r6calls-dark-stroke" x="-9" y="-9" width="18" height="18" rx="2" />
          <path className="r6calls-light-stroke" d="M-4 -6h8M-4 0h8M-4 6h8" />
          <text className="r6calls-symbol-text" y="4">
            {marker.siteNumber ?? 1}
            {marker.siteLetter ?? 'A'}
          </text>
        </>
      )
    case 'floor-hatch':
      return <R6CallsPatternBlock x={-9} y={-9} width={18} height={18} tone="hatch" />
    case 'ceiling-hatch':
      return <R6CallsPatternBlock x={-9} y={-9} width={18} height={18} tone="ceiling" />
    case 'breakable-wall':
      return <R6CallsPatternBlock x={-12} y={-3} width={24} height={6} tone="breakable" />
    case 'line-of-sight-wall':
      return (
        <>
          <R6CallsPatternBlock x={-12} y={-4} width={24} height={8} tone="line-of-sight" />
          <path className="r6calls-danger-stroke" d="M-12 0h24" />
        </>
      )
    case 'line-of-sight-floor':
      return (
        <>
          <path className="r6calls-pattern-base line-of-sight" d="M-11 -8h16l6 6v10h-22z" />
          <path className="r6calls-pattern-line" d="M-10 7 5 -8M-5 8 9 -6M0 8 11 -3" />
          <path className="r6calls-danger-stroke" d="M-8 -1h16" />
        </>
      )
    case 'skylight':
      return (
        <>
          <rect className="r6calls-pattern-base skylight" x="-10" y="-10" width="20" height="20" rx="1" />
          <path className="r6calls-light-stroke" d="M-7 -7 7 7M7 -7-7 7" />
        </>
      )
    case 'drone-tunnel':
      return (
        <>
          <rect className="r6calls-pattern-base drone" x="-7" y="-12" width="14" height="24" />
          <path className="r6calls-purple-stroke" d="M-2 -9v18M3 -9v18" />
        </>
      )
    case 'camera':
      return (
        <>
          <rect className="r6calls-dark-fill r6calls-light-stroke" x="-11" y="-8" width="17" height="13" rx="1.5" />
          <path className="r6calls-light-fill" d="m6 -4 7-4v14l-7-4z" />
          <circle className="r6calls-dark-fill" cx="-4" cy="-1.5" r="3.2" />
        </>
      )
    case 'ladder':
      return (
        <>
          <path className="r6calls-light-stroke ladder-rail" d="M-7 -12v24M7 -12v24" />
          <path className="r6calls-light-stroke" d="M-7 -8H7M-7 -4H7M-7 0H7M-7 4H7M-7 8H7" />
        </>
      )
    case 'fire-extinguisher':
      return (
        <>
          <path className="r6calls-danger-fill" d="M-4 -7h8l2 4v12a5 5 0 0 1-10 0V-3z" />
          <path className="r6calls-light-stroke" d="M-3 -11h6M0 -11v4M4 -5h5" />
          <path className="r6calls-dark-stroke" d="M-4 -1h8" />
        </>
      )
    case 'gas-pipe':
      return (
        <svg className="r6calls-source-svg" x="-13" y="-9" width="26" height="18" viewBox="343.9 170.4 7.5 5.4">
          <path className="r6calls-danger-fill" d={R6CALLS_GAS_PIPE_PATH} />
        </svg>
      )
    case 'insertion-point':
      return (
        <>
          <path className="r6calls-dark-fill r6calls-light-stroke" d="M-10 10V-6l10-6 10 6v16z" />
          <text className="r6calls-symbol-text" y="5">
            A
          </text>
        </>
      )
    case 'text-label':
      return (
        <>
          <rect className="r6calls-dark-fill r6calls-light-stroke" x="-12" y="-8" width="24" height="16" rx="1" />
          <text className="r6calls-call-text" y="3">
            CALL
          </text>
        </>
      )
    case 'compass':
      return (
        <>
          <circle className="r6calls-dark-fill r6calls-light-stroke" cx="0" cy="0" r="11" />
          <path className="r6calls-light-fill" d="M0-9 4 3 0 1-4 3z" />
          <path className="r6calls-muted-stroke" d="M0 1v8" />
        </>
      )
    case 'wall':
      return (
        <>
          <rect className="r6calls-light-fill r6calls-dark-stroke" x="-12" y="-4" width="24" height="8" />
          <path className="r6calls-dark-stroke" d="M-12 0h24" />
        </>
      )
    case 'door':
      return (
        <>
          <rect className="r6calls-light-fill r6calls-dark-stroke" x="-12" y="-3" width="17" height="6" />
          <path className="r6calls-light-stroke" d="M5 -9v18M5 -9C10 -8 13 -4 13 3" />
        </>
      )
    case 'double-door':
      return (
        <>
          <rect className="r6calls-light-fill r6calls-dark-stroke" x="-14" y="-3" width="28" height="6" />
          <path className="r6calls-light-stroke" d="M0 -9v18M0 -9C-6 -8 -9 -4 -8 3M0 -9C6 -8 9 -4 8 3" />
        </>
      )
    case 'window':
      return (
        <>
          <rect className="r6calls-light-fill r6calls-dark-stroke" x="-12" y="-5" width="24" height="10" />
          <path className="r6calls-window-stroke" d="M-10 0h20" />
        </>
      )
    case 'double-window':
      return (
        <>
          <rect className="r6calls-light-fill r6calls-dark-stroke" x="-13" y="-6" width="26" height="12" />
          <path className="r6calls-window-stroke" d="M-11 -1h22M-11 3h22" />
        </>
      )
    default:
      return null
  }
}

function R6CallsPatternBlock({
  height,
  tone,
  width,
  x,
  y,
}: {
  height: number
  tone: 'hatch' | 'ceiling' | 'breakable' | 'line-of-sight'
  width: number
  x: number
  y: number
}) {
  const lineStep = Math.max(4, Math.min(width, height) / 2)
  const first = x - height
  const second = first + lineStep
  const third = second + lineStep
  const fourth = third + lineStep
  const fifth = fourth + lineStep

  return (
    <>
      <rect className={`r6calls-pattern-base ${tone}`} x={x} y={y} width={width} height={height} />
      <path
        className="r6calls-pattern-line"
        d={`M${first} ${y + height} L${first + height} ${y} M${second} ${y + height} L${second + height} ${y} M${third} ${y + height} L${third + height} ${y} M${fourth} ${y + height} L${fourth + height} ${y} M${fifth} ${y + height} L${fifth + height} ${y}`}
      />
    </>
  )
}

function MarkerSymbolTransform({ children, marker }: { children: ReactNode; marker: MarkerGlyphData }) {
  return <g transform={`rotate(${markerRotation(marker)}) scale(${markerSize(marker)})`}>{children}</g>
}

function MarkerIcon({
  className,
  file,
  offset,
  size,
}: {
  className?: string
  file: string
  offset: number
  size: number
}) {
  return (
    <image
      className={className ? `marker-icon ${className}` : 'marker-icon'}
      href={`${import.meta.env.BASE_URL}icons/markers/${file}`}
      x={offset}
      y={offset}
      width={size}
      height={size}
      preserveAspectRatio="xMidYMid meet"
    />
  )
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${import.meta.env.BASE_URL}${path}`)

  if (!response.ok) {
    throw new Error(`Failed to load ${path}`)
  }

  return response.json() as Promise<T>
}

function clamp(value: number) {
  return Math.min(1, Math.max(0, value))
}

function githubIssueRepository() {
  const configuredRepo = import.meta.env.VITE_GITHUB_REPOSITORY?.trim() ?? ''

  return {
    repo: configuredRepo || DEFAULT_GITHUB_REPOSITORY,
    configured: Boolean(configuredRepo),
  }
}

function submissionApiBaseUrl() {
  return (import.meta.env.VITE_SUBMISSION_API_BASE?.trim() ?? '').replace(/\/+$/, '')
}

function apiUrl(baseUrl: string, path: string) {
  return `${baseUrl}${path}`
}

function parseAppHash(hash: string): AppRoute {
  const parts = hash
    .replace(/^#/, '')
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)

  if (parts[0] !== 'proposals') {
    return { kind: 'viewer' }
  }

  const number = Number(parts[1])

  return Number.isInteger(number) && number > 0 ? { kind: 'proposal-detail', number } : { kind: 'proposal-list' }
}

function proposalDetailHash(number: number) {
  return `#/proposals/${number}`
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unexpected proposal API error'
}

function proposalRiskLabel(risk: ProposalRisk, t: (key: string) => string) {
  if (risk === 'low') {
    return t('proposalRiskLow')
  }
  if (risk === 'medium') {
    return t('proposalRiskMedium')
  }
  if (risk === 'high') {
    return t('proposalRiskHigh')
  }

  return t('proposalRiskUnknown')
}

function proposalCheckLabel(state: ProposalCheckState, t: (key: string) => string) {
  if (state === 'passing') {
    return t('proposalChecksPassing')
  }
  if (state === 'pending') {
    return t('proposalChecksPending')
  }
  if (state === 'failing') {
    return t('proposalChecksFailing')
  }

  return t('proposalChecksUnknown')
}

function ProposalCheckIcon({ state }: { state: ProposalCheckState }) {
  if (state === 'passing') {
    return <CheckCircle2 size={15} />
  }
  if (state === 'failing') {
    return <XCircle size={15} />
  }
  if (state === 'pending') {
    return <CircleDashed size={15} />
  }

  return <AlertTriangle size={15} />
}

function formatProposalVotes(votes: ProposalVoteSummary, t: (key: string) => string) {
  return t('proposalVotes')
    .replace('{up}', String(votes.up))
    .replace('{down}', String(votes.down))
    .replace('{net}', String(votes.net))
}

function proposalDiffLabel(kind: ProposalMarkerDiffKind, t: (key: string) => string) {
  if (kind === 'added') {
    return t('diffAdded')
  }
  if (kind === 'updated') {
    return t('diffUpdated')
  }

  return t('diffDeleted')
}

function formatProposalDate(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function buildIssueOpsPayload(patch: Patch): IssueOpsPayload {
  return {
    kind: 'r6maps-community-change-set',
    version: 1,
    summary: summarizePatchForPreview(patch),
    patch,
  }
}

function buildIssueOpsIssueBody(payload: IssueOpsPayload) {
  return [
    'R6Maps community data change set submitted from the static editor.',
    '',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
  ].join('\n')
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T
  } catch {
    return {} as T
  }
}

function readPendingSubmissionPayload() {
  try {
    const value = window.sessionStorage.getItem(PENDING_SUBMISSION_KEY)

    return value ? (JSON.parse(value) as IssueOpsPayload) : null
  } catch {
    clearPendingSubmissionPayload()
    return null
  }
}

function writePendingSubmissionPayload(payload: IssueOpsPayload) {
  try {
    window.sessionStorage.setItem(PENDING_SUBMISSION_KEY, JSON.stringify(payload))
  } catch {
    // The OAuth flow still works, but automatic retry after redirect is unavailable.
  }
}

function clearPendingSubmissionPayload() {
  try {
    window.sessionStorage.removeItem(PENDING_SUBMISSION_KEY)
  } catch {
    // Ignore storage failures; the submission path can still fall back to IssueOps.
  }
}

function buildGitHubIssueUrl(repo: string, title: string) {
  const params = new URLSearchParams({
    title,
    body: buildShortGitHubIssueBody(),
    labels: COMMUNITY_DATA_ISSUE_LABEL,
  })

  return `https://github.com/${repo}/issues/new?${params.toString()}`
}

function buildShortGitHubIssueBody() {
  return [
    'The R6Maps editor copied the full JSON payload to your clipboard.',
    '',
    'Please paste that payload here before submitting this issue.',
  ].join('\n')
}

async function copySubmissionPayload(payload: string) {
  if (!navigator.clipboard) {
    return false
  }

  try {
    await navigator.clipboard.writeText(payload)
    return true
  } catch {
    return false
  }
}

function getInitialLocale() {
  try {
    const storedLocale = localStorage.getItem('r6maps-locale')
    if (storedLocale) {
      return storedLocale
    }
  } catch {
    // Ignore storage failures and fall back to the browser language.
  }

  if (typeof navigator === 'undefined') {
    return 'en'
  }

  const language = navigator.language
  if (language.startsWith('zh')) {
    return 'zh-CN'
  }
  if (language.startsWith('ja')) {
    return 'ja-JP'
  }
  if (language.startsWith('ko')) {
    return 'ko-KR'
  }

  return 'en'
}

function resolveMarkerTranslation(
  translations: TranslationEntry[],
  markerId: string | null,
  locale: string,
) {
  if (!markerId || locale === 'en') {
    return ''
  }

  return (
    translations.find(
      (translation) =>
        translation.entityType === 'marker' &&
        translation.entityId === markerId &&
        translation.field === 'label' &&
        translation.locale === locale &&
        translation.status !== 'deprecated',
    )?.value ?? ''
  )
}

function draftFromCommunityMarker(marker: CommunityMarker): DraftMarker {
  return {
    mapId: marker.mapId,
    floorId: marker.floorId,
    type: marker.type,
    label: marker.label,
    x: marker.x,
    y: marker.y,
    ...(marker.siteNumber !== undefined ? { siteNumber: marker.siteNumber } : {}),
    ...(marker.siteLetter !== undefined ? { siteLetter: marker.siteLetter } : {}),
    ...(marker.spawnNumber !== undefined ? { spawnNumber: marker.spawnNumber } : {}),
    ...(marker.spawnName !== undefined ? { spawnName: marker.spawnName } : {}),
    ...(marker.direction !== undefined ? { direction: marker.direction } : {}),
    ...(marker.size !== undefined ? { size: marker.size } : {}),
    ...(marker.rotation !== undefined ? { rotation: marker.rotation } : {}),
  }
}

function markerWithPendingDraftUpdate(marker: CommunityMarker, draft: DraftMarker): CommunityMarker {
  const normalizedDraft = normalizeDraftForPatch({
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
    x: normalizedDraft.x,
    y: normalizedDraft.y,
    ...communityMarkerMetadataFromDraft(normalizedDraft),
    source: marker.source,
    status: marker.status,
  }
}

function communityMarkerMetadataFromDraft(draft: DraftMarker): Partial<CommunityMarker> {
  const visualMetadata = {
    ...(draft.size !== undefined && draft.size !== 1 ? { size: draft.size } : {}),
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
      spawnName: draft.spawnName,
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

function markerRotationMetadataFromDraft(draft: DraftMarker): Partial<CommunityMarker> {
  return draft.rotation !== undefined && draft.rotation !== 0 ? { rotation: draft.rotation } : {}
}

function markerFromPendingAddDraft({ clientId, draft }: PendingAddDraft): CommunityMarker {
  const normalizedDraft = normalizeDraftForPatch(draft)

  return {
    id: pendingAddMarkerId(clientId),
    mapId: normalizedDraft.mapId,
    floorId: normalizedDraft.floorId,
    type: normalizedDraft.type,
    label: normalizedDraft.label,
    x: normalizedDraft.x,
    y: normalizedDraft.y,
    ...communityMarkerMetadataFromDraft(normalizedDraft),
    source: 'community',
    status: 'proposed',
  }
}

function pendingAddMarkerId(clientId: string) {
  return `${PENDING_ADD_MARKER_ID_PREFIX}${clientId}`
}

function pendingAddClientIdFromMarkerId(markerId: string) {
  return markerId.startsWith(PENDING_ADD_MARKER_ID_PREFIX) ? markerId.slice(PENDING_ADD_MARKER_ID_PREFIX.length) : null
}

function omitMarkerUpdate(updates: Record<string, DraftMarker>, markerId: string) {
  const remainingUpdates = { ...updates }

  delete remainingUpdates[markerId]

  return remainingUpdates
}

function draftAtCoordinate(
  draft: DraftMarker,
  mapId: string,
  floorId: string,
  x: number,
  y: number,
  tool?: MarkerToolDefinition,
): DraftMarker {
  return {
    ...(tool ? draftWithToolDefaults(draft, tool) : draft),
    mapId,
    floorId,
    x,
    y,
  }
}

function normalizeDraftForPatch(draft: DraftMarker): DraftMarker {
  return syncDraftLabel(draftWithTypeDefaults(draft, draft.type, false))
}

function draftWithTypeDefaults(draft: DraftMarker, type: MarkerType, resetLabel = true): DraftMarker {
  const base = draftBaseForType(draft, type)

  if (type === 'bomb') {
    const next = {
      ...base,
      siteNumber: draft.siteNumber ?? 1,
      siteLetter: draft.siteLetter ?? 'A',
    } satisfies DraftMarker

    return resetLabel ? syncDraftLabel(next) : next
  }

  if (type === 'spawn') {
    const next = {
      ...base,
      spawnNumber: draft.spawnNumber ?? 1,
      spawnName: draft.spawnName?.trim() || 'Main Gate',
    } satisfies DraftMarker

    return resetLabel ? syncDraftLabel(next) : next
  }

  if (type === 'vertical-route') {
    const next = {
      ...base,
      direction: draft.direction ?? 'up',
    } satisfies DraftMarker

    return resetLabel ? syncDraftLabel(next) : next
  }

  if (isHatchMarker(type)) {
    return {
      ...base,
      label: resetLabel ? defaultLabelForType(type) : base.label,
      size: markerSize(draft),
    }
  }

  if (type === 'text-label') {
    return {
      ...base,
      label: resetLabel ? defaultLabelForType(type) : base.label,
      size: markerSize(draft),
      rotation: markerRotation(draft),
    }
  }

  return resetLabel
    ? {
        ...base,
        label: defaultLabelForType(type),
      }
    : base
}

function draftBaseForType(draft: DraftMarker, type: MarkerType): DraftMarker {
  return {
    mapId: draft.mapId,
    floorId: draft.floorId,
    type,
    label: draft.label,
    x: draft.x,
    y: draft.y,
    size: markerSize(draft),
    rotation: draft.rotation ?? 0,
  }
}

function draftWithToolDefaults(draft: DraftMarker, tool: MarkerToolDefinition, resetLabel = true): DraftMarker {
  const nextDraft = draftWithTypeDefaults(draft, tool.type, resetLabel)

  if (tool.direction) {
    const draftWithDirection = {
      ...nextDraft,
      direction: tool.direction,
    }

    return resetLabel ? syncDraftLabel(draftWithDirection) : draftWithDirection
  }

  return nextDraft
}

function syncDraftLabel(draft: DraftMarker): DraftMarker {
  if (draft.type === 'bomb') {
    return {
      ...draft,
      label: `Bomb ${formatBombMarker(draft)}`,
    }
  }

  if (draft.type === 'spawn') {
    const spawnName = draft.spawnName?.trim() || 'Main Gate'

    return {
      ...draft,
      label: formatSpawnMarker({ ...draft, spawnName }),
      spawnName,
    }
  }

  if (draft.type === 'vertical-route') {
    return {
      ...draft,
      label: `Vertical route ${draft.direction ?? 'up'}`,
    }
  }

  return draft
}

function draftPreviewForTool(tool: MarkerToolDefinition): MarkerGlyphData {
  return draftWithToolDefaults(
    {
      mapId: 'preview',
      floorId: '1f',
      type: tool.type,
      label: tool.defaultLabel,
      x: 0,
      y: 0,
    },
    tool,
  )
}

function markerToolLabelKey(marker: MarkerGlyphData) {
  return (
    MARKER_TOOLS.find(
      (tool) =>
        tool.type === marker.type &&
        (tool.type !== 'vertical-route' || !tool.direction || tool.direction === (marker.direction ?? 'up')),
    )?.labelKey ?? 'type'
  )
}

function formatMarkerDisplayLabel(
  marker: MarkerGlyphData,
  fallback = marker.label ?? marker.type,
  t?: (key: string) => string,
) {
  if (marker.type === 'bomb') {
    return formatBombMarker(marker)
  }

  if (marker.type === 'spawn') {
    return formatSpawnMarker(marker)
  }

  if (marker.type === 'vertical-route') {
    return t ? `${t('markerTypeVerticalRoute')} ${directionLabel(marker.direction, t)}` : `Vertical route ${marker.direction ?? 'up'}`
  }

  return fallback
}

function formatBombMarker(marker: MarkerGlyphData) {
  return `${marker.siteNumber ?? 1}${marker.siteLetter ?? 'A'}`
}

function formatSpawnMarker(marker: MarkerGlyphData) {
  const spawnName = marker.spawnName?.trim() || marker.label?.replace(/^\d+\s*-\s*/, '').trim() || 'Spawn'

  return `${marker.spawnNumber ?? 1} - ${spawnName}`
}

function directionIconFile(direction?: MarkerDirection) {
  return direction === 'down' ? DIRECTION_ICON_FILES.down : DIRECTION_ICON_FILES.up
}

function directionLabel(direction: MarkerDirection | undefined, t: (key: string) => string) {
  return direction === 'down' ? t('directionDown') : t('directionUp')
}

function isHatchMarker(type: MarkerType) {
  return type === 'ceiling-hatch' || type === 'floor-hatch'
}

function positiveIntegerFromInput(value: string, fallback: number) {
  const parsed = Number(value)

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function normalizedSizeFromInput(value: string, fallback: number) {
  const parsed = Number(value)

  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.round(Math.min(2.5, Math.max(0.5, parsed)) * 10) / 10
}

function normalizedRotationFromInput(value: string, fallback: number) {
  const parsed = Number(value)

  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.round(Math.min(180, Math.max(-180, parsed)))
}

function markerSize(marker: Pick<CommunityMarker, 'size'>) {
  return marker.size ?? 1
}

function markerHitRadius(marker: Pick<CommunityMarker, 'size'>) {
  return Math.round(Math.max(14, 14 * markerSize(marker)) * 10) / 10
}

function markerRotation(marker: Pick<CommunityMarker, 'rotation'>) {
  return marker.rotation ?? 0
}

function defaultLabelForType(type: MarkerType) {
  return MARKER_DEFAULT_LABELS.get(type) ?? 'New community marker'
}

export default App
