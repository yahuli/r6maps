const SESSION_COOKIE = 'r6maps_session'
const STATE_COOKIE = 'r6maps_oauth_state'
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60
const GITHUB_API_BASE = 'https://api.github.com'
const LABELS = [
  { name: 'community-data', color: '2f80ed', description: 'Community-submitted map data change' },
  { name: 'risk-low', color: '0e8a16', description: 'Low-risk community data change' },
  { name: 'risk-medium', color: 'fbca04', description: 'Medium-risk community data change' },
]
const MARKER_TYPES = new Set(['camera', 'ceiling-hatch', 'text-label', 'spawn', 'skylight', 'vertical-route', 'ladder', 'bomb'])
const MARKER_STATUSES = new Set(['published', 'proposed', 'deprecated'])
const MARKER_FIELDS = new Set([
  'id',
  'mapId',
  'floorId',
  'type',
  'label',
  'x',
  'y',
  'siteNumber',
  'siteLetter',
  'spawnNumber',
  'spawnName',
  'direction',
  'size',
  'rotation',
  'source',
  'status',
])
const MAX_MARKER_OPERATION_COUNT = 25
const LOW_RISK_MARKER_OPERATION_COUNT = 5

export default {
  async fetch(request, env) {
    try {
      return await routeRequest(request, env)
    } catch (error) {
      console.error(error)

      if (error instanceof ApiError) {
        return jsonResponse({ error: error.message }, error.status, corsHeaders(request, env))
      }

      return jsonResponse({ error: 'Internal server error' }, 500, corsHeaders(request, env))
    }
  },
}

async function routeRequest(request, env) {
  const url = new URL(request.url)

  if (request.method === 'OPTIONS') {
    return handleOptions(request, env)
  }

  if (request.method === 'GET' && url.pathname === '/api/auth/login') {
    return handleLogin(request, env)
  }

  if (request.method === 'GET' && url.pathname === '/api/auth/callback') {
    return handleCallback(request, env)
  }

  if (request.method === 'GET' && url.pathname === '/api/me') {
    const session = await readSession(request, env)
    return jsonResponse(session ? { authenticated: true, user: session.user } : { authenticated: false }, 200, corsHeaders(request, env))
  }

  if (request.method === 'POST' && url.pathname === '/api/submissions') {
    return handleSubmission(request, env)
  }

  return jsonResponse({ error: 'Not found' }, 404, corsHeaders(request, env))
}

function handleOptions(request, env) {
  const headers = corsHeaders(request, env)

  if (!headers.has('Access-Control-Allow-Origin') && request.headers.get('Origin')) {
    return new Response(null, { status: 403 })
  }

  return new Response(null, { status: 204, headers })
}

async function handleLogin(request, env) {
  requireEnv(env, ['GITHUB_OAUTH_CLIENT_ID', 'SESSION_SECRET'])

  const requestUrl = new URL(request.url)
  const returnTo = allowedReturnTo(requestUrl.searchParams.get('returnTo'), env)
  const state = crypto.randomUUID()
  const redirectUri = `${requestUrl.origin}/api/auth/callback`
  const stateCookie = await signedCookieValue(
    {
      state,
      returnTo,
      redirectUri,
      exp: Math.floor(Date.now() / 1000) + 10 * 60,
    },
    env,
  )
  const authorizeUrl = new URL('https://github.com/login/oauth/authorize')
  authorizeUrl.searchParams.set('client_id', env.GITHUB_OAUTH_CLIENT_ID)
  authorizeUrl.searchParams.set('redirect_uri', redirectUri)
  authorizeUrl.searchParams.set('state', state)
  authorizeUrl.searchParams.set('scope', '')

  return redirectResponse(authorizeUrl.toString(), {
    'Set-Cookie': serializeCookie(STATE_COOKIE, stateCookie, 10 * 60),
  })
}

