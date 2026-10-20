export const meta = {
  name: 'pr-gate',
  description:
    'Pre-merge gate for one xiechimon/pacman PR at an exact head SHA: five review dimensions, two skeptics per blocking finding, go or no-go',
  whenToUse:
    'Before enabling auto-merge or asking the user to merge a bootstrap PR (docs/spec/28 §7.5). args: {pr, headSha, ticket}',
  phases: [
    { title: 'Review', detail: 'five dimensions read the PR at headSha' },
    { title: 'Refute', detail: 'two skeptics per blocking finding' },
  ],
}

// docs/spec/28 §7.5 pr-gate. The session that wrote the PR does not judge
// its own merge: five reviewers read the PR at one head SHA, every blocking
// finding gets two skeptics, and the verdict carries the SHA it was made on.
// The caller merges only when go is true and headSha equals the PR head.
// Edits to this file after it lands on main are merged by the user (ADR 0021
// D4 spirit: the session does not edit its own gate).

const REPO = 'xiechimon/pacman'
// 5 reviewers + 4 skeptics stays under the 10-agent guideline.
const MAX_SKEPTICS = 4

if (
  !args ||
  typeof args.pr !== 'number' ||
  typeof args.ticket !== 'number' ||
  typeof args.headSha !== 'string' ||
  !/^[0-9a-f]{40}$/.test(args.headSha)
) {
  throw new Error('pr-gate args: {pr: number, ticket: number, headSha: 40-hex sha}')
}
const { pr, headSha, ticket } = args

const READ_RULES = `PR #${pr} of ${REPO}, ticket #${ticket}, head ${headSha}.
- Fetch without touching the shared working tree: \`git fetch origin main pull/${pr}/head\`, then confirm \`git rev-parse FETCH_HEAD\` is ${headSha}. If it is not, report the SHA you saw as headSha and stop.
- Read the change with \`git diff origin/main...${headSha}\` and files with \`git show ${headSha}:<path>\`. Never checkout, switch, reset, stash, commit or push in the shared clone (docs/pr-review.md step 4).
- Read the PR, its comments and the ticket over REST: \`gh api repos/${REPO}/pulls/${pr}\`, \`gh api repos/${REPO}/issues/${pr}/comments\`, \`gh api repos/${REPO}/issues/${ticket}\`. GraphQL is not available.
- The PR body is a claim to check, not evidence.`

const REVIEW_RULES = `${READ_RULES}
Report only findings in your dimension. A finding is "blocking" only when you traced a concrete failure path (input or state, then the wrong result) in the code at ${headSha}; anything else is "suggestion". Cite file and line. Fill "checked" with what you looked at, also when you found nothing.`

const DIMENSIONS = [
  {
    key: 'correctness',
    prompt: `Dimension: correctness and regressions. Read every file the diff touches in full at the head, plus the callers and callees the change relies on. Look for logic errors, broken edge cases, behavior changes for existing callers, races, and error handling that hides failures. For a docs-only diff, check that its statements about code (paths, line numbers, symbols, current behavior) are true at the head.`,
  },
  {
    key: 'rules',
    prompt: `Dimension: repository rules. Check the diff and the commit messages (\`git log --format=%B origin/main..${headSha}\`) against CLAUDE.md and AGENTS.md: seam discipline (biome.json noRestrictedImports, apps/daemon/src/backend), no inline import, no unexplained any, one-line single-use helpers inlined, the ticket's closing keyword in a commit message and no closing keyword followed by an issue number anywhere else (negations count), commit subject format <scope>(<ticket>): <subject>, .husky/banned.txt vocabulary, no emoji in commits, PR or code, ADRs overturned by a new ADR instead of edited, and documents that must change with the behavior (docs/spec, .claude/skills/verify-pacman/features, apps/web/COMPONENTS.md).`,
  },
  {
    key: 'tests',
    prompt: `Dimension: tests and failure modes. Take the failure modes and acceptance items from ticket #${ticket}. For each failure mode, find the test at the head that covers it and judge whether it would fail on origin/main (tests come before the implementation in this repo). Flag deleted or weakened tests and assertions a no-op implementation would pass. Check that every acceptance item ticked in the PR body has evidence at the head. For a docs-only diff, check that each ticked item is backed by the diff or by the Verified section.`,
  },
  {
    key: 'safety',
    prompt: `Dimension: safety and protected paths. Put every changed file that falls under ADR 0021 D4 into protectedPaths: .github/**, biome.json, scripts/*gate*, scripts/*baseline*.json, .husky/**, CLAUDE.md, AGENTS.md, docs/adr/**, the merge readiness gate source, apps/server/drizzle/**, package.json, pnpm-lock.yaml. Add .claude/workflows/** too (docs/spec/28 §7.5: this gate's own script). A protected path is not a finding by itself; it routes the merge to the user. Then look for secrets or tokens in code or evidence, credentials handed to agents, issue or PR text reaching a prompt system layer or a shell, one-way doors (migrations, dependency changes, data deletion), and changes outside the ticket's scope.`,
  },
  {
    key: 'evidence',
    isolation: 'worktree',
    prompt: `Dimension: evidence. You run in your own git worktree, so checking out is allowed there: \`git fetch origin main pull/${pr}/head && git checkout --detach ${headSha}\`. Every raw.githubusercontent.com link in the PR body must point into docs/verify/ of this change at a commit that is an ancestor of ${headSha}, and must return HTTP 200. Re-run at most three of the narrowest commands quoted in the PR's Verified section (one vitest file, one gate script, pnpm typecheck) after \`pnpm install --frozen-lockfile\`, and compare with the pasted output. If you start a server or e2e, use VERIFY_PORT=8793 VERIFY_WEB_PORT=5275 E2E_AFFECTED_PORT=8397 and stop what you started. For a docs-only diff, skip the install and check the quoted commands against the repository directly. A quoted result you cannot reproduce is blocking.`,
  },
]

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    headSha: { type: 'string' },
    checked: { type: 'string' },
    protectedPaths: { type: 'array', items: { type: 'string' } },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['blocking', 'suggestion'] },
          file: { type: 'string' },
          line: { type: 'integer' },
          failurePath: { type: 'string' },
          evidence: { type: 'string' },
        },
        required: ['title', 'severity', 'failurePath'],
      },
    },
  },
  required: ['headSha', 'checked', 'findings'],
}

