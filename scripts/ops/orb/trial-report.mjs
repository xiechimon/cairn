import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = 'xiechimon/cairn';
const reasons = new Set([
  'setup_failed',
  'orb_start_failed',
  'agent_gave_up',
  'review_blocked',
  'ci_red',
  'timeout',
  'other',
]);
const fullSha = /^[a-f0-9]{40}$/;

function runGh(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    timeout: 30000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export async function buildTrialReport(
  input,
  { env = process.env, fetchImpl = fetch, runner = runGh } = {},
) {
  const failures = [];
  const rows = [];
  const fail = (text) => failures.push(text);
  if (!input || input.repo !== repo || !Array.isArray(input.attempts) || !input.attempts.length) {
    return {
      ok: false,
      total: 0,
      merged: 0,
      rows,
      failures: ['input: expected xiechimon/cairn and nonempty attempts'],
    };
  }
  if (!env.CAIRN_SERVER_URL || !env.CAIRN_API_TOKEN) {
    return {
      ok: false,
      total: 0,
      merged: 0,
      rows,
      failures: ['server: missing CAIRN_SERVER_URL/CAIRN_API_TOKEN'],
    };
  }
  const groups = new Map();
  const buildOwners = new Map();
  for (const attempt of input.attempts) {
    if (
      !Number.isSafeInteger(attempt?.issue) ||
      attempt.issue < 1 ||
      typeof attempt.buildId !== 'string' ||
      !attempt.buildId.trim()
    ) {
      fail('input: expected positive issue numbers and nonempty build IDs');
      continue;
    }
    const previous = buildOwners.get(attempt.buildId);
    if (previous !== undefined && previous !== attempt.issue)
      fail(`issue ${attempt.issue}: build is assigned to multiple issues`);
    buildOwners.set(attempt.buildId, attempt.issue);
    if (!groups.has(attempt.issue)) groups.set(attempt.issue, new Set());
    groups.get(attempt.issue).add(attempt.buildId);
  }
  async function server(path) {
    const response = await fetchImpl(`${env.CAIRN_SERVER_URL.replace(/\/$/, '')}${path}`, {
      headers: { authorization: `Bearer ${env.CAIRN_API_TOKEN}` },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('server read failed');
    return response.json();
  }
  async function github(path) {
    return JSON.parse(await runner(['api', `repos/${repo}/${path}`]));
  }
  for (const [issue, buildIds] of groups) {
    const row = {
      issue,
      buildIds: [...buildIds],
      attempts: [],
      prs: [],
      merged: false,
      reason: null,
    };
    const before = failures.length;
    let liveIssue;
    try {
      liveIssue = await github(`issues/${issue}`);
      const labels = liveIssue?.labels?.map((label) => label.name?.toLowerCase());
      if (
        liveIssue?.number !== issue ||
        !Array.isArray(labels) ||
        !labels.includes('by:cairn') ||
        labels.some(
          (label) =>
            typeof label !== 'string' ||
            (label.startsWith('by:') && label !== 'by:cairn') ||
            label.startsWith('batch:'),
        )
      )
        fail(`issue ${issue}: live ownership must be by:cairn without lane or batch labels`);
    } catch {
      fail(`issue ${issue}: GitHub ownership read failed`);
    }
    for (const buildId of buildIds) {
      try {
        const build = await server(`/api/builds/${encodeURIComponent(buildId)}`);
        if (build?.id !== buildId || typeof build.todoId !== 'string' || !build.todoId)
          throw new Error('invalid build');
        const todo = await server(`/api/todos/${encodeURIComponent(build.todoId)}`);
        if (
          todo?.id !== build.todoId ||
          todo.sourceRef?.toLowerCase() !== `github:${repo}#${issue}` ||
          typeof todo.teamId !== 'string' ||
          !todo.teamId
        )
          throw new Error('invalid todo join');
        if (
          !Number.isFinite(build.createdAt) ||
          !Number.isFinite(input.finishedAt) ||
          build.createdAt > input.finishedAt
        )
          fail(`issue ${issue}: trial end predates the build`);
        const steps = await server(`/api/builds/${encodeURIComponent(buildId)}/steps`);
        const machines = await server(`/api/teams/${encodeURIComponent(todo.teamId)}/machines`);
        if (!Array.isArray(steps) || !Array.isArray(machines))
          throw new Error('invalid machine response');
        const owners = machines.filter((machine) => machine.name === 'omarchy-orb');
        const claimed = steps.filter(
          (step) =>
            (step.kind === 'build' || step.kind === 'session') &&
            step.buildId === buildId &&
            step.machineId !== null &&
            step.machineId !== undefined,
        );
        const ownExecution =
          owners.length === 1 &&
          typeof owners[0].id === 'string' &&
          owners[0].id.length > 0 &&
          claimed.length > 0 &&
          claimed.every((step) => step.machineId === owners[0].id);
        if (!ownExecution)
          fail(`issue ${issue}: claimed execution must belong only to enrolled omarchy-orb`);
        const receipt = {
          buildId,
          todoId: build.todoId,
          sourceRef: todo.sourceRef,
          createdAt: build.createdAt,
          machineId: owners.length === 1 ? owners[0].id : null,
          executionSteps: claimed.map(({ id, kind, machineId, status }) => ({
            id,
            kind,
            machineId,
            status,
          })),
          pr: build.prNumber ?? null,
        };
        row.attempts.push(receipt);
        if (build.prNumber === null || build.prNumber === undefined) continue;
        if (!Number.isSafeInteger(build.prNumber) || build.prNumber < 1)
          throw new Error('invalid PR');
        const pull = await github(`pulls/${build.prNumber}`);
        if (
          pull?.number !== build.prNumber ||
          pull.head?.ref !== `cairn/conv-${buildId}` ||
          pull.head?.repo?.full_name?.toLowerCase() !== repo ||
          pull.head.repo.fork !== false
        ) {
          fail(`issue ${issue}: PR must belong to this build Thread in the same repository`);
          continue;
        }
        row.prs.push(build.prNumber);
        if (pull.merged !== true) continue;
        if (!fullSha.test(pull.merge_commit_sha ?? '')) {
          fail(`issue ${issue}: merged PR lacks a full merge SHA`);
          continue;
        }
        const mergedAt = typeof pull.merged_at === 'string' ? Date.parse(pull.merged_at) : NaN;
        if (
          !Number.isFinite(mergedAt) ||
          mergedAt < build.createdAt ||
          mergedAt > input.finishedAt
        ) {
          fail(`issue ${issue}: expected a merge timestamp within the completed trial`);
          continue;
        }
        const closing = JSON.parse(
          await runner([
            'pr',
            'view',
            String(build.prNumber),
            '--repo',
            repo,
            '--json',
            'closingIssuesReferences',
          ]),
        );
        if (
          !closing.closingIssuesReferences?.some(
            (entry) =>
              entry.number === issue && entry.url === `https://github.com/${repo}/issues/${issue}`,
          )
        ) {
          fail(`issue ${issue}: PR must close the trial issue`);
          continue;
        }
        const comparison = await github(`compare/${pull.merge_commit_sha}...main`);
        if (!['ahead', 'identical'].includes(comparison?.status)) {
          fail(`issue ${issue}: merge commit is not reachable from main`);
          continue;
        }
        if (!ownExecution || !claimed.some((step) => step.status === 'done')) {
          fail(`issue ${issue}: merged PR needs completed execution on omarchy-orb`);
          continue;
        }
        if (todo.awaitingReply === true) {
          fail(`issue ${issue}: Thread is still awaiting a user reply`);
          continue;
        }
        if (liveIssue?.state !== 'closed' || liveIssue.state_reason !== 'completed') {
          fail(`issue ${issue}: merged trial issue must be closed as completed`);
          continue;
        }
        receipt.mergeCommit = pull.merge_commit_sha;
        receipt.mergedAt = mergedAt;
        receipt.reachableFromMain = true;
        row.merged = true;
      } catch {
        fail(`issue ${issue}: build/issue/machine/PR verification failed`);
      }
    }
    row.prs = [...new Set(row.prs)];
    if (!row.merged) {
      const reason = input.reasons?.[issue];
      if (!reasons.has(reason?.code) || typeof reason.detail !== 'string' || !reason.detail.trim())
        fail(`issue ${issue}: expected a fixed reason code and nonempty detail`);
      else row.reason = { code: reason.code, detail: reason.detail.trim() };
    }
    row.verified = before === failures.length;
    rows.push(row);
  }
  const total = rows.length;
  const merged = rows.filter((row) => row.merged && row.verified).length;
  if (total !== 20) fail(`denominator: expected 20 distinct issues, found ${total}`);
  if (merged < 10) fail(`merged: expected at least 10 reachable merged PRs, found ${merged}`);
  const canary = input.canary;
  const capture = canary?.result;
  const routes = capture?.routes;
  const blocked =
    ['directRead', 'symlinkPush', 'socketAndServer', 'sudoRead'].every(
      (name) => Array.isArray(routes?.[name]) && routes[name].length > 0,
    ) &&
    Object.values(routes).every(
      (entries) =>
        Array.isArray(entries) &&
        entries.length > 0 &&
        entries.every(
          (entry) =>
            entry?.blocked === true && typeof entry.target === 'string' && entry.target.length > 0,
        ),
    );
  if (
    !Number.isFinite(input.finishedAt) ||
    !Number.isFinite(canary?.checkedAt) ||
    canary.checkedAt < input.finishedAt ||
    capture?.ok !== true ||
    !blocked ||
    capture.pushedObjectsClean !== true ||
    capture.negativeObjectsContainMarker !== true ||
    capture.githubReach?.ok !== true ||
    !Array.isArray(capture.sentinelsRemaining) ||
    capture.sentinelsRemaining.length !== 0
  )
    fail(
      'canary: expected a successful post-trial capture with every host route blocked and no remaining sentinels',
    );
  return {
    ok: failures.length === 0,
    repo,
    finishedAt: input.finishedAt,
    canaryCheckedAt: canary?.checkedAt,
    total,
    merged,
    rows,
    failures,
  };
}

export function renderTrialTable(report) {
  const cell = (value) =>
    String(value)
      .replaceAll('|', '\\|')
      .replace(/[\r\n]+/g, ' ');
  return [
    '| Issue | Builds | PRs | Outcome |',
    '| --- | --- | --- | --- |',
    ...report.rows.map(
      (row) =>
        `| #${row.issue} | ${row.buildIds.map(cell).join(', ')} | ${row.prs.map((pr) => `#${pr}`).join(', ')} | ${row.merged && row.verified ? 'merged' : cell(row.reason ? `${row.reason.code}: ${row.reason.detail}` : 'verification_failed')} |`,
    ),
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    const check = args.includes('--check');
    const markdown = args.includes('--markdown');
    const paths = args.filter((arg) => !['--check', '--markdown'].includes(arg));
    if (paths.length !== 1 || paths[0].startsWith('--')) throw new Error('usage');
    const result = await buildTrialReport(JSON.parse(readFileSync(paths[0], 'utf8')));
    process.stdout.write(
      `${markdown ? renderTrialTable(result) : JSON.stringify(result, null, 2)}\n`,
    );
    if (check && !result.ok) process.exitCode = 1;
  } catch {
    process.stderr.write(
      'trial-report: expected [--check] [--markdown] INPUT.json and readable API evidence\n',
    );
    process.exitCode = 1;
  }
}