async function handleCallback(request, env) {
  requireEnv(env, ['GITHUB_OAUTH_CLIENT_ID', 'GITHUB_OAUTH_CLIENT_SECRET', 'SESSION_SECRET'])

  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const state = requestUrl.searchParams.get('state')
  const cookieState = await readSignedCookie(request, STATE_COOKIE, env)

  if (
    !code ||
    !state ||
    !cookieState ||
    cookieState.exp < Math.floor(Date.now() / 1000) ||
    cookieState.state !== state ||
    cookieState.redirectUri !== `${requestUrl.origin}/api/auth/callback`
  ) {
    throw new ApiError(401, 'Invalid OAuth state')
  }

  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'r6maps-worker',
    },
    body: JSON.stringify({
      client_id: env.GITHUB_OAUTH_CLIENT_ID,
      client_secret: env.GITHUB_OAUTH_CLIENT_SECRET,
      code,
      redirect_uri: cookieState.redirectUri,
    }),
  })

  if (!tokenResponse.ok) {
    throw new ApiError(502, 'GitHub OAuth token exchange failed')
  }

  const tokenPayload = await tokenResponse.json()
  if (!tokenPayload.access_token) {
    throw new ApiError(401, 'GitHub OAuth token was not issued')
  }

  const githubUser = await githubJson('/user', {
    token: tokenPayload.access_token,
  })
  const user = {
    id: githubUser.id,
    login: githubUser.login,
    avatar_url: githubUser.avatar_url,
    html_url: githubUser.html_url,
  }
  const session = await signedCookieValue(
    {
      user,
      exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
    },
    env,
  )

  return redirectResponse(cookieState.returnTo, {
    'Set-Cookie': [
      serializeCookie(SESSION_COOKIE, session, SESSION_MAX_AGE_SECONDS),
      clearCookie(STATE_COOKIE),
    ],
  })
}

async function handleSubmission(request, env) {
  requireEnv(env, [
    'GITHUB_APP_ID',
    'GITHUB_APP_PRIVATE_KEY',
    'GITHUB_INSTALLATION_ID',
    'GITHUB_OWNER',
    'GITHUB_REPO',
    'GITHUB_BASE_BRANCH',
    'SESSION_SECRET',
  ])

  const headers = corsHeaders(request, env)
  if (!headers.has('Access-Control-Allow-Origin')) {
    throw new ApiError(403, 'Origin is not allowed')
  }

  const session = await readSession(request, env)
  if (!session) {
    return jsonResponse({ loginUrl: loginUrlForRequest(request, env) }, 401, headers)
  }

  const payload = await parseJsonBody(request)
  const appToken = await createInstallationToken(env)
  const owner = env.GITHUB_OWNER
  const repo = env.GITHUB_REPO
  const baseBranch = env.GITHUB_BASE_BRANCH
  const baseRef = await githubJson(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(baseBranch)}`, { token: appToken })
  const baseCommit = await githubJson(`/repos/${owner}/${repo}/git/commits/${baseRef.object.sha}`, { token: appToken })
  const officialMaps = await readRepoJson(owner, repo, 'public/data/official/maps.json', baseBranch, appToken)
  const currentTranslations = await readRepoJson(owner, repo, 'public/data/community/translations.json', baseBranch, appToken)
  const validated = await validateSubmissionPayload(payload, {
    officialMaps,
    currentTranslations,
    owner,
    repo,
    baseBranch,
    appToken,
  })
  const branch = buildBranchName(validated.branch, session.user.login)
  const blobs = await Promise.all(
    validated.files.map(async (file) => {
      const blob = await githubJson(`/repos/${owner}/${repo}/git/blobs`, {
        method: 'POST',
        token: appToken,
        body: {
          content: file.content,
          encoding: 'utf-8',
        },
      })

      return {
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: blob.sha,
      }
    }),
  )
  const tree = await githubJson(`/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    token: appToken,
    body: {
      base_tree: baseCommit.tree.sha,
      tree: blobs,
    },
  })
  const commit = await githubJson(`/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    token: appToken,
    body: {
      message: validated.title,
      tree: tree.sha,
      parents: [baseCommit.sha],
    },
  })

  await githubJson(`/repos/${owner}/${repo}/git/refs`, {
    method: 'POST',
    token: appToken,
    body: {
      ref: `refs/heads/${branch}`,
      sha: commit.sha,
    },
  })

  const pullRequest = await githubJson(`/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    token: appToken,
    body: {
      title: validated.title,
      head: branch,
      base: baseBranch,
      body: buildPullRequestBody(validated, session.user),
    },
  })

  await ensureLabels(owner, repo, appToken)
  await githubJson(`/repos/${owner}/${repo}/issues/${pullRequest.number}/labels`, {
    method: 'POST',
    token: appToken,
    body: { labels: ['community-data', validated.risk.label] },
  })

  return jsonResponse(
    {
      pullRequest: {
        number: pullRequest.number,
        url: pullRequest.html_url,
      },
      branch,
    },
    201,
    headers,
  )
}

