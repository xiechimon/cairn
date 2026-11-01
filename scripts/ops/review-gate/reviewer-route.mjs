import { createHash } from 'node:crypto';

export const STALL_MS = 3600_000;
export const CLAUDE_REVIEW_TOOLS = ['Read', 'Grep', 'Glob'];
export const CLAUDE_DENIED_TOOLS = [
  'Bash',
  'Edit',
  'Write',
  'NotebookEdit',
  'WebFetch',
  'WebSearch',
];
export const DIFF_LIMIT = 400_000;
export const CLAUDE_DIFF_PATHSPEC = [
  '-D',
  '--',
  '.',
  ':(exclude)docs/verify',
  ':(exclude)**/__snapshots__/**',
  ':(exclude)apps/server/drizzle/meta',
];

export function roundStops(run) {
  return (
    /no usable model/.test(run.stderr) && !run.excluded && !/claude fallback:/.test(run.stderr)
  );
}

export function claudeFallback(authorVendor, run) {
  return authorVendor !== 'anthropic' && run.status !== 0 && /no usable model/.test(run.stderr);
}

export function claudeReviewArgs() {
  return [
    '-p',
    '--model',
    'opus',
    '--permission-mode',
    'default',
    '--setting-sources',
    'project',
    '--strict-mcp-config',
    '--tools',
    CLAUDE_REVIEW_TOOLS.join(','),
    '--allowedTools',
    ...CLAUDE_REVIEW_TOOLS,
    '--disallowedTools',
    ...CLAUDE_DENIED_TOOLS,
  ];
}

export function claudeReviewPrompt(prompt, { diff, title, body }) {
  if (diff.length > DIFF_LIMIT) return null;
  return `${prompt}

You cannot run commands. The PR description and the diff against origin/main are below. Deleted files appear without their old content, and docs/verify evidence, test snapshots and drizzle meta are omitted. The checkout is origin/main, so Read/Grep/Glob show the base side only.

PR title: ${title}

PR description:
${body}

Diff:
\`\`\`diff
${diff}
\`\`\``;
}

export function stalledSince(records, number, sha) {
  const forHead = records.filter((r) => r.pr === number && r.sha === sha);
  if (forHead.some((r) => r.verdict)) return null;
  return forHead.find((r) => r.verdict === null)?.at ?? null;
}

export function stalled(records, number, sha, now) {
  const since = stalledSince(records, number, sha);
  return since !== null && now - Date.parse(since) > STALL_MS ? since : null;
}

export function stallAlert(pr, since) {
  return `<!-- review-gate-stalled:${pr.headRefOid} -->\n**Independent review gate: no verdict for over an hour** for \`${pr.headRefOid.slice(0, 8)}\` (first attempt ${since}). The coordinator lists these with \`gh pr list --label review-stalled\`; the label is removed when a verdict is posted.`;
}

export function parseRuns(text) {
  return text
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

export const HUMAN_LABEL = 'review-gate-human';
export const HUMAN_MARKER = '<!-- review-gate-human:';
export const BLOCK_ROUNDS = 3;
const FINDINGS_LIMIT = 9_000;

export function gateVerdicts(comments) {
  return comments.flatMap((c) => {
    const m =
      /^<!-- review-gate:([0-9a-f]{40}) -->\n\*\*Independent review gate: (PASS|BLOCK)\*\*/.exec(
        c.body,
      );
    return m ? [{ sha: m[1], verdict: m[2], body: c.body, url: c.url }] : [];
  });
}

export function escalation(comments, labels) {
  const since = comments.slice(comments.findLastIndex((c) => c.body.startsWith(HUMAN_MARKER)) + 1);
  const verdicts = gateVerdicts(since);
  const due =
    verdicts.at(-1)?.verdict === 'BLOCK' &&
    verdicts.filter((v) => v.verdict === 'BLOCK').length >= BLOCK_ROUNDS;
  const labelled = labels.some((l) => l.name === HUMAN_LABEL);
  if (!due && !labelled) return null;
  return { addLabel: !labelled, comment: due };
}

export function priorFindings(verdicts) {
  const text = verdicts
    .filter((v) => v.verdict === 'BLOCK')
    .map(
      (v) =>
        `Head \`${v.sha.slice(0, 8)}\`:\n${v.body
          .replace(/<!--[^>]*-->/g, '')
          .replace(/^\s*\*\*Independent review gate: BLOCK\*\*[^\n]*\n/, '')
          .trim()}`,
    )
    .join('\n\n');
  return text.length > FINDINGS_LIMIT ? `…\n${text.slice(-FINDINGS_LIMIT)}` : text;
}

export function diffDigest(diff) {
  const own = diff
    .split('\n')
    .filter((l) => !l.startsWith('index ') && !l.startsWith('@@'))
    .join('\n');
  return createHash('sha256').update(own).digest('hex');
}

export function parseRawDiff(text) {
  const parts = text.split('\0');
  const entries = [];
  for (let k = 0; k + 1 < parts.length; k += 2) {
    const [oldMode, newMode, , , status] = parts[k].slice(1).split(' ');
    entries.push({ path: parts[k + 1], status, mode: status === 'D' ? oldMode : newMode });
  }
  return entries;
}

const GATE_DOCS = [
  /^docs\/adr(\/|$)/i,
  /^docs\/spec(\/|$)/i,
  /^docs\/pr-review\.md$/i,
  /^docs\/lessons/i,
  /^docs\/agent-dispatch-prompts\.md$/i,
  /(^|\/)\.claude(\/|$)/i,
];
const LOW_RISK = [
  /^docs\//,
  /(^|\/)(test|e2e)\//,
  /\.(test|spec)\.[^/]+$/,
  /(^|\/)locales\/.+\.json$/,
  /\.md$/,
];

export function lowRiskTier(entries, protectedRes) {
  const folded = protectedRes.map((re) =>
    re.flags.includes('i') ? re : new RegExp(re.source, `${re.flags}i`),
  );
  return (
    entries.length > 0 &&
    entries.every(
      ({ path, status, mode }) =>
        ['A', 'M'].includes(status) &&
        ['100644', '100755'].includes(mode) &&
        LOW_RISK.some((re) => re.test(path)) &&
        !GATE_DOCS.some((re) => re.test(path)) &&
        !folded.some((re) => re.test(path)),
    )
  );
}
