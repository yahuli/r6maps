const COMMUNITY_DATA_LABEL = 'community-data';
const RISK_LOW_LABEL = 'risk-low';
const RISK_MEDIUM_LABEL = 'risk-medium';
const RISK_HIGH_LABEL = 'risk-high';
const BLOCKING_LABELS = new Set(['blocked', 'needs-maintainer-review', RISK_MEDIUM_LABEL, RISK_HIGH_LABEL]);
const MIN_OPEN_HOURS = 24;
const MIN_APPROVALS = 5;
const MIN_NET_APPROVALS = 3;
const MAX_REJECTIONS = 2;
const MAX_REJECTION_RATIO = 0.3;
const BLOCKED_MERGEABLE_STATES = new Set(['unknown', 'dirty', 'blocked']);

export function evaluateVoteGate(input) {
  const labels = new Set(input.labels ?? []);
  const risk = input.risk ?? riskFromLabels(labels);
  const qualifiedVotes = dedupeVotes(input.votes ?? [], input.author);
  const qualifiedApprovals = qualifiedVotes.filter((vote) => vote.reaction === '+1').length;
  const qualifiedRejections = qualifiedVotes.filter((vote) => vote.reaction === '-1').length;
  const netApprovals = qualifiedApprovals - qualifiedRejections;
  const rejectionRatio =
    qualifiedApprovals > 0 ? qualifiedRejections / qualifiedApprovals : qualifiedRejections > 0 ? Infinity : 0;
  const changedFiles = normalizeChangedFiles(input.changedFiles ?? []);
  const disallowedFile = changedFiles.find((file) => !isAllowedCommunityDataPath(file));
  const disallowedLabels = [...BLOCKING_LABELS].filter((label) => labels.has(label));
  const openedHours = openedHoursSince(input.createdAt, input.now);
  const mergeableState = input.mergeableState ?? input.mergeable_state ?? 'unknown';
  const checks = normalizeChecks(input);
  const reasons = [];

  if (!labels.has(COMMUNITY_DATA_LABEL)) {
    reasons.push(`requires ${COMMUNITY_DATA_LABEL} label`);
  }

  if (risk !== 'low' || !labels.has(RISK_LOW_LABEL)) {
    reasons.push(`requires ${RISK_LOW_LABEL} label`);
  }

  if (disallowedLabels.length > 0) {
    reasons.push(`blocked by label: ${disallowedLabels.join(', ')}`);
  }

  if (disallowedFile) {
    reasons.push(`protected path changed: ${disallowedFile}`);
  }

  if (!checks.passed) {
    reasons.push(`checks are ${checks.state}`);
  }

  if (openedHours < MIN_OPEN_HOURS) {
    reasons.push(`PR must be open for at least ${MIN_OPEN_HOURS} hours`);
  }

  if (qualifiedApprovals < MIN_APPROVALS) {
    reasons.push(`needs ${MIN_APPROVALS} qualified approvals`);
  }

  if (netApprovals < MIN_NET_APPROVALS) {
    reasons.push(`needs net approvals >= ${MIN_NET_APPROVALS}`);
  }

  if (qualifiedRejections > MAX_REJECTIONS) {
    reasons.push(`qualified rejections exceed ${MAX_REJECTIONS}`);
  }

  if (rejectionRatio > MAX_REJECTION_RATIO) {
    reasons.push(`qualified rejections exceed ${Math.round(MAX_REJECTION_RATIO * 100)}% of approvals`);
  }

  if (BLOCKED_MERGEABLE_STATES.has(mergeableState)) {
    reasons.push(`mergeable_state is ${mergeableState}`);
  }

  return {
    canAutoMerge: reasons.length === 0,
    qualifiedApprovals,
    qualifiedRejections,
    netApprovals,
    reasons,
    risk,
    checks,
    openedHours: Math.floor(openedHours),
    mergeableState,
  };
}

function normalizeChecks(input) {
  if (input.checks && typeof input.checks === 'object') {
    return {
      state: input.checks.state ?? (input.checks.passed ? 'passed' : 'unknown'),
      passed: input.checks.passed === true,
    };
  }

  return {
    state: input.checksPassed ? 'passed' : 'unknown',
    passed: input.checksPassed === true,
  };
}

function riskFromLabels(labels) {
  if (labels.has(RISK_LOW_LABEL)) {
    return 'low';
  }
  if (labels.has(RISK_HIGH_LABEL)) {
    return 'high';
  }
  if (labels.has(RISK_MEDIUM_LABEL)) {
    return 'medium';
  }

  return 'unknown';
}

function normalizeChangedFiles(files) {
  return files
    .map((file) => (typeof file === 'string' ? file : file.path ?? file.filename))
    .filter((file) => typeof file === 'string' && file.length > 0);
}

function isAllowedCommunityDataPath(path) {
  const markerMatch = /^public\/data\/community\/markers\/([a-z0-9][a-z0-9-]*)\.json$/.exec(path);

  return (markerMatch !== null && markerMatch[1] !== 'index') || path === 'public/data/community/translations.json';
}

function openedHoursSince(createdAt, now) {
  const createdAtMs = Date.parse(createdAt ?? '');
  const nowMs = now ? Date.parse(now) : Date.now();

  if (!Number.isFinite(createdAtMs) || !Number.isFinite(nowMs)) {
    return 0;
  }

  return Math.max(0, (nowMs - createdAtMs) / (60 * 60 * 1000));
}

function dedupeVotes(votes, author) {
  const latestByUser = new Map();
  const sortedVotes = [...votes].sort((left, right) => voteTime(left) - voteTime(right));

  for (const vote of sortedVotes) {
    const user = typeof vote.user === 'string' ? vote.user : vote.user?.login ?? vote.login;
    const reaction = vote.reaction ?? vote.content;
    const userType = vote.userType ?? vote.user?.type;

    if (vote.qualified === false || userType === 'Bot' || user === author || !user || !['+1', '-1'].includes(reaction)) {
      continue;
    }

    latestByUser.set(user, { user, reaction });
  }

  return [...latestByUser.values()];
}

function voteTime(vote) {
  const timestamp = Date.parse(vote.createdAt ?? vote.created_at ?? '');

  return Number.isFinite(timestamp) ? timestamp : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = JSON.parse(await readStdin());
  process.stdout.write(`${JSON.stringify(evaluateVoteGate(input), null, 2)}\n`);
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}