async function validateSubmissionPayload(payload, context) {
  if (!payload || payload.kind !== 'r6maps-community-change-set' || payload.version !== 1 || !payload.patch) {
    throw new ApiError(400, 'Invalid submission payload')
  }

  const patch = payload.patch
  if (!isSafeText(patch.title, 160) || !Array.isArray(patch.files) || patch.files.length === 0) {
    throw new ApiError(400, 'Invalid patch')
  }

  const mapFloors = new Map(context.officialMaps.map((map) => [map.id, new Set((map.floors ?? []).map((floor) => floor.id))]))
  const writes = []
  const writePaths = new Set()
  let translationsWrite = null
  let translationChanges = null
  const markerStats = createMarkerStats()
  const translationUpsertMarkerIds = new Set()
  const translationRemoveMarkerIds = new Set()

  for (const file of patch.files) {
    if (!file || typeof file.path !== 'string' || typeof file.action !== 'string') {
      throw new ApiError(400, 'Invalid file change')
    }

    if (file.action === 'replace') {
      const mapId = markerMapIdFromPath(file.path)
      if (!mapId || !mapFloors.has(mapId) || !Array.isArray(file.content)) {
        throw new ApiError(400, `Invalid marker file: ${file.path}`)
      }

      validateMarkerArray(file.content, mapId, mapFloors.get(mapId))
      const currentMarkers = await readCurrentMarkerFile(context, mapId)
      const diff = diffMarkerFile(currentMarkers, file.content, mapId)
      addMarkerDiff(markerStats, diff)
      for (const id of [...diff.addedIds, ...diff.updatedIds]) {
        translationUpsertMarkerIds.add(id)
      }
      for (const id of [...diff.deletedIds, ...diff.updatedIds]) {
        translationRemoveMarkerIds.add(id)
      }
      addWrite(writes, writePaths, file.path, `${JSON.stringify(file.content, null, 2)}\n`)
      continue
    }

    if (file.action === 'translation-changes' && file.path === 'public/data/community/translations.json') {
      if (translationChanges) {
        throw new ApiError(400, 'Duplicate translation change file')
      }

      translationChanges = file.changes
      continue
    }

    throw new ApiError(400, `Protected path or action is not allowed: ${file.path}`)
  }

  if (markerStats.total > MAX_MARKER_OPERATION_COUNT) {
    throw new ApiError(400, `Too many marker changes: ${markerStats.total} exceeds ${MAX_MARKER_OPERATION_COUNT}`)
  }
  if (markerStats.total === 0) {
    throw new ApiError(400, 'Submission must include marker changes')
  }

  if (translationChanges) {
    translationsWrite = applyTranslationChanges(
      context.currentTranslations,
      translationChanges,
      translationUpsertMarkerIds,
      translationRemoveMarkerIds,
    )
  }

  if (translationsWrite) {
    addWrite(writes, writePaths, 'public/data/community/translations.json', `${JSON.stringify(translationsWrite, null, 2)}\n`)
  }

  const risk = classifyRisk(markerStats)

  return {
    title: patch.title.trim(),
    branch: isSafeText(patch.branch, 120) ? patch.branch : patch.title,
    checklist: Array.isArray(patch.checklist) ? patch.checklist.filter((item) => isSafeText(item, 200)).slice(0, 12) : [],
    files: writes,
    markerStats,
    risk,
  }
}

