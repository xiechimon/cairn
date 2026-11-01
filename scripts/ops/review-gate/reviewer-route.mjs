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
export const DIFF_LIMIT = 100_000;

export function claudeFallback(authorVendor, run) {
  return (
    Boolean(authorVendor) &&
    authorVendor !== 'anthropic' &&
    run.status !== 0 &&
    /no usable model/.test(run.stderr)
  );
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

You cannot run commands. The PR description and the full diff against origin/main are below; the checkout is origin/main, so Read/Grep/Glob show the base side only.

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
