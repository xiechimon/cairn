export const STALL_MS = 3600_000;
export const CLAUDE_REVIEW_TOOLS = [
  'Read',
  'Grep',
  'Glob',
  'Bash(git diff:*)',
  'Bash(git log:*)',
  'Bash(git show:*)',
  'Bash(gh pr view:*)',
  'Bash(gh issue view:*)',
];

export const CLAUDE_DENIED_TOOLS = [
  'Edit',
  'Write',
  'NotebookEdit',
  'WebFetch',
  'WebSearch',
  'Bash(git commit:*)',
  'Bash(git push:*)',
  'Bash(git checkout:*)',
  'Bash(git reset:*)',
  'Bash(gh pr edit:*)',
  'Bash(gh pr create:*)',
  'Bash(gh pr merge:*)',
  'Bash(gh pr comment:*)',
  'Bash(gh api:*)',
];

export function claudeFallback(authorVendor, run) {
  return (
    Boolean(authorVendor) &&
    authorVendor !== 'anthropic' &&
    run.status !== 0 &&
    /no usable model/.test(run.stderr)
  );
}

export function claudeReviewArgs(prompt) {
  return [
    '-p',
    prompt,
    '--model',
    'opus',
    '--permission-mode',
    'default',
    '--setting-sources',
    'project',
    '--strict-mcp-config',
    '--tools',
    'Read,Grep,Glob,Bash',
    '--allowedTools',
    ...CLAUDE_REVIEW_TOOLS,
    '--disallowedTools',
    ...CLAUDE_DENIED_TOOLS,
  ];
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