function validateMarkerArray(markers, pathMapId, validFloorIds) {
  const ids = new Set()

  for (const marker of markers) {
    if (!marker || typeof marker !== 'object' || Array.isArray(marker)) {
      throw new ApiError(400, 'Marker must be an object')
    }

    for (const key of Object.keys(marker)) {
      if (!MARKER_FIELDS.has(key)) {
        throw new ApiError(400, `Marker has an unsupported field: ${key}`)
      }
    }

    if (!isSlug(marker.id, 140) || ids.has(marker.id)) {
      throw new ApiError(400, `Invalid or duplicate marker id: ${marker.id}`)
    }
    ids.add(marker.id)

    if (marker.mapId !== pathMapId || !validFloorIds.has(marker.floorId)) {
      throw new ApiError(400, `Marker references an unknown map or floor: ${marker.id}`)
    }

    if (!MARKER_TYPES.has(marker.type) || !isSafeText(marker.label, 140)) {
      throw new ApiError(400, `Marker has invalid type or label: ${marker.id}`)
    }

    if (!isCoordinate(marker.x) || !isCoordinate(marker.y)) {
      throw new ApiError(400, `Marker coordinates must be normalized: ${marker.id}`)
    }

    if (marker.source !== 'community' || !MARKER_STATUSES.has(marker.status)) {
      throw new ApiError(400, `Marker source or status is invalid: ${marker.id}`)
    }

    validateOptionalMarkerMetadata(marker)
  }
}

async function readCurrentMarkerFile(context, mapId) {
  const path = `public/data/community/markers/${mapId}.json`
  const markers = await readRepoJson(context.owner, context.repo, path, context.baseBranch, context.appToken)

  if (!Array.isArray(markers)) {
    throw new ApiError(502, `Repository marker file must contain an array: ${path}`)
  }

  return markers
}

function diffMarkerFile(currentMarkers, nextMarkers, mapId) {
  const currentById = markerMapById(currentMarkers)
  const nextById = markerMapById(nextMarkers)
  const addedIds = []
  const updatedIds = []
  const deletedIds = []
  let typeChanged = 0
  let floorChanged = 0

  for (const next of nextMarkers) {
    const current = currentById.get(next.id)

    if (!current) {
      if (next.source !== 'community' || next.status !== 'proposed') {
        throw new ApiError(400, `New marker must be community/proposed: ${next.id}`)
      }
      addedIds.push(next.id)
      continue
    }

    if (markerRecordsEqual(current, next)) {
      continue
    }

    if (next.mapId !== current.mapId || next.floorId !== current.floorId || next.source !== current.source) {
      throw new ApiError(400, `Marker update must preserve mapId, floorId, and source: ${next.id}`)
    }
    if (next.status !== 'proposed') {
      throw new ApiError(400, `Community marker updates must keep proposed status: ${next.id}`)
    }
    if (current.type !== next.type) {
      typeChanged += 1
    }
    if (current.floorId !== next.floorId) {
      floorChanged += 1
    }
    updatedIds.push(next.id)
  }

  for (const current of currentMarkers) {
    if (!nextById.has(current.id)) {
      deletedIds.push(current.id)
    }
  }

  return {
    mapId,
    addedIds,
    updatedIds,
    deletedIds,
    typeChanged,
    floorChanged,
  }
}

