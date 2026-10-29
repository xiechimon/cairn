import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

const exitCodes = { unknown: 2, complete: 0, paused: 20, failed: 30, incomplete: 10 };
const humanLabels = new Set(['needs-decision', 'waits-ian', 'ready-for-human']);
const shaPattern = /^[a-f0-9]{40}$/;
const isoPattern = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/;
const query = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { issue(number: $number) {
    number state stateReason
    labels(first: 100) { nodes { name } pageInfo { hasNextPage } }
    timelineItems(last: 1, itemTypes: [CLOSED_EVENT]) {
      nodes { ... on ClosedEvent { closer { __typename
        ... on PullRequest { merged mergeCommit { oid } }
        ... on Commit { oid }
      } } } pageInfo { hasNextPage }
    }
    closedByPullRequestsReferences(first: 100, includeClosedPrs: true) {
      nodes { number state labels(first: 100) { nodes { name } pageInfo { hasNextPage } } }
      pageInfo { hasNextPage }
    }
  } }
}`;
function requireFact(condition, message) {
  if (!condition) throw new Error(message);
}
function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0 && !value.includes('\0');
}
function isIso(value) {
  return typeof value === 'string' && isoPattern.test(value) && Number.isFinite(Date.parse(value));
}
function exactKeys(value, required, optional = []) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
  );
}
function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}
function unique(values, valid) {
  return Array.isArray(values) && values.every(valid) && new Set(values).size === values.length;
}
export function validateManifest(manifest, epic) {
  requireFact(
    exactKeys(manifest, ['epic', 'issues', 'requiredChecks', 'checks', 'maxHours']),
    'Invalid manifest',
  );
  const { issues, requiredChecks, checks, maxHours } = manifest;
  requireFact(
    manifest.epic === epic &&
      unique(issues, positiveInteger) &&
      issues.length > 0 &&
      unique(requiredChecks, nonempty) &&
      Array.isArray(checks) &&
      new Set(checks.map((check) => check?.name)).size === checks.length &&
      checks.every(
        (check) =>
          exactKeys(check, ['name', 'run'], ['expectStdoutIncludes']) &&
          nonempty(check.name) &&
          Array.isArray(check.run) &&
          nonempty(check.run[0]) &&
          check.run.every((arg) => typeof arg === 'string' && !arg.includes('\0')) &&
          (!Object.hasOwn(check, 'expectStdoutIncludes') ||
            typeof check.expectStdoutIncludes === 'string'),
      ) &&
      typeof maxHours === 'number' &&
      Number.isFinite(maxHours * 3600000) &&
      maxHours > 0,
    'Invalid manifest',
  );
  return manifest;
}
function nodes(connection, context) {
  requireFact(
    Array.isArray(connection?.nodes) && connection.pageInfo?.hasNextPage === false,
    `Missing or partial GitHub ${context}`,
  );
  return connection.nodes;
}
function labels(connection) {
  return nodes(connection, 'labels').map((label) => label.name);
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function parseShas(output) {
  const shas = output.trim() ? output.trim().split('\n') : [];
  const valid = unique(shas, (sha) => shaPattern.test(sha));
  requireFact(valid, 'Malformed git ancestry');
  return shas;
}
function issueBlocker({ number, state, stateReason, closingSha }, history) {
  if (state !== 'CLOSED') return `Issue #${number} is open.`;
  if (stateReason !== 'COMPLETED') return `Issue #${number} has closing reason ${stateReason}.`;
  if (!closingSha) return `Issue #${number} has no merged PR or closing commit.`;
  if (!history.includes(closingSha))
    return `Issue #${number} closing change ${closingSha} is not on main.`;
  return null;
}
function completionWindow({ issues, history, mainline, descendants }) {
  if (issues.some((issue) => issueBlocker(issue, history)))
    return { lastClosingSha: null, eligible: [] };
  const lastClosingSha = history.find((sha) => issues.some((issue) => issue.closingSha === sha));
  const eligible = mainline
    .filter((sha) => issues.every((issue) => descendants[issue.closingSha].includes(sha)))
    .slice(0, 30);
  requireFact(eligible[0] === history[0], 'Missing main ancestry after closure');
  return { lastClosingSha, eligible };
}
function requiredCheckFailures({ sha, runs }, requiredChecks) {
  return requiredChecks.flatMap((name) => {
    const matching = runs.filter((run) => run.name === name);
    if (!matching.length) return [`required check "${name}" has no run on ${sha}`];
    return matching.every((run) => run.status === 'completed' && run.conclusion === 'success')
      ? []
      : [`required check "${name}" is not successful on ${sha}`];
  });
}
export function decideEpic(facts) {
  try {
    const { manifest, issues, mainSha, commits, checks, worktree } = facts;
    const { now, startedAt, pause, fail } = facts;
    validateManifest(manifest, manifest?.epic);
    requireFact(
      issues.length === manifest.issues.length &&
        issues.every((issue, index) => issue.number === manifest.issues[index]) &&
        checks.length === manifest.checks.length,
      'Missing gathered facts',
    );
    const reasons = [];
    const waiting = [];
    if (!startedAt) reasons.push('No time cap: --started-at was not provided.');
    for (const issue of issues) {
      const blocker = issueBlocker(issue, facts.history);
      if (blocker) reasons.push(blocker);
      for (const label of issue.labels)
        if (humanLabels.has(label)) waiting.push(`Issue #${issue.number} carries ${label}.`);
      for (const pull of issue.linkedPulls)
        if (pull.state === 'OPEN')
          for (const label of pull.labels)
            if (humanLabels.has(label))
              waiting.push(`PR #${pull.number} for #${issue.number} carries ${label}.`);
    }
    const { lastClosingSha, eligible } = completionWindow(facts);
    const greenSha =
      commits.find((commit) => requiredCheckFailures(commit, manifest.requiredChecks).length === 0)
        ?.sha ?? null;
    requireFact(
      commits.length <= eligible.length &&
        commits.every((commit, index) => commit.sha === eligible[index]) &&
        (greenSha || commits.length === eligible.length),
      'Missing or reordered examined main commits',
    );
    if (lastClosingSha && !greenSha) {
      reasons.push(`No green main commit examined since ${lastClosingSha}.`);
      reasons.push(...requiredCheckFailures(commits[0], manifest.requiredChecks));
    }
    for (const check of checks)
      if (check.status !== 'passed')
        reasons.push(`Check "${check.name}" ${check.status.replace('-', ' ')}: ${check.reason}`);
    const clean = worktree.dirty === false && worktree.head === mainSha;
    if (!clean)
      reasons.push(`Working tree is dirty or not at inspected main ${mainSha}; checks not run.`);
    const elapsed =
      startedAt && Date.parse(now) - Date.parse(startedAt) >= manifest.maxHours * 3600000;
    let state = 'incomplete';
    if (lastClosingSha && greenSha && clean && checks.every((check) => check.status === 'passed')) {
      state = 'complete';
      reasons.push(`Every issue is completed on main; required checks passed at ${greenSha}.`);
    } else if (waiting.length || pause) {
      state = 'paused';
      reasons.push(...waiting);
      if (pause) reasons.push(`Paused: ${pause}`);
    } else if (fail || elapsed) {
      state = 'failed';
      if (fail) reasons.push(`Failed: ${fail}`);
      if (elapsed)
        reasons.push(`Time cap of ${manifest.maxHours} hours elapsed since ${startedAt}.`);
    }
    return { state, exitCode: exitCodes[state], reasons, greenSha, lastClosingSha };
  } catch (error) {
    return { state: 'unknown', exitCode: 2, reasons: [errorMessage(error)] };
  }
}
export async function main(argv, deps = {}) {
  const run = deps.run ?? execFileSync;
  const write = deps.write ?? console.log;
  const clock = deps.now ?? (() => new Date());
  let json = argv.includes('--json');
  let result;
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        ref: { type: 'string', default: 'origin/main' },
        repo: { type: 'string', default: 'xiechimon/cairn' },
        'started-at': { type: 'string' },
        pause: { type: 'string' },
        fail: { type: 'string' },
        json: { type: 'boolean', default: false },
      },
    });
    json = values.json;
    const [epic] = positionals;
    requireFact(
      positionals.length === 1 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(epic),
      'Expected one epic name',
    );
    requireFact(/^[\w.-]+\/[\w.-]+$/.test(values.repo), 'Expected --repo owner/name');
    requireFact(nonempty(values.ref) && !values.ref.startsWith('-'), 'Invalid --ref');
    requireFact(
      values['started-at'] === undefined || isIso(values['started-at']),
      'Invalid --started-at ISO timestamp',
    );
    for (const name of ['pause', 'fail'])
      requireFact(values[name] === undefined || nonempty(values[name]), `Invalid --${name} reason`);
    const options = { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: false };
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
    const manifest = validateManifest(
      JSON.parse(git(['show', `${values.ref}:.claude/epics/${epic}.json`])),
      epic,
    );
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
    } catch {
      throw new Error(`Remote main ${mainSha} is unavailable locally; run git fetch origin main.`);
    }
    const [owner, name] = values.repo.split('/');
    const issues = manifest.issues.map((number) => {
      const payload = api(
        ['graphql', '--input', '-'],
        JSON.stringify({ query, variables: { owner, name, number } }),
      );
      requireFact(!payload.errors, 'GitHub GraphQL errors or partial data');
      const issue = payload.data?.repository?.issue;
      requireFact(issue?.number === number, `Missing or malformed issue #${number}`);
      const events = nodes(issue.timelineItems, 'closing events');
      requireFact(
        events.length <= 1 && (issue.state !== 'CLOSED' || events.length === 1),
        `Missing last closing event for #${number}`,
      );
      let closingSha = null;
      const closer = events.length ? events[0]?.closer : null;
      if (closer !== null) {
        requireFact(
          ['PullRequest', 'Commit'].includes(closer?.__typename),
          'Malformed issue closer',
        );
        if (closer.__typename === 'Commit' || closer.merged === true) {
          closingSha = closer.__typename === 'Commit' ? closer.oid : closer.mergeCommit?.oid;
          requireFact(shaPattern.test(closingSha), 'Missing closing commit');
        }
      }
      return {
        number,
        state: issue.state,
        stateReason: issue.stateReason,
        labels: labels(issue.labels),
        closingSha,
        linkedPulls: nodes(issue.closedByPullRequestsReferences, 'linked PRs').map((pull) => {
          requireFact(positiveInteger(pull?.number), `Malformed linked PR for #${number}`);
          return { number: pull.number, state: pull.state, labels: labels(pull.labels) };
        }),
      };
    });
    requireFact(
      git(['rev-parse', '--is-shallow-repository']).trim() === 'false',
      'Partial git history: shallow repository',
    );
    const history = parseShas(git(['rev-list', '--topo-order', mainSha]));
    requireFact(history[0] === mainSha, 'Partial main git history');
    const mainline = parseShas(git(['rev-list', '--first-parent', mainSha]));
    const descendants = {};
    for (const sha of new Set(issues.map((issue) => issue.closingSha))) {
      if (!history.includes(sha)) continue;
      descendants[sha] = [
        sha,
        ...parseShas(git(['rev-list', '--ancestry-path', `${sha}..${mainSha}`])),
      ];
    }
    const { eligible } = completionWindow({ issues, history, mainline, descendants });
    const commits = [];
    for (const sha of eligible) {
      const pages = api([
        '--paginate',
        '--slurp',
        `repos/${values.repo}/commits/${sha}/check-runs?per_page=100&filter=latest`,
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
      if (requiredCheckFailures(commit, manifest.requiredChecks).length === 0) break;
    }
    const snapshot = () => {
      const head = git(['rev-parse', '--verify', 'HEAD']).trim();
      requireFact(shaPattern.test(head), 'Malformed working tree HEAD');
      return { head, dirty: git(['status', '--porcelain=v1', '--untracked-files=all']).length > 0 };
    };
    let worktree = snapshot();
    const checks = [];
    for (const check of manifest.checks) {
      const result = {
        name: check.name,
        status: 'not-run',
        reason: 'Requires a clean working tree at remote main.',
      };
      checks.push(result);
      if (worktree.dirty || worktree.head !== mainSha) continue;
      try {
        result.stdout = execute(check.run[0], check.run.slice(1), { timeout: 900_000 });
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
        result.reason = timedOut ? 'Command timed out after 900 seconds.' : errorMessage(error);
      }
      worktree = snapshot();
    }
    if (worktree.dirty || worktree.head !== mainSha)
      for (const check of checks) {
        check.status = 'not-run';
        check.reason = 'Results invalidated: local tree is dirty or HEAD moved.';
      }
    const facts = {
      manifest,
      issues,
      mainSha,
      history,
      mainline,
      descendants,
      commits,
      checks,
      worktree,
      now: clock().toISOString(),
      startedAt: values['started-at'] ?? null,
      pause: values.pause ?? null,
      fail: values.fail ?? null,
    };
    result = { ...decideEpic(facts), checks, facts };
  } catch (error) {
    result = { state: 'unknown', exitCode: 2, reasons: [errorMessage(error)], checks: [] };
  }
  write(
    json
      ? JSON.stringify(result, null, 2)
      : [`state: ${result.state}`, ...result.reasons].join('\n'),
  );
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  process.exitCode = (await main(process.argv.slice(2))).exitCode;
}
