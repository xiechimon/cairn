import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function runGh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

export async function checkTrialEvidence(evidence, options = {}) {
  const { runner = runGh, env = process.env, fetchImpl = fetch, buildTrailerFor } = options;
  const failures = [];
  const lines = [];
  const check = (name, valid, message) => {
    if (!valid) failures.push(`${name}: ${message}`);
  };
  const e = evidence && typeof evidence === 'object' && !Array.isArray(evidence) ? evidence : {};
  const repo = e.repo ?? 'xiechimon/cairn';
  check('repo', typeof repo === 'string' && /^[\w-]+\/[\w.-]+$/.test(repo), 'expected owner/name');
  for (const name of ['issue', 'pr']) {
    check(name, Number.isSafeInteger(e[name]) && e[name] > 0, 'expected a positive issue number');
  }
  for (const name of ['buildId', 'conversationId', 'machinectlStatus']) {
    check(
      name,
      typeof e[name] === 'string' && e[name].trim().length > 0,
      'expected a nonempty string',
    );
  }
  check('orbName', e.orbName === `cairn-orb-${e.conversationId}`, 'must match the conversation ID');
  check(
    'mergeCommit',
    typeof e.mergeCommit === 'string' && /^[a-f0-9]{40}$/.test(e.mergeCommit),
    'expected a full commit SHA',
  );
  for (const name of ['labelsBefore', 'labelsAfter']) {
    check(
      name,
      Array.isArray(e[name]) && e[name].every((label) => typeof label === 'string'),
      'expected a string array',
    );
  }
  if (Array.isArray(e.labelsAfter) && e.labelsAfter.every((label) => typeof label === 'string')) {
    const labels = e.labelsAfter.map((label) => label.toLowerCase());
    check(
      'labelsAfter',
      labels.includes('by:cairn') &&
        !labels.some(
          (label) =>
            (label.startsWith('by:') && label !== 'by:cairn') || label.startsWith('batch:'),
        ),
      'must include by:cairn, no other by:* and no batch:*',
    );
  }
  for (const name of ['pending', 'mine', 'hold']) {
    const list = e.lanesAfter?.[name];
    check(
      'lanesAfter',
      Array.isArray(list) &&
        list.every(
          (n) => (Number.isSafeInteger(n) && n > 0) || (typeof n === 'string' && /^\d+$/.test(n)),
        ) &&
        !list.some((n) => Number(n) === e.issue),
      `${name} must be an issue-number list without the trial issue`,
    );
  }
  check(
    'hostWorkspaceAbsent',
    e.hostWorkspaceAbsent === true,
    'the host absence check must be true',
  );
  check(
    'hostWorkspacePath',
    typeof e.hostWorkspacePath === 'string' &&
      isAbsolute(e.hostWorkspacePath) &&
      basename(e.hostWorkspacePath) === e.conversationId,
    'expected the absolute host workspace path ending in conversationId',
  );
  check('claimedMachineId', e.claimedMachineId === 'omarchy-orb', 'must be omarchy-orb');
  if (failures.length > 0) return { ok: false, failures, lines: [...failures] };

  async function github(name, path, verify) {
    try {
      verify(JSON.parse(await runner(['api', `repos/${repo}/${path}`])));
    } catch {
      failures.push(`${name}: GitHub read failed`);
    }
  }

  await github('pr', `pulls/${e.pr}`, (pull) => {
    check('pr-merged', pull.merged === true, 'PR is not merged');
    check(
      'merge-commit',
      pull.merge_commit_sha === e.mergeCommit,
      'PR merge commit differs from evidence',
    );
  });
  await github('issue', `issues/${e.issue}`, (issue) => {
    check(
      'issue-completed',
      issue.state === 'closed' && issue.state_reason === 'completed',
      'issue must be closed as completed',
    );
  });
  await github('main', `compare/${e.mergeCommit}...main`, (comparison) => {
    check(
      'main-reachable',
      ['ahead', 'identical'].includes(comparison.status),
      'merge commit is not reachable from main',
    );
  });
  await github('commit', `commits/${e.mergeCommit}`, (commit) => {
    if (!buildTrailerFor) {
      failures.push(
        'build-trailer-contract-unavailable: base 3980d6f46 has no B1 build trailer writer; identify the exact contract before certifying trial-one',
      );
      return;
    }
    const expected = buildTrailerFor(e.buildId);
    check(
      'build-trailer',
      typeof expected === 'string' &&
        expected.length > 0 &&
        typeof commit.commit?.message === 'string' &&
        commit.commit.message.split(/\r?\n/).includes(expected),
      'merge commit lacks the exact build trailer',
    );
  });

  if (!env.CAIRN_SERVER_URL) {
    lines.push('server: skipped (no CAIRN_SERVER_URL)');
  } else {
    try {
      const base = env.CAIRN_SERVER_URL.replace(/\/$/, '');
      async function server(path) {
        const response = await fetchImpl(`${base}${path}`, {
          headers: env.CAIRN_API_TOKEN ? { authorization: `Bearer ${env.CAIRN_API_TOKEN}` } : {},
          redirect: 'error',
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) throw new Error('server request failed');
        return response.json();
      }
      const build = await server(`/api/builds/${encodeURIComponent(e.buildId)}`);
      const steps = await server(`/api/builds/${encodeURIComponent(e.buildId)}/steps`);
      const todo = await server(`/api/todos/${encodeURIComponent(build.todoId)}`);
      const machines = await server(`/api/teams/${encodeURIComponent(todo.teamId)}/machines`);
      const matching = machines.filter((machine) => machine.name === e.claimedMachineId);
      check(
        'server-build',
        build.id === e.buildId &&
          e.conversationId === e.buildId &&
          todo.sourceRef?.toLowerCase() === `github:${repo}#${e.issue}`.toLowerCase(),
        'server build must belong to the trial issue and conversation',
      );
      const buildSteps = steps.filter(
        (step) =>
          step.kind === 'build' &&
          step.buildId === e.buildId &&
          step.machineId !== null &&
          step.machineId !== undefined,
      );
      check(
        'server-machine',
        matching.length === 1 &&
          buildSteps.length > 0 &&
          buildSteps.every((step) => step.machineId === matching[0].id),
        'claimed build steps must resolve to omarchy-orb',
      );
      lines.push('server: checked');
    } catch {
      failures.push('server: API verification failed');
    }
  }
  lines.push(...failures);
  if (failures.length === 0) lines.push('trial-one: ok');
  return { ok: failures.length === 0, failures, lines };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error('expected one evidence JSON path');
    const result = await checkTrialEvidence(JSON.parse(readFileSync(process.argv[2], 'utf8')));
    process.stdout.write(`${result.lines.join('\n')}\n`);
    process.exitCode = result.ok ? 0 : 1;
  } catch {
    process.stdout.write('evidence-file: expected a readable evidence JSON file\n');
    process.exitCode = 1;
  }
}