function markerMapById(markers) {
  const byId = new Map()

  for (const marker of markers) {
    if (!marker || typeof marker !== 'object' || Array.isArray(marker) || !isSlug(marker.id, 140) || byId.has(marker.id)) {
      throw new ApiError(502, 'Repository marker file contains invalid or duplicate marker ids')
    }

    byId.set(marker.id, marker)
  }

  return byId
}

function markerRecordsEqual(left, right) {
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()

  if (leftKeys.length !== rightKeys.length) {
    return false
  }

  for (let index = 0; index < leftKeys.length; index += 1) {
    if (leftKeys[index] !== rightKeys[index] || !Object.is(left[leftKeys[index]], right[rightKeys[index]])) {
      return false
    }
  }

  return true
}

function createMarkerStats() {
  return {
    added: 0,
    updated: 0,
    deleted: 0,
    total: 0,
    typeChanged: 0,
    floorChanged: 0,
    files: [],
  }
}

function addMarkerDiff(stats, diff) {
  const added = diff.addedIds.length
  const updated = diff.updatedIds.length
  const deleted = diff.deletedIds.length
  const total = added + updated + deleted

  stats.added += added
  stats.updated += updated
  stats.deleted += deleted
  stats.total += total
  stats.typeChanged += diff.typeChanged
  stats.floorChanged += diff.floorChanged
  stats.files.push({
    mapId: diff.mapId,
    added,
    updated,
    deleted,
    total,
  })
}

function classifyRisk(stats) {
  if (
    stats.added > 0 &&
    stats.updated === 0 &&
    stats.deleted === 0 &&
    stats.total <= LOW_RISK_MARKER_OPERATION_COUNT &&
    stats.typeChanged === 0 &&
    stats.floorChanged === 0
  ) {
    return { label: 'risk-low', level: 'low' }
  }

  return { label: 'risk-medium', level: 'medium' }
}

function validateOptionalMarkerMetadata(marker) {
  if (marker.siteNumber !== undefined && !isPositiveInteger(marker.siteNumber, 99)) {
    throw new ApiError(400, `Invalid siteNumber: ${marker.id}`)
  }
  if (marker.siteLetter !== undefined && marker.siteLetter !== 'A' && marker.siteLetter !== 'B') {
    throw new ApiError(400, `Invalid siteLetter: ${marker.id}`)
  }
  if (marker.spawnNumber !== undefined && !isPositiveInteger(marker.spawnNumber, 99)) {
    throw new ApiError(400, `Invalid spawnNumber: ${marker.id}`)
  }
  if (marker.spawnName !== undefined && !isSafeText(marker.spawnName, 80)) {
    throw new ApiError(400, `Invalid spawnName: ${marker.id}`)
  }
  if (marker.direction !== undefined && marker.direction !== 'up' && marker.direction !== 'down') {
    throw new ApiError(400, `Invalid direction: ${marker.id}`)
  }
  if (marker.size !== undefined && (!Number.isFinite(marker.size) || marker.size <= 0 || marker.size > 4)) {
    throw new ApiError(400, `Invalid size: ${marker.id}`)
  }
  if (marker.rotation !== undefined && (!Number.isFinite(marker.rotation) || marker.rotation < -360 || marker.rotation > 360)) {
    throw new ApiError(400, `Invalid rotation: ${marker.id}`)
  }
}

