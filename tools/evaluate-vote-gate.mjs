const RISK_RULES = {
  low: { approvals: 3, rejections: 1 },
  medium: { approvals: 5, rejections: 2 },
  high: { approvals: Infinity, rejections: 1 },
};

const PROTECTED_PATH_PREFIXES = [
  '.github/',
  'tools/',
  'src/',
  'package.json',
  'package-lock.json',
  'vite.config',
  'tsconfig',
];

export function evaluateVoteGate(input) {
  const risk = input.risk ?? 'medium';
  const rule = RISK_RULES[risk] ?? RISK_RULES.medium;
  const qualifiedVotes = dedupeVotes(input.votes ?? []);
  const qualifiedApprovals = qualifiedVotes.filter((vote) => vote.reaction === '+1').length;
  const qualifiedRejections = qualifiedVotes.filter((vote) => vote.reaction === '-1').length;
  const reasons = [];

  if (!input.checksPassed) {
    reasons.push('required checks have not passed');
  }

  const protectedFile = (input.changedFiles ?? []).find((file) =>
    PROTECTED_PATH_PREFIXES.some((prefix) => file === prefix || file.startsWith(prefix)),
  );

  if (protectedFile) {
    reasons.push(`protected path changed: ${protectedFile}`);
  }

  if (risk === 'high') {
    reasons.push('high risk changes require maintainer review');
  }

  if (qualifiedApprovals < rule.approvals) {
    reasons.push(`needs ${rule.approvals} qualified approvals`);
  }

  if (qualifiedRejections >= rule.rejections) {
    reasons.push('opposition threshold reached');
  }

  return {
    canAutoMerge: reasons.length === 0,
    qualifiedApprovals,
    qualifiedRejections,
    reasons,
    risk,
  };
}

function dedupeVotes(votes) {
  const latestByUser = new Map();

  for (const vote of votes) {
    if (!vote.qualified || !vote.user || !['+1', '-1'].includes(vote.reaction)) {
      continue;
    }

    latestByUser.set(vote.user, vote);
  }

  return [...latestByUser.values()];
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
