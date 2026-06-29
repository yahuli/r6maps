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
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  XCircle,
} from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { loadCommunityMarkers } from './lib/communityMarkers'
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
import {
  DEFAULT_SPLIT_VIEW,
  beginReferenceClick,
  buildViewerHash,
  clampViewerTransform,
  getPingMarkerRadius,
  getPingOtherFloorDirection,
  getPanelFloorIds,
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
type ToolDragState = { type: MarkerType; pointerId: number }
type DraftAction = 'add' | 'delete' | 'update'
type AppRoute = { kind: 'viewer' } | { kind: 'proposal-list' } | { kind: 'proposal-detail'; number: number }
type ProposalListState =
  | { status: 'idle' | 'loading' | 'unavailable' }
  | { status: 'ready'; proposals: ProposalSummary[] }
  | { status: 'error'; message: string }
type ProposalDetailState =
  | { status: 'idle' | 'loading' | 'unavailable' }
  | { status: 'ready'; detail: ProposalDetail }
  | { status: 'error'; message: string }

const MARKER_TOOLS: Array<{ type: MarkerType; labelKey: string }> = [
  { type: 'camera', labelKey: 'markerTypeCamera' },
  { type: 'ceiling-hatch', labelKey: 'markerTypeCeilingHatch' },
  { type: 'text-label', labelKey: 'markerTypeTextLabel' },
  { type: 'bomb', labelKey: 'markerTypeBomb' },
  { type: 'spawn', labelKey: 'markerTypeSpawn' },
  { type: 'skylight', labelKey: 'markerTypeSkylight' },
  { type: 'vertical-route', labelKey: 'markerTypeVerticalRoute' },
  { type: 'ladder', labelKey: 'markerTypeLadder' },
]

const MARKER_ICON_FILES = {
  camera: 'security-camera.png',
  'ceiling-hatch': 'ceiling-hatch.png',
  skylight: 'skylight@2x.png',
  up: 'up@2x.png',
  down: 'down@2x.png',
  ladder: 'ladder@2x.png',
} as const

const DEFAULT_GITHUB_REPOSITORY = 'yahuli/r6maps'
const COMMUNITY_DATA_ISSUE_LABEL = 'community-data'
const PENDING_SUBMISSION_KEY = 'r6maps.pendingSubmissionPayload'

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
  const [splitView, setSplitView] = useState(DEFAULT_SPLIT_VIEW)
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
  const [draftTranslationValue, setDraftTranslationValue] = useState(() => getDefaultDraftTranslation(getInitialLocale()))
  const [draftAction, setDraftAction] = useState<DraftAction>('add')
  const [pendingAddDraft, setPendingAddDraft] = useState<DraftMarker | null>(null)
  const [pendingDeleteMarkerIds, setPendingDeleteMarkerIds] = useState<string[]>([])
  const [updatingMarkerId, setUpdatingMarkerId] = useState<string | null>(null)
  const [pendingMarkerUpdates, setPendingMarkerUpdates] = useState<Record<string, DraftMarker>>({})
  const [draggingDraft, setDraggingDraft] = useState(false)
  const [draggingTool, setDraggingTool] = useState<ToolDragState | null>(null)
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
    setDraftAction('add')
    setPendingAddDraft(null)
    setPendingDeleteMarkerIds([])
    setUpdatingMarkerId(null)
    setPendingMarkerUpdates({})
    setSubmitPayloadPreview('')

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
  const panelFloorIds = useMemo(
    () => (selectedMap && selectedFloor ? getPanelFloorIds(selectedMap.floors, selectedFloor.id, splitView) : []),
    [selectedFloor, selectedMap, splitView],
  )
  const isSplitLayout = splitView && panelFloorIds.length > 1
  const pendingDeleteMarkerIdSet = useMemo(() => new Set(pendingDeleteMarkerIds), [pendingDeleteMarkerIds])
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
      markersWithPendingUpdates.filter(
        (marker) =>
          marker.mapId === selectedMap?.id &&
          panelFloorIds.includes(marker.floorId) &&
          !pendingDeleteMarkerIdSet.has(marker.id) &&
          (showCommunityLayer || marker.source !== 'community'),
      ),
    [markersWithPendingUpdates, panelFloorIds, pendingDeleteMarkerIdSet, selectedMap?.id, showCommunityLayer],
  )
  const selectedMarker = visibleMarkers.find((marker) => marker.id === selectedMarkerId) ?? visibleMarkers[0]
  const sourceLabel =
    selectedMap?.source.provider === 'r6maps-legacy' ? t('sourceLegacy') : t('sourceOfficial')
  const normalizedDraft = normalizeDraftForPatch(draft)
  const pendingAddDraftForPatch = draftAction === 'add' && pendingAddDraft ? normalizedDraft : pendingAddDraft
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
  const pendingAddCount = pendingAddDraftForPatch ? 1 : 0
  const pendingUpdateCount = pendingUpdateEntries.length
  const pendingDeleteCount = pendingDeleteMarkerIds.length
  const hasPendingChanges = pendingAddCount + pendingUpdateCount + pendingDeleteCount > 0
  const prPatch =
    dataLoaded && hasPendingChanges
      ? buildChangeSetPatch({
          addDraft: pendingAddDraftForPatch ?? undefined,
          updates: pendingUpdateEntries.map(([markerId, pendingDraft]) => ({ markerId, draft: pendingDraft })),
          deleteMarkerIds: pendingDeleteMarkerIds,
          markers,
          translations,
          options: {
            locale: draftTranslationLocale,
            localizedLabel: draftAction === 'add' ? draftTranslationValue : undefined,
            localizedLabelsByMarkerId:
              draftAction === 'update' && updatingMarkerId && draftTranslationValue.trim()
                ? { [updatingMarkerId]: draftTranslationValue }
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

    if (draftAction === 'delete' && pendingDeleteMarkerIds.length === 0) {
      setDraftAction('add')
    }
    if (draftAction === 'update' && updatingMarkerId && !markers.some((marker) => marker.id === updatingMarkerId)) {
      setDraftAction('add')
      setUpdatingMarkerId(null)
    }
  }, [dataLoaded, draftAction, markers, pendingDeleteMarkerIds.length, updatingMarkerId])

  function handleMapSelect(mapId: string) {
    const nextMap = maps.find((map) => map.id === mapId)
    setSelectedMapId(mapId)
    setSelectedFloorId(nextMap?.floors.find((floor) => floor.id === '1f')?.id ?? nextMap?.floors[0]?.id ?? '1f')
    setSelectedMarkerId('')
    setDraftAction('add')
    setPendingAddDraft(null)
    setPendingDeleteMarkerIds([])
    setUpdatingMarkerId(null)
    setPendingMarkerUpdates({})
    setSubmitPayloadPreview('')
    resetViewerTransform()
  }

  function handleFloorSelect(floorId: string) {
    setSelectedFloorId(floorId)
    setSelectedMarkerId('')
    setDraftAction('add')
    setPendingAddDraft(null)
    setPendingDeleteMarkerIds([])
    setUpdatingMarkerId(null)
    setPendingMarkerUpdates({})
    setSubmitPayloadPreview('')
  }

  function handleLocaleChange(locale: string) {
    setSelectedLocale(locale)
    setDraftTranslationLocale(locale)
    setDraftTranslationValue(getDefaultDraftTranslation(locale))
    try {
      localStorage.setItem('r6maps-locale', locale)
    } catch {
      // Browsers can disable storage; the selector still works for this session.
    }
  }

  function updateDraftAtCoordinate(mapId: string, floorId: string, x: number, y: number, type?: MarkerType) {
    setDraft((current) => {
      const nextDraft = draftAtCoordinate(current, mapId, floorId, x, y, type)

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
      setPendingAddDraft(normalizeDraftForPatch(nextDraft))
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

    const existingDraft = pendingMarkerUpdates[marker.id] ?? draftFromCommunityMarker(marker)
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
    if (draftAction === 'add' && pendingAddDraft) {
      setPendingAddDraft(normalizedDraft)
    }
    setSelectedMarkerId(marker.id)
    setDraftAction('update')
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
      setPendingAddDraft(normalizeDraftForPatch(draftRef.current))
    }
    setDraggingDraft(false)
  }

  function deleteSelectedMarker() {
    if (!selectedMarker) {
      return
    }

    if (draftAction === 'add' && pendingAddDraft) {
      setPendingAddDraft(normalizedDraft)
    }
    setDraftAction('delete')
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
          <div className="brand-mark">R6</div>
          <div>
            <h1>R6Maps</h1>
            <p>{isProposalListRoute ? t('proposals') : isProposalDetailRoute ? t('proposalPreview') : canEdit ? t('editInformation') : t('viewMode')}</p>
          </div>
        </div>

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
              className={splitView ? 'segmented selected' : 'segmented'}
              type="button"
              onClick={() => setSplitView((current) => !current)}
            >
              {splitView ? t('splitView') : t('singleView')}
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
            !canEdit && (
              <a className="primary-button secondary-button" href="#/proposals">
                <GitPullRequestArrow size={17} />
                {t('proposals')}
              </a>
            )
          )}
          {!isProposalRoute && !canEdit && !isCompact && (
            <button className="primary-button" type="button" onClick={() => setEditMode(true)}>
              <Pencil size={17} />
              {t('githubEdit')}
            </button>
          )}
          {!isProposalRoute && canEdit && (
            <button className="primary-button" type="button" onClick={() => setEditMode(false)}>
              <Eye size={17} />
              {t('viewMode')}
            </button>
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
              const hiddenMarkerId = draftAction === 'update' && !draggingDraft ? updatingMarkerId : null
              const ghostedMarkerId = draftAction === 'update' && draggingDraft ? updatingMarkerId : null
              const paneMarkers = visibleMarkers.filter(
                (marker) => marker.floorId === floorId && marker.id !== hiddenMarkerId,
              )

              return (
                <MapPane
                  canEdit={canEdit}
                  draft={normalizedDraft}
                  draggingDraft={draggingDraft}
                  floor={floor}
                  floorName={floor ? localizeFloorName(floor, selectedLocale, translations) : undefined}
                  ghostedMarkerId={ghostedMarkerId}
                  isSelectedFloor={floor?.id === selectedFloor?.id}
                  key={floorId}
                  mapId={selectedMap?.id ?? ''}
                  markers={paneMarkers}
                  referencePoint={referencePoint}
                  selectedMarkerId={selectedMarker?.id}
                  showOfficialLayer={showOfficialLayer}
                  t={t}
                  transform={viewerTransform}
                  activeToolPointerId={draggingTool?.pointerId ?? null}
                  activeToolType={draggingTool?.type ?? null}
                  onDraftDragMove={moveDraft}
                  onDraftDragStart={startDraftDrag}
                  onDraftDragStop={stopDraftDrag}
                  onDraftLabelChange={(label) => setDraft((current) => ({ ...current, label }))}
                  onDropTool={(type, mapId, droppedFloorId, x, y) => {
                    const nextDraft = draftAtCoordinate(draftRef.current, mapId, droppedFloorId, x, y, type)

                    setDraftAction('add')
                    setUpdatingMarkerId(null)
                    setPendingAddDraft(normalizeDraftForPatch(nextDraft))
                    setSubmitPayloadPreview('')
                    draftRef.current = nextDraft
                    setDraft(nextDraft)
                  }}
                  onMarkerSelect={setSelectedMarkerId}
                  onMarkerDragStart={startMarkerDrag}
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

          <div className="status-strip">
            <span>{selectedMapName || 'Loading maps'}</span>
            <span>{selectedFloor ? localizeFloorName(selectedFloor, selectedLocale, translations) : t('noFloorSelected')}</span>
            <span>{sourceLabel}</span>
            <span>
              {visibleMarkers.length} {t('visibleMarkers')}
            </span>
            <span>{t('coordinates')}</span>
          </div>
        </section>

        {canEdit && (
          <aside className="inspector" aria-label="Edit inspector">
            <section className="panel">
              <div className="panel-title">
                <Eye size={16} />
                {t('layers')}
              </div>
              <Toggle checked={showOfficialLayer} label={t('officialBlueprintLayer')} onChange={setShowOfficialLayer} />
              <Toggle checked={showCommunityLayer} label={t('communityMarkers')} onChange={setShowCommunityLayer} />
            </section>

            <section className="panel">
              <div className="panel-title">
                <MousePointer2 size={16} />
                {t('selectedMarker')}
              </div>
              {selectedMarker ? (
                <div className="marker-detail">
                  <span className={`marker-badge ${selectedMarker.type}`}>{selectedMarker.type}</span>
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
                      <dd>
                        {selectedMarker.x.toFixed(3)}, {selectedMarker.y.toFixed(3)}
                      </dd>
                    </div>
                    {selectedMarker.type === 'bomb' && (
                      <div>
                        <dt>{t('site')}</dt>
                        <dd>{formatBombMarker(selectedMarker)}</dd>
                      </div>
                    )}
                    {selectedMarker.type === 'spawn' && (
                      <div>
                        <dt>{t('spawn')}</dt>
                        <dd>{formatSpawnMarker(selectedMarker)}</dd>
                      </div>
                    )}
                    {(selectedMarker.type === 'vertical-route' || selectedMarker.type === 'ladder') && (
                      <div>
                        <dt>{t('direction')}</dt>
                        <dd>{directionLabel(selectedMarker.direction, t)}</dd>
                      </div>
                    )}
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

            <section className="panel">
              <div className="panel-title">
                <GitPullRequestArrow size={16} />
                {t('draftPr')}
              </div>
              <label className="field">
                <span>{t('label')}</span>
                <input value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} />
              </label>
              <label className="field">
                <span>{t('type')}</span>
                <AnnotationToolbar
                  selectedType={draft.type}
                  onSelect={(type) => setDraft((current) => draftWithTypeDefaults(current, type))}
                  onToolDragStart={(type, pointerId) => setDraggingTool({ type, pointerId })}
                  onToolDragEnd={(pointerId) =>
                    setDraggingTool((current) => (pointerId == null || current?.pointerId === pointerId ? null : current))
                  }
                  t={t}
                />
              </label>
              <MarkerMetadataFields draft={draft} t={t} onChange={(nextDraft) => setDraft(syncDraftLabel(nextDraft))} />
              <label className="field">
                <span>{t('translationLocale')}</span>
                <select
                  value={draftTranslationLocale}
                  onChange={(event) => {
                    setDraftTranslationLocale(event.target.value)
                    setDraftTranslationValue(getDefaultDraftTranslation(event.target.value))
                  }}
                >
                  {languageOptions.map((locale) => (
                    <option key={locale.id} value={locale.id}>
                      {locale.nativeName}
                    </option>
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
              <button
                className="primary-button patch-copy-button"
                type="button"
                disabled={!canSubmitChanges || submitting}
                onClick={submitChanges}
              >
                <GitPullRequestArrow size={17} />
                {submitting ? t('submittingChanges') : copied ? t('copiedPatch') : t('submitChanges')}
              </button>
              {submissionNotice && (
                <p className="patch-preview-hint">
                  {createdPullRequestUrl ? (
                    <a href={createdPullRequestUrl} rel="noreferrer" target="_blank">
                      {submissionNotice}
                    </a>
                  ) : (
                    submissionNotice
                  )}
                </p>
              )}
              <pre className="patch-preview">
                {prPatch
                  ? JSON.stringify(summarizePatchForPreview(prPatch), null, 2)
                  : dataLoaded
                    ? t('noPatchQueued')
                    : t('loadingRepositoryData')}
              </pre>
              {submitPayloadPreview && (
                <>
                  <p className="patch-preview-hint">{t('manualPayloadCopyHint')}</p>
                  <pre className="patch-preview">{submitPayloadPreview}</pre>
                </>
              )}
              <div
                className={
                  pendingDeleteCount > 0 ? 'patch-mode delete' : pendingUpdateCount > 0 ? 'patch-mode update' : 'patch-mode'
                }
              >
                {hasPendingChanges ? pendingChangeSummary : t('noPatchQueued')}
              </div>
            </section>

            <section className="panel">
              <div className="panel-title">
                <FileJson size={16} />
                {t('repositoryData')}
              </div>
              <div className="repo-tree">
                <span>public/data/official/maps.json</span>
                <span>public/data/community/markers/index.json</span>
                <span>public/data/community/markers/{'{mapId}'}.json</span>
              </div>
            </section>
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
                activeToolType={null}
                canEdit={false}
                draft={previewDraft}
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
  activeToolType,
  canEdit,
  draft,
  draggingDraft,
  floor,
  floorName,
  ghostedMarkerId,
  getMarkerLabel,
  getMarkerDiffKind,
  isSelectedFloor,
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
  activeToolType: MarkerType | null
  canEdit: boolean
  draft: DraftMarker
  draggingDraft: boolean
  floor?: { id: string; name: string; image?: string; sort: number }
  floorName?: string
  ghostedMarkerId: string | null
  getMarkerLabel: (marker: CommunityMarker) => string
  getMarkerDiffKind?: (marker: CommunityMarker) => ProposalMarkerDiffKind | undefined
  isSelectedFloor: boolean
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
  onDropTool: (type: MarkerType, mapId: string, floorId: string, x: number, y: number) => void
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

  const showDraft = canEdit && floor && draft.mapId === mapId && draft.floorId === floor.id
  const displayFloorName = floorName ?? t('noFloorSelected')

  return (
    <article className="map-pane" aria-label={displayFloorName}>
      <div className={isSelectedFloor ? 'pane-title selected' : 'pane-title'}>{displayFloorName}</div>
      <svg
        className="blueprint"
        viewBox="0 0 1000 620"
        role="img"
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

          const markerType = event.dataTransfer.getData('application/x-r6maps-marker-type') as MarkerType
          if (!markerType) {
            return
          }

          event.preventDefault()
          const point = coordinateFromClient(event.clientX, event.clientY)
          onDropTool(markerType, mapId, floor.id, point.x, point.y)
          onToolDragEnd()
        }}
        onPointerDown={(event) => {
          referenceClickCandidate.current =
            floor && !activeToolType && !draggingDraft && !isReferenceBlockedTarget(event.target)
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
          const blocked = !floor || Boolean(activeToolType) || draggingDraft || isReferenceBlockedTarget(event.target)
          const candidate = referenceClickCandidate.current
          referenceClickCandidate.current = null
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
          if (!canEdit || !floor || !activeToolType || activeToolPointerId !== event.pointerId) {
            return
          }

          const point = coordinateFromClient(event.clientX, event.clientY)
          onDropTool(activeToolType, mapId, floor.id, point.x, point.y)
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
          {showDraft && (
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
                <g transform={`rotate(${textLabelRotation(draft)}) scale(${textLabelSize(draft)})`}>
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
                  <circle r={draft.type === 'ceiling-hatch' ? 14 * (draft.size ?? 1) : 14} />
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
  selectedType,
  onSelect,
  t,
}: {
  onToolDragEnd?: (pointerId?: number) => void
  onToolDragStart?: (type: MarkerType, pointerId: number) => void
  selectedType: MarkerType
  onSelect: (type: MarkerType) => void
  t: (key: string) => string
}) {
  return (
    <div className="annotation-toolbar" role="toolbar" aria-label="Annotation tools">
      {MARKER_TOOLS.map((tool) => {
        const label = t(tool.labelKey)

        return (
          <button
            aria-pressed={selectedType === tool.type}
            className={selectedType === tool.type ? 'annotation-tool selected' : 'annotation-tool'}
            draggable
            key={tool.type}
            title={label}
            type="button"
            onClick={() => onSelect(tool.type)}
            onPointerDown={(event) => {
              if (event.button === 0) {
                onToolDragStart?.(tool.type, event.pointerId)
              }
            }}
            onPointerUp={(event) => onToolDragEnd?.(event.pointerId)}
            onPointerCancel={(event) => onToolDragEnd?.(event.pointerId)}
            onDragEnd={() => onToolDragEnd?.()}
            onDragStart={(event) => {
              event.dataTransfer.setData('application/x-r6maps-marker-type', tool.type)
              event.dataTransfer.effectAllowed = 'copy'
            }}
          >
            <svg viewBox="-18 -18 36 36" aria-hidden="true">
              <MarkerSymbol compact marker={draftPreviewForType(tool.type)} />
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
  if (draft.type === 'bomb') {
    return (
      <div className="metadata-grid">
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
      </div>
    )
  }

  if (draft.type === 'spawn') {
    return (
      <div className="metadata-grid">
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
      </div>
    )
  }

  if (draft.type === 'vertical-route' || draft.type === 'ladder') {
    return (
      <label className="field">
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
    )
  }

  if (draft.type === 'ceiling-hatch') {
    return (
      <div className="metadata-grid hatch-size-grid">
        <label className="field compact-field wide-field">
          <span>{t('hatchSize')}</span>
          <input
            max="2.5"
            min="0.5"
            step="0.1"
            type="range"
            value={draft.size ?? 1}
            onChange={(event) =>
              onChange({
                ...draft,
                size: normalizedSizeFromInput(event.target.value, draft.size ?? 1),
              })
            }
          />
        </label>
        <label className="field compact-field">
          <span>{t('hatchSize')}</span>
          <input
            max="2.5"
            min="0.5"
            step="0.1"
            type="number"
            value={draft.size ?? 1}
            onChange={(event) =>
              onChange({
                ...draft,
                size: normalizedSizeFromInput(event.target.value, draft.size ?? 1),
              })
            }
          />
        </label>
      </div>
    )
  }

  if (draft.type === 'text-label') {
    return (
      <div className="metadata-grid text-label-controls">
        <label className="field compact-field wide-field">
          <span>{t('textLabelSize')}</span>
          <input
            max="2.5"
            min="0.5"
            step="0.1"
            type="range"
            value={textLabelSize(draft)}
            onChange={(event) =>
              onChange({
                ...draft,
                size: normalizedSizeFromInput(event.target.value, textLabelSize(draft)),
              })
            }
          />
        </label>
        <label className="field compact-field">
          <span>{t('textLabelSize')}</span>
          <input
            max="2.5"
            min="0.5"
            step="0.1"
            type="number"
            value={textLabelSize(draft)}
            onChange={(event) =>
              onChange({
                ...draft,
                size: normalizedSizeFromInput(event.target.value, textLabelSize(draft)),
              })
            }
          />
        </label>
        <label className="field compact-field wide-field">
          <span>{t('textLabelRotation')}</span>
          <input
            max="180"
            min="-180"
            step="1"
            type="range"
            value={textLabelRotation(draft)}
            onChange={(event) =>
              onChange({
                ...draft,
                rotation: normalizedRotationFromInput(event.target.value, textLabelRotation(draft)),
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
            value={textLabelRotation(draft)}
            onChange={(event) =>
              onChange({
                ...draft,
                rotation: normalizedRotationFromInput(event.target.value, textLabelRotation(draft)),
              })
            }
          />
        </label>
      </div>
    )
  }

  return null
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
        preserveAspectRatio="xMidYMid meet"
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
  const markerRadius = marker.type === 'ceiling-hatch' ? 13 * (marker.size ?? 1) : 13
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
      <circle r={markerRadius} />
      <MarkerSymbol marker={marker} />
      <foreignObject className="marker-popover-shell" x="18" y="-31" width="190" height="62">
        <div className="marker-popover">{displayLabel}</div>
      </foreignObject>
    </g>
  )
}

function TextLabelTransform({ children, marker }: { children: ReactNode; marker: MarkerGlyphData }) {
  return <g transform={`rotate(${textLabelRotation(marker)}) scale(${textLabelSize(marker)})`}>{children}</g>
}

function MarkerSymbol({ marker, compact = false }: { marker: MarkerGlyphData; compact?: boolean }) {
  const iconSize = compact ? 24 : 26
  const iconOffset = -iconSize / 2

  if (marker.type === 'camera') {
    return <MarkerIcon file={MARKER_ICON_FILES.camera} offset={iconOffset} size={iconSize} />
  }

  if (marker.type === 'ceiling-hatch') {
    const hatchSize = compact ? iconSize : iconSize * (marker.size ?? 1)

    return <MarkerIcon file={MARKER_ICON_FILES['ceiling-hatch']} offset={-hatchSize / 2} size={hatchSize} />
  }

  if (marker.type === 'skylight') {
    return <MarkerIcon file={MARKER_ICON_FILES.skylight} offset={iconOffset} size={iconSize} />
  }

  if (marker.type === 'vertical-route') {
    return <MarkerIcon file={directionIconFile(marker.direction)} offset={iconOffset} size={iconSize} />
  }

  if (marker.type === 'ladder') {
    return (
      <g className="marker-symbol ladder-symbol">
        <MarkerIcon file={MARKER_ICON_FILES.ladder} offset={-13} size={26} />
        <MarkerIcon className="direction-cue" file={directionIconFile(marker.direction)} offset={2} size={12} />
      </g>
    )
  }

  if (marker.type === 'bomb') {
    return (
      <g className="marker-symbol badge-symbol bomb-symbol">
        <rect x="-15" y="-10" width="30" height="20" rx="8" />
        <text y="4">{formatBombMarker(marker)}</text>
      </g>
    )
  }

  if (marker.type === 'text-label') {
    return (
      <g className="marker-symbol badge-symbol text-label-symbol">
        <rect x="-15" y="-10" width="30" height="20" rx="7" />
        <text y="4">Aa</text>
      </g>
    )
  }

  return (
    <g className="marker-symbol badge-symbol spawn-symbol">
      <rect x="-13" y="-10" width="26" height="20" rx="8" />
      <text y="4">{marker.spawnNumber ?? 1}</text>
    </g>
  )
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

function getDefaultDraftTranslation(locale: string) {
  if (locale === 'zh-CN') {
    return '保险库舱口'
  }
  if (locale === 'ja-JP') {
    return '金庫ハッチ'
  }
  if (locale === 'ko-KR') {
    return '금고 해치'
  }

  return ''
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
  if (draft.type === 'bomb') {
    return {
      siteNumber: draft.siteNumber,
      siteLetter: draft.siteLetter,
    }
  }

  if (draft.type === 'spawn') {
    return {
      spawnNumber: draft.spawnNumber,
      spawnName: draft.spawnName,
    }
  }

  if (draft.type === 'vertical-route' || draft.type === 'ladder') {
    return {
      direction: draft.direction,
    }
  }

  if (draft.type === 'ceiling-hatch') {
    return draft.size !== undefined && draft.size !== 1 ? { size: draft.size } : {}
  }

  if (draft.type === 'text-label') {
    return {
      ...(draft.size !== undefined && draft.size !== 1 ? { size: draft.size } : {}),
      ...(draft.rotation !== undefined && draft.rotation !== 0 ? { rotation: draft.rotation } : {}),
    }
  }

  return {}
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
  type?: MarkerType,
): DraftMarker {
  return {
    ...(type ? draftWithTypeDefaults(draft, type) : draft),
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

  if (type === 'vertical-route' || type === 'ladder') {
    const next = {
      ...base,
      direction: draft.direction ?? 'up',
    } satisfies DraftMarker

    return resetLabel ? syncDraftLabel(next) : next
  }

  if (type === 'ceiling-hatch') {
    return {
      ...base,
      label: resetLabel ? defaultLabelForType(type) : base.label,
      size: draft.type === 'ceiling-hatch' ? (draft.size ?? 1) : 1,
    }
  }

  if (type === 'text-label') {
    return {
      ...base,
      label: resetLabel ? defaultLabelForType(type) : base.label,
      size: draft.type === 'text-label' ? textLabelSize(draft) : 1,
      rotation: draft.type === 'text-label' ? textLabelRotation(draft) : 0,
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
  }
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

  if (draft.type === 'ladder') {
    return {
      ...draft,
      label: `Ladder ${draft.direction ?? 'up'}`,
    }
  }

  return draft
}

function draftPreviewForType(type: MarkerType): MarkerGlyphData {
  return draftWithTypeDefaults(
    {
      mapId: 'preview',
      floorId: '1f',
      type,
      label: defaultLabelForType(type),
      x: 0,
      y: 0,
    },
    type,
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

  if (marker.type === 'ladder') {
    return t ? `${t('markerTypeLadder')} ${directionLabel(marker.direction, t)}` : `Ladder ${marker.direction ?? 'up'}`
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
  return direction === 'down' ? MARKER_ICON_FILES.down : MARKER_ICON_FILES.up
}

function directionLabel(direction: MarkerDirection | undefined, t: (key: string) => string) {
  return direction === 'down' ? t('directionDown') : t('directionUp')
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

function textLabelSize(marker: Pick<CommunityMarker, 'size'>) {
  return marker.size ?? 1
}

function textLabelRotation(marker: Pick<CommunityMarker, 'rotation'>) {
  return marker.rotation ?? 0
}

function defaultLabelForType(type: MarkerType) {
  if (type === 'camera') {
    return 'Security camera'
  }

  if (type === 'ceiling-hatch') {
    return 'Ceiling hatch'
  }

  if (type === 'text-label') {
    return 'Area label'
  }

  if (type === 'skylight') {
    return 'Skylight'
  }

  if (type === 'vertical-route') {
    return 'Vertical route up'
  }

  if (type === 'ladder') {
    return 'Ladder up'
  }

  if (type === 'bomb') {
    return 'Bomb 1A'
  }

  return '1 - Main Gate'
}

export default App