function applyTranslationChanges(currentTranslations, changes, upsertMarkerIds, removeMarkerIds) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    throw new ApiError(400, 'Invalid translation changes')
  }
  if (
    (changes.upsert !== undefined && !Array.isArray(changes.upsert)) ||
    (changes.remove !== undefined && !Array.isArray(changes.remove))
  ) {
    throw new ApiError(400, 'Invalid translation changes')
  }

  let translations = [...currentTranslations]

  for (const removal of changes.remove ?? []) {
    validateTranslationRemoval(removal, removeMarkerIds)
    translations = translations.filter((translation) => {
      if (translation.entityType !== 'marker' || translation.entityId !== removal.entityId) {
        return true
      }
      if (removal.field && translation.field !== removal.field) {
        return true
      }
      if (removal.locale && translation.locale !== removal.locale) {
        return true
      }
      return false
    })
  }

  for (const upsert of changes.upsert ?? []) {
    validateTranslationUpsert(upsert, upsertMarkerIds)
    translations = translations.filter(
      (translation) =>
        !(
          translation.entityType === upsert.entityType &&
          translation.entityId === upsert.entityId &&
          translation.field === upsert.field &&
          translation.locale === upsert.locale
        ),
    )
    translations.push(upsert)
  }

  return translations
}

function validateTranslationUpsert(translation, allowedMarkerIds) {
  if (
    !translation ||
    translation.entityType !== 'marker' ||
    translation.field !== 'label' ||
    !isSlug(translation.entityId, 140) ||
    !isLocale(translation.locale) ||
    !isSafeText(translation.value, 160) ||
    translation.status !== 'proposed'
  ) {
    throw new ApiError(400, 'Only marker label translation upserts are allowed')
  }
  if (!allowedMarkerIds.has(translation.entityId)) {
    throw new ApiError(400, `Translation upsert must target a marker changed in this submission: ${translation.entityId}`)
  }
}

function validateTranslationRemoval(removal, allowedMarkerIds) {
  if (
    !removal ||
    removal.entityType !== 'marker' ||
    !isSlug(removal.entityId, 140) ||
    (removal.field !== undefined && removal.field !== 'label') ||
    (removal.locale !== undefined && !isLocale(removal.locale))
  ) {
    throw new ApiError(400, 'Only marker label translation removals are allowed')
  }
  if (!allowedMarkerIds.has(removal.entityId)) {
    throw new ApiError(400, `Translation removal must target a marker changed in this submission: ${removal.entityId}`)
  }
}

function addWrite(writes, writePaths, path, content) {
  if (writePaths.has(path)) {
    throw new ApiError(400, `Duplicate write path: ${path}`)
  }

  writePaths.add(path)
  writes.push({ path, content })
}

function markerMapIdFromPath(path) {
  const match = /^public\/data\/community\/markers\/([a-z0-9][a-z0-9-]*)\.json$/.exec(path)

  if (!match || match[1] === 'index') {
    return null
  }

  return match[1]
}

function buildPullRequestBody(validated, user) {
  const checklist = validated.checklist.length > 0 ? validated.checklist.map((item) => `- [ ] ${item}`).join('\n') : '- [ ] Review community data diff'

  return [
    `Submitted by @${user.login}`,
    '',
    '## Summary',
    '',
    `- Risk: ${validated.risk.label}`,
    `- Marker changes: ${validated.markerStats.added} added, ${validated.markerStats.updated} updated, ${validated.markerStats.deleted} deleted (${validated.markerStats.total} total)`,
    ...validated.markerStats.files.map((file) => `- ${file.mapId}: ${file.added} added, ${file.updated} updated, ${file.deleted} deleted`),
    '',
    '## Files',
    '',
    ...validated.files.map((file) => `- ${file.path}`),
    '',
    '## Checklist',
    '',
    checklist,
  ].join('\n')
}

function buildBranchName(branch, login) {
  const loginSlug = safeBranchSegment(login, 'user')
  const branchSlug = safeBranchSegment(branch, 'change')
  const suffix = crypto.randomUUID().slice(0, 8)

  return `community/${loginSlug}/${branchSlug}-${suffix}`.slice(0, 240)
}

function safeBranchSegment(value, fallback) {
  const segment = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/(^[.-]+|[.-]+$)/g, '')
    .replace(/\.lock$/g, '')

  return segment && !segment.includes('..') && !segment.includes('@{') ? segment : fallback
}