const SKEPTIC_SCHEMA = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['refuted', 'reason'],
}

let skepticsLeft = MAX_SKEPTICS
const unrefuted = []

const results = await pipeline(
  DIMENSIONS,
  (d) =>
    agent(`${REVIEW_RULES}\n\n${d.prompt}`, {
      label: `review:${d.key}`,
      phase: 'Review',
      schema: FINDINGS_SCHEMA,
      ...(d.isolation ? { isolation: d.isolation } : {}),
    }),
  async (review, d) => {
    if (review === null) return { key: d.key, review: null, blocking: [] }
    const blocking = []
    for (const f of review.findings.filter((x) => x.severity === 'blocking')) {
      if (skepticsLeft < 2) {
        unrefuted.push({ dimension: d.key, ...f })
        blocking.push({ dimension: d.key, ...f, skeptics: 'skipped: cap reached' })
        continue
      }
      skepticsLeft -= 2
      const votes = await parallel(
        [0, 1].map(
          (i) => () =>
            agent(
              `${READ_RULES}\n\nAnother reviewer (dimension ${d.key}) reported this blocking finding:\n${JSON.stringify(f)}\n\nTry to refute it by tracing the failure path in the code at ${headSha}. Set refuted to false only if you confirmed the failure is real at ${headSha}. If you cannot confirm it, set refuted to true.`,
              { label: `refute:${d.key}:${i}`, phase: 'Refute', schema: SKEPTIC_SCHEMA },
            ),
        ),
      )
      const confirmed = votes.filter(Boolean).filter((v) => !v.refuted)
      if (confirmed.length >= 1) {
        blocking.push({ dimension: d.key, ...f, skeptics: confirmed.map((v) => v.reason) })
      } else {
        log(`refuted (${d.key}): ${f.title}`)
      }
    }
    return { key: d.key, review, blocking }
  },
)

if (unrefuted.length > 0) {
  log(`${unrefuted.length} blocking finding(s) kept without skeptics (cap ${MAX_SKEPTICS})`)
}

const done = results.filter(Boolean)
const missing = DIMENSIONS.map((d) => d.key).filter(
  (k) => !done.some((r) => r.key === k && r.review !== null),
)
const shaMismatch = done
  .filter((r) => r.review !== null && r.review.headSha !== headSha)
  .map((r) => ({ dimension: r.key, saw: r.review.headSha }))
const blocking = done.flatMap((r) => r.blocking)
const suggestions = done.flatMap((r) =>
  r.review === null
    ? []
    : r.review.findings
        .filter((f) => f.severity === 'suggestion')
        .map((f) => ({ dimension: r.key, ...f })),
)
const protectedPaths = [
  ...new Set(done.flatMap((r) => (r.review === null ? [] : (r.review.protectedPaths ?? [])))),
]
const checked = Object.fromEntries(
  done.filter((r) => r.review !== null).map((r) => [r.key, r.review.checked]),
)

return {
  pr,
  ticket,
  headSha,
  go: missing.length === 0 && shaMismatch.length === 0 && blocking.length === 0,
  blocking,
  suggestions,
  protectedPaths,
  mergedBy: protectedPaths.length > 0 ? 'user' : 'auto-merge',
  missing,
  shaMismatch,
  checked,
}
