import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GATE_CHECK } from './codex-gate-core.mjs';

export const STALE_AFTER_MS = 12 * 60 * 1000;
export const SCHEDULE_AFTER_MS = 20 * 60 * 1000;
export const GATE_WORKFLOW = 'review-gate.yml';

function gh(args, input) {
  const result = spawnSync(
    'gh',
    args,
    input === undefined ? { encoding: 'utf8' } : { encoding: 'utf8', input: JSON.stringify(input) },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || 'gh failed');
  return result.stdout;
}

function ghJson(args) {
  return JSON.parse(gh(args));
}

function listPaged(path) {
  return JSON.parse(
    gh(['api', '--paginate', '--slurp', `${path}${path.includes('?') ? '&' : '?'}per_page=100`]),
  ).flat();
}

function parseTime(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    throw new Error(`malformed ${label}`);
  return Date.parse(value);
}

export function newestOwnCheck(checkRuns, sha, now) {
  if (!Array.isArray(checkRuns)) throw new Error('malformed check-runs response');
  const own = checkRuns.filter(
    (run) =>
      run?.name === GATE_CHECK &&
      run?.app?.slug === 'github-actions' &&
      run?.head_sha === sha &&
      run?.status === 'in_progress',
  );
  let newest = null;
  for (const run of own) {
    const started = parseTime(run.started_at, 'check-run started_at');
    if (!Number.isSafeInteger(run.id)) throw new Error('malformed check-run id');
    if (
      newest === null ||
      started > newest.started ||
      (started === newest.started && run.id > newest.id)
    )
      newest = { id: run.id, started };
  }
  return newest !== null && now - newest.started >= STALE_AFTER_MS ? newest : null;
}

export function newestSchedule(runs, now) {
  if (!Array.isArray(runs)) throw new Error('malformed workflow-runs response');
  let newest = 0;
  for (const run of runs) {
    if (run?.event !== 'schedule') continue;
    const at = parseTime(run.created_at, 'schedule run created_at');
    newest = Math.max(newest, at);
  }
  return now - newest >= SCHEDULE_AFTER_MS ? newest : null;
}

export function watchdog(repo, env = process.env) {
  const now = parseTime(env.CAIRN_WATCHDOG_NOW ?? new Date().toISOString(), 'watchdog time');
  const statePath = env.CAIRN_WATCHDOG_STATE;
  const state = statePath === undefined ? null : readState(statePath);
  const pulls = listPaged(`repos/${repo}/pulls?state=open`);
  if (!Array.isArray(pulls)) throw new Error('malformed pull list');
  const stale = [];
  for (const pr of pulls) {
    if (pr.draft || pr.state !== 'open' || typeof pr.head?.sha !== 'string') continue;
    const runs = ghJson([
      'api',
      `repos/${repo}/commits/${pr.head.sha}/check-runs?check_name=${GATE_CHECK}&filter=latest`,
    ]);
    if (!Array.isArray(runs?.check_runs)) throw new Error('malformed check-runs response');
    const staleCheck = newestOwnCheck(runs.check_runs, pr.head.sha, now);
    if (staleCheck !== null) stale.push({ pr: pr.number, sha: pr.head.sha, check: staleCheck });
  }
  const runs = listPaged(`repos/${repo}/actions/workflows/${GATE_WORKFLOW}/runs?event=schedule`);
  const staleSchedule = newestSchedule(runs, now);
  const dispatched = { ...(state?.dispatched ?? {}) };
  const cutoff = now - 60 * 60 * 1000;
  for (const [key, value] of Object.entries(dispatched)) {
    if (!Number.isFinite(value) || value < cutoff) delete dispatched[key];
  }
  let changed = false;
  for (const entry of stale) {
    const key = `${entry.pr}:${entry.sha}:${entry.check.id}`;
    if (dispatched[key] !== undefined) continue;
    gh(
      [
        'api',
        '--method',
        'POST',
        `repos/${repo}/actions/workflows/${GATE_WORKFLOW}/dispatches`,
        '--input',
        '-',
      ],
      { ref: 'main', inputs: { pr: String(entry.pr) } },
    );
    dispatched[key] = now;
    changed = true;
  }
  if (statePath !== undefined && changed) {
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, `${JSON.stringify({ dispatched })}\n`);
  }
  if (staleSchedule !== null)
    throw new Error(
      `review-gate schedule is stale; newest schedule run at ${new Date(staleSchedule).toISOString()}`,
    );
}

function readState(path) {
  try {
    const state = JSON.parse(readFileSync(path, 'utf8'));
    return state && typeof state === 'object' && !Array.isArray(state) ? state : {};
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`malformed watchdog state: ${error.message}`);
  }
}

function main(argv, env) {
  if (argv.length !== 0) throw new Error('usage: codex-gate-watchdog.mjs');
  for (const key of ['GH_TOKEN', 'REPO']) if (!env[key]) throw new Error(`${key} is required`);
  watchdog(env.REPO, env);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2), process.env);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