async function createInstallationToken(env) {
  const jwt = await createGitHubAppJwt(env)
  const response = await githubJson(`/app/installations/${env.GITHUB_INSTALLATION_ID}/access_tokens`, {
    method: 'POST',
    token: jwt,
  })

  return response.token
}

async function createGitHubAppJwt(env) {
  const now = Math.floor(Date.now() / 1000)
  const header = base64UrlJson({ alg: 'RS256', typ: 'JWT' })
  const payload = base64UrlJson({
    iat: now - 60,
    exp: now + 9 * 60,
    iss: env.GITHUB_APP_ID,
  })
  const input = `${header}.${payload}`
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(env.GITHUB_APP_PRIVATE_KEY),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input))

  return `${input}.${base64UrlBytes(new Uint8Array(signature))}`
}

async function readRepoJson(owner, repo, path, ref, token) {
  const file = await githubJson(`/repos/${owner}/${repo}/contents/${encodeURIComponentPath(path)}?ref=${encodeURIComponent(ref)}`, { token })

  if (file.type !== 'file' || !file.content) {
    throw new ApiError(502, `Repository file is missing: ${path}`)
  }

  return JSON.parse(decodeBase64ToUtf8(file.content))
}

async function ensureLabels(owner, repo, token) {
  for (const label of LABELS) {
    try {
      await githubJson(`/repos/${owner}/${repo}/labels`, {
        method: 'POST',
        token,
        body: label,
      })
    } catch (error) {
      if (!(error instanceof GitHubError) || error.status !== 422) {
        throw error
      }
    }
  }
}

