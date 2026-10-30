import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  decideEpic,
  errorMessage,
  isoPattern,
  labels,
  nodes,
  nonempty,
  parseShas,
  positiveInteger,
  requireFact,
  shaPattern,
  unique,
  validateManifest,
} from '../.claude/epics/checker-policy.mjs';

export { decideEpic, validateManifest } from '../.claude/epics/checker-policy.mjs';

const query = `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { issue(number: $number) {
  number state stateReason labels(first: 100) { nodes { name } pageInfo { hasNextPage } }
  timelineItems(last: 1, itemTypes: [CLOSED_EVENT]) { nodes { ... on ClosedEvent { createdAt closer {
    __typename ... on PullRequest { number merged mergedAt mergeCommit { oid } } ... on Commit { oid }
  } } } }
  closedByPullRequestsReferences(first: 100, includeClosedPrs: true) { nodes { number state isDraft merged mergeCommit { oid } labels(first: 100) { nodes { name } pageInfo { hasNextPage } } } pageInfo { hasNextPage } }
} } }`;
export async function main(argv, deps = {}) {
  const run = deps.run ?? execFileSync;
  const write = deps.write ?? console.log;
  const clock = deps.now ?? (() => new Date());
  const json = argv.includes('--json');
  let result;
  let persistResult;
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        ref: { type: 'string' },
        state: { type: 'string' },
        repo: { type: 'string', default: 'xiechimon/cairn' },
        'started-at': { type: 'string' },
        pause: { type: 'string' },
        fail: { type: 'string' },
        json: { type: 'boolean', default: false },
      },
    });
    const [epic] = positionals;
    requireFact(
      positionals.length === 1 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(epic),
      'Expected one epic name',
    );
    requireFact(/^[\w.-]+\/[\w.-]+$/.test(values.repo), 'Expected --repo owner/name');
    requireFact(
      values.ref === undefined || (nonempty(values.ref) && !values.ref.startsWith('-')),
      'Invalid --ref',
    );
    const startedAt = values['started-at'];
    requireFact(
      startedAt === undefined ||
        (isoPattern.test(startedAt) && Number.isFinite(Date.parse(startedAt))),
      'Invalid --started-at ISO timestamp',
    );
    for (const name of ['pause', 'fail'])
      requireFact(values[name] === undefined || nonempty(values[name]), `Invalid --${name} reason`);
    const statePath = resolve(
      values.state ?? join(homedir(), '.claude', 'plans', epic, 'state.json'),
    );
    const timestamp = clock().toISOString();
    let persisted;
    try {
      persisted = JSON.parse(readFileSync(statePath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (persisted !== undefined)
      requireFact(
        persisted !== null &&
          ['unknown', 'complete', 'paused', 'failed', 'incomplete'].includes(persisted.phase) &&
          isoPattern.test(persisted.startedAt) &&
          Number.isFinite(Date.parse(persisted.startedAt)) &&
          isoPattern.test(persisted.updatedAt) &&
          Number.isFinite(Date.parse(persisted.updatedAt)) &&
          Number.isFinite(persisted.activeHours) &&
          persisted.activeHours >= 0 &&
          persisted.failureHistory &&
          typeof persisted.failureHistory === 'object' &&
          !Array.isArray(persisted.failureHistory),
        'Invalid persisted state',
      );
    requireFact(
      persisted !== undefined || startedAt !== undefined,
      'Missing state requires --started-at',
    );
    const originalStart = persisted?.startedAt ?? startedAt;
    const activeHours =
      (persisted?.activeHours ?? 0) +
      (!persisted || ['incomplete', 'unknown'].includes(persisted.phase)
        ? Math.max(0, Date.parse(timestamp) - Date.parse(persisted?.updatedAt ?? originalStart)) /
          3600000
        : 0);
    persistResult = (decision) => {
      const failureHistory = Object.assign(Object.create(null), persisted?.failureHistory ?? {});
      for (const item of decision.items ?? []) {
        if (item.status === 'done') continue;
        const entries = failureHistory[item.id] ?? [];
        requireFact(Array.isArray(entries), 'Invalid item failure history');
        failureHistory[item.id] = [
          ...entries,
          { at: timestamp, status: item.status, reasons: decision.reasons },
        ];
      }
      const next = {
        phase: decision.state,
        pauseReason: ['paused', 'failed'].includes(decision.state) ? decision.reasons.at(-1) : null,
        startedAt: originalStart,
        activeHours: decision.facts?.activeHours ?? activeHours,
        updatedAt: decision.facts?.now ?? timestamp,
        failureHistory,
      };
      mkdirSync(dirname(statePath), { recursive: true });
      const temporaryState = `${statePath}.${process.pid}.tmp`;
      try {
        writeFileSync(temporaryState, `${JSON.stringify(next, null, 2)}\n`, {
          flag: 'wx',
          mode: 0o600,
        });
        renameSync(temporaryState, statePath);
      } finally {
        rmSync(temporaryState, { force: true });
      }
    };
    persistResult({
      state: persisted?.phase ?? 'incomplete',
      reasons: [persisted?.pauseReason],
      items: [],
    });
    const options = { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: false };
    options.stdio = ['pipe', 'pipe', 'pipe'];
    const execute = (file, args, extra = {}) => {
      const stdout = run(file, args, { ...options, ...extra });
      requireFact(typeof stdout === 'string', `Malformed runner output for ${file}`);
      return stdout;
    };
    const git = (args) => execute('git', args);
    const api = (args, input) => JSON.parse(execute('gh', ['api', ...args], { input }));
    const root = git(['rev-parse', '--show-toplevel']).trim();
    requireFact(nonempty(root), 'Missing git working tree root');
    options.cwd = root;
    const ref = api([`repos/${values.repo}/git/ref/heads/main`]);
    requireFact(
      ref?.ref === 'refs/heads/main' &&
        ref.object?.type === 'commit' &&
        shaPattern.test(ref.object.sha),
      'Missing remote main SHA',
    );
    const mainSha = ref.object.sha;
    try {
      git(['cat-file', '-e', `${mainSha}^{commit}`]);
    } catch (error) {
      throw new Error(`git fetch origin main (${mainSha}): ${errorMessage(error)}`);
    }
    let manifestRef = mainSha;
    if (values.ref !== undefined)
      try {
        manifestRef = git(['rev-parse', '--verify', `${values.ref}^{commit}`]).trim();
        requireFact(shaPattern.test(manifestRef), 'Malformed manifest commit');
        git(['merge-base', '--is-ancestor', manifestRef, mainSha]);
      } catch (error) {
        throw new Error(`Untrusted ref "${values.ref}": ${errorMessage(error)}`);
      }
    const manifestSource = git(['show', `${mainSha}:.claude/epics/${epic}.json`]);
    if (values.ref !== undefined)
      requireFact(
        git(['show', `${manifestRef}:.claude/epics/${epic}.json`]) === manifestSource,
        'Selected ref manifest differs from main',
      );
    const manifest = validateManifest(JSON.parse(manifestSource), epic);
    const [owner, name] = values.repo.split('/');
    const issues = (manifest.issues ?? manifest.items.map((item) => item.issue)).map((number) => {
      const payload = api(
        ['graphql', '--input', '-'],
        JSON.stringify({ query, variables: { owner, name, number } }),
      );
      requireFact(!payload.errors, 'GitHub GraphQL errors or partial data');
      const issue = payload.data?.repository?.issue;
      requireFact(issue?.number === number, `Missing or malformed issue #${number}`);
      const events = issue.timelineItems?.nodes;
      requireFact(
        Array.isArray(events) &&
          events.length <= 1 &&
          (issue.state !== 'CLOSED' || events.length === 1),
        `Missing last closing event for #${number}`,
      );
      let closingSha = null;
      const closer = events.length ? events[0]?.closer : null;
      if (closer !== null) {
        requireFact(['PullRequest', 'Commit'].includes(closer?.__typename), 'Malformed closer');
        if (closer.__typename === 'Commit' || closer.merged === true) {
          closingSha = closer.__typename === 'Commit' ? closer.oid : closer.mergeCommit?.oid;
          requireFact(shaPattern.test(closingSha), 'Missing closing commit');
        }
      }
      const linkedPulls = nodes(issue.closedByPullRequestsReferences, 'linked PRs');
      const mergedPull = closer?.__typename === 'PullRequest' && closer.merged ? closer : null;
      return {
        mergedPr: positiveInteger(mergedPull?.number),
        pr: mergedPull?.number ?? linkedPulls.find((pull) => pull.state === 'OPEN')?.number ?? null,
        number,
        state: issue.state,
        stateReason: issue.stateReason,
        labels: labels(issue.labels),
        closingSha,
        closingAt: mergedPull ? mergedPull.mergedAt : events[0]?.createdAt,
        linkedPulls: linkedPulls.map((pull) => {
          requireFact(positiveInteger(pull?.number), `Malformed linked PR for #${number}`);
          return {
            number: pull.number,
            state: pull.state,
            isDraft: pull.isDraft,
            labels: labels(pull.labels),
          };
        }),
      };
    });
    requireFact(
      git(['rev-parse', '--is-shallow-repository']).trim() === 'false',
      'Partial git history: shallow repository',
    );
    const history = parseShas(git(['rev-list', '--topo-order', mainSha]));
    const historySet = new Set(history);
    requireFact(history[0] === mainSha, 'Partial main git history');
    const mainline = parseShas(git(['rev-list', '--first-parent', mainSha]));
    const descendants = {};
    for (const sha of new Set(issues.map((issue) => issue.closingSha))) {
      if (!historySet.has(sha)) continue;
      descendants[sha] = [
        sha,
        ...parseShas(git(['rev-list', '--ancestry-path', `${sha}..${mainSha}`])),
      ];
    }
    const ancestry = { issues, history, mainline, descendants };
    const commits = [];
    for (const sha of [mainSha]) {
      const pages = api([
        '--paginate',
        '--slurp',
        `repos/${values.repo}/commits/${sha}/check-runs?per_page=100&filter=all`,
      ]);
      requireFact(Array.isArray(pages) && pages.length > 0, `Missing check pages for ${sha}`);
      const total = pages[0]?.total_count;
      requireFact(Number.isSafeInteger(total) && total >= 0, `Malformed check count for ${sha}`);
      const runs = pages.flatMap((page) => {
        requireFact(
          page?.total_count === total && Array.isArray(page.check_runs),
          `Malformed check page for ${sha}`,
        );
        return page.check_runs;
      });
      const ids = runs.map((run) => run?.id);
      requireFact(
        runs.length === total &&
          unique(ids, positiveInteger) &&
          runs.every((run) => run.head_sha === sha && nonempty(run.name)),
        `Partial or malformed check runs for ${sha}`,
      );
      const commit = { sha, runs };
      commits.push(commit);
    }
    const temporary = mkdtempSync(join(tmpdir(), 'epic-done-'));
    const worktreePath = join(temporary, 'main');
    let checks;
    try {
      git(['-c', 'core.hooksPath=/dev/null', 'worktree', 'add', '--detach', worktreePath, mainSha]);
      const head = execute('git', ['rev-parse', '--verify', 'HEAD'], { cwd: worktreePath }).trim();
      requireFact(head === mainSha, `Temporary worktree HEAD does not match main ${mainSha}`);
      const checkOptions = { cwd: worktreePath, timeout: 900_000 };
      checks = manifest.checks.map((check) => {
        const result = { name: check.name };
        try {
          result.stdout = execute(check.run[0], check.run.slice(1), checkOptions);
          const passed = result.stdout.includes(check.expectStdoutIncludes ?? '');
          result.status = passed ? 'passed' : 'failed';
          result.reason = passed ? null : 'Expected stdout substring is missing.';
        } catch (error) {
          const timedOut = error?.code === 'ETIMEDOUT';
          if (
            !timedOut &&
            error?.code !== 'ENOENT' &&
            !(Number.isInteger(error?.status) && error.status !== 0)
          )
            throw error;
          result.status = 'failed';
          result.reason = `${timedOut ? 'Command timed out after 900 seconds. ' : ''}${errorMessage(error)}`;
        }
        return result;
      });
    } finally {
      try {
        git(['worktree', 'remove', '--force', worktreePath]);
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
    }
    const observedAt = clock().toISOString();
    const facts = {
      manifest,
      mainSha,
      ...ancestry,
      commits,
      checks,
      now: observedAt,
      startedAt: originalStart,
      activeHours:
        activeHours + Math.max(0, Date.parse(observedAt) - Date.parse(timestamp)) / 3600000,
      pause: values.pause ?? null,
      fail: values.fail ?? (persisted?.phase === 'failed' ? persisted.pauseReason : null),
    };
    result = { ...decideEpic(facts), checks, facts };
    persistResult(result);
  } catch (error) {
    result = {
      state: 'unknown',
      exitCode: 2,
      reasons: [errorMessage(error)],
      checks: [],
      items: [],
      humanHeld: [],
      needsOwner: [],
      blocked: [],
      ready: [],
      mainSha: null,
      mainGreen: false,
    };
    try {
      persistResult?.(result);
    } catch (stateError) {
      result.reasons.push(errorMessage(stateError));
    }
  }
  const text = [`state: ${result.state}`, ...result.reasons].join('\n');
  write(json ? JSON.stringify(result, null, 2) : text);
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename)
  process.exitCode = (await main(process.argv.slice(2))).exitCode;