async function githubJson(path, options) {
  const response = await fetch(`${GITHUB_API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${options.token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'r6maps-worker',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new GitHubError(response.status, `GitHub API failed: ${response.status} ${body}`)
  }

  if (response.status === 204) {
    return null
  }

  return response.json()
}

async function parseJsonBody(request) {
  try {
    return await request.json()
  } catch {
    throw new ApiError(400, 'Request body must be JSON')
  }
}

async function readSession(request, env) {
  const session = await readSignedCookie(request, SESSION_COOKIE, env)

  if (!session?.user || !session.exp || session.exp < Math.floor(Date.now() / 1000)) {
    return null
  }

  return session
}

async function readSignedCookie(request, name, env) {
  const value = parseCookies(request.headers.get('Cookie'))[name]
  if (!value) {
    return null
  }

  const [payload, signature] = value.split('.')
  if (!payload || !signature) {
    return null
  }

  const expected = await hmac(payload, env.SESSION_SECRET)
  if (signature !== expected) {
    return null
  }

  try {
    return JSON.parse(decodeBase64UrlToUtf8(payload))
  } catch {
    return null
  }
}

async function signedCookieValue(payload, env) {
  const encoded = base64UrlJson(payload)
  const signature = await hmac(encoded, env.SESSION_SECRET)

  return `${encoded}.${signature}`
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))

  return base64UrlBytes(new Uint8Array(signature))
}

function loginUrlForRequest(request, env) {
  const requestUrl = new URL(request.url)
  const returnTo = allowedReturnTo(request.headers.get('X-R6Maps-Return-To') ?? request.headers.get('Origin'), env)
  const loginUrl = new URL('/api/auth/login', requestUrl.origin)
  loginUrl.searchParams.set('returnTo', returnTo)

  return loginUrl.toString()
}

function allowedReturnTo(value, env) {
  const origins = allowedOrigins(env)
  const fallback = origins[0] ?? 'https://yahuli.github.io'

  try {
    const url = new URL(value ?? fallback)
    if (origins.includes(url.origin)) {
      return url.toString()
    }
  } catch {
    // Use fallback below.
  }

  return fallback
}

function corsHeaders(request, env) {
  const headers = new Headers({
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, X-R6Maps-Return-To',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    Vary: 'Origin',
  })
  const origin = request.headers.get('Origin')

  if (origin && allowedOrigins(env).includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin)
  }

  return headers
}

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

function jsonResponse(body, status = 200, headers = new Headers()) {
  const responseHeaders = new Headers(headers)
  responseHeaders.set('Content-Type', 'application/json; charset=utf-8')

  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  })
}

function redirectResponse(location, headers = {}) {
  const responseHeaders = new Headers()
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        responseHeaders.append(key, item)
      }
      continue
    }

    responseHeaders.set(key, value)
  }

  responseHeaders.set('Location', location)

  return new Response(null, {
    status: 302,
    headers: responseHeaders,
  })
}

function serializeCookie(name, value, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${maxAge}`
}

function clearCookie(name) {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0`
}

function parseCookies(cookieHeader) {
  return Object.fromEntries(
    String(cookieHeader ?? '')
      .split(';')
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const separator = cookie.indexOf('=')
        return separator === -1 ? [cookie, ''] : [cookie.slice(0, separator), cookie.slice(separator + 1)]
      }),
  )
}

function requireEnv(env, keys) {
  const missing = keys.filter((key) => !env[key])

  if (missing.length > 0) {
    throw new ApiError(500, `Missing Worker environment variables: ${missing.join(', ')}`)
  }
}

function isCoordinate(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1
}

function isPositiveInteger(value, max) {
  return Number.isInteger(value) && value > 0 && value <= max
}

function isSlug(value, maxLength) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength && /^[a-z0-9][a-z0-9-]*$/.test(value)
}

function isLocale(value) {
  return typeof value === 'string' && value.length >= 2 && value.length <= 20 && /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value)
}

function isSafeText(value, maxLength) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    return false
  }

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 32 || code === 127) {
      return false
    }
  }

  return true
}

function base64UrlJson(value) {
  return base64UrlBytes(new TextEncoder().encode(JSON.stringify(value)))
}

function base64UrlBytes(bytes) {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeBase64UrlToUtf8(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')

  return decodeBase64ToUtf8(base64)
}

function decodeBase64ToUtf8(value) {
  return new TextDecoder().decode(base64ToBytes(value))
}

function pemToArrayBuffer(pem) {
  const normalized = pem.replace(/\\n/g, '\n')
  const isPkcs1 = normalized.includes('-----BEGIN RSA PRIVATE KEY-----')
  const base64 = normalized
    .replace(/-----BEGIN RSA PRIVATE KEY-----/g, '')
    .replace(/-----END RSA PRIVATE KEY-----/g, '')
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '')
  const bytes = base64ToBytes(base64)

  return isPkcs1 ? wrapPkcs1PrivateKey(bytes).buffer : bytes.buffer
}

function base64ToBytes(value) {
  const binary = atob(value.replace(/\s/g, ''))
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

function wrapPkcs1PrivateKey(pkcs1) {
  return derSequence(
    new Uint8Array([0x02, 0x01, 0x00]),
    new Uint8Array([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]),
    derTaggedValue(0x04, pkcs1),
  )
}

function derSequence(...parts) {
  const length = parts.reduce((total, part) => total + part.length, 0)
  const output = new Uint8Array(1 + derLength(length).length + length)
  let offset = 0
  output[offset] = 0x30
  offset += 1
  output.set(derLength(length), offset)
  offset += derLength(length).length

  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }

  return output
}

function derTaggedValue(tag, value) {
  const length = derLength(value.length)
  const output = new Uint8Array(1 + length.length + value.length)
  output[0] = tag
  output.set(length, 1)
  output.set(value, 1 + length.length)

  return output
}

function derLength(length) {
  if (length < 128) {
    return new Uint8Array([length])
  }

  const bytes = []
  let value = length
  while (value > 0) {
    bytes.unshift(value & 0xff)
    value >>= 8
  }

  return new Uint8Array([0x80 | bytes.length, ...bytes])
}

function encodeURIComponentPath(path) {
  return path.split('/').map(encodeURIComponent).join('/')
}

class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

class GitHubError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}
