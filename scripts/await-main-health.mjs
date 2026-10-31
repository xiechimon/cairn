import { pathToFileURL } from 'node:url';

export const REQUIRED_CHECKS = ['check', 'e2e-gate'];
const ACTIONS_APP_SLUG = 'github-actions';
export const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;
export const DEFAULT_INTERVAL_MS = 30 * 1000;

export function latestRunByName(checkRuns, name) {
  const matching = checkRuns.filter(
    (run) => run.name === name && run.app?.slug === ACTIONS_APP_SLUG,
  );
  if (matching.length === 0) return null;
  return matching.reduce((latest, run) => (run.id > latest.id ? run : latest));
}

export function decideMainHealth(checkRuns, required = REQUIRED_CHECKS) {
  const red = [];
  const pending = [];
  const missing = [];
  for (const name of required) {
    const run = latestRunByName(checkRuns, name);
    if (run === null) missing.push(name);
    else if (run.status !== 'completed') pending.push(name);
    else if (run.conclusion !== 'success') red.push(`${name}=${run.conclusion}`);
  }
  if (red.length > 0) return { verdict: 'red', detail: red.join(', ') };
  if (missing.length > 0) return { verdict: 'missing', detail: missing.join(', ') };
  if (pending.length > 0) return { verdict: 'pending', detail: pending.join(', ') };
  return { verdict: 'success', detail: required.join(', ') };
}

export async function awaitMainHealth({
  fetchCheckRuns,
  sleep,
  now = Date.now,
  required = REQUIRED_CHECKS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  intervalMs = DEFAULT_INTERVAL_MS,
  log = () => {},
}) {
  const deadline = now() + timeoutMs;
  for (;;) {
    let decision;
    try {
      decision = decideMainHealth(await fetchCheckRuns(), required);
    } catch (error) {
      decision = { verdict: 'error', detail: error.message };
    }
    log(`${decision.verdict}: ${decision.detail}`);
    if (decision.verdict === 'success') return { ok: true, ...decision };
    if (decision.verdict === 'red') return { ok: false, ...decision };
    if (now() + intervalMs > deadline) {
      return { ok: false, verdict: `timeout-${decision.verdict}`, detail: decision.detail };
    }
    await sleep(intervalMs);
  }
}

export function githubCheckRunsFetcher({ repo, sha, token, required = REQUIRED_CHECKS }) {
  return async () => {
    const runs = [];
    for (const name of required) {
      const url = `https://api.github.com/repos/${repo}/commits/${sha}/check-runs?check_name=${encodeURIComponent(name)}&per_page=100`;
      const response = await fetch(url, {
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
        },
      });
      if (!response.ok) {
        throw new Error(`check-runs request for ${name} failed: ${response.status}`);
      }
      runs.push(...(await response.json()).check_runs);
    }
    return runs;
  };
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const repo = option('repo') ?? process.env.GITHUB_REPOSITORY;
  const sha = option('sha') ?? process.env.GITHUB_SHA;
  const token = process.env.GH_TOKEN;
  if (!repo || !sha || !token) {
    console.error('GITHUB_REPOSITORY (or --repo), GITHUB_SHA (or --sha) and GH_TOKEN are required');
    process.exit(2);
  }
  const timeoutMs = Number(option('timeout-ms') ?? DEFAULT_TIMEOUT_MS);
  const intervalMs = Number(option('interval-ms') ?? DEFAULT_INTERVAL_MS);
  const result = await awaitMainHealth({
    fetchCheckRuns: githubCheckRunsFetcher({ repo, sha, token }),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    timeoutMs,
    intervalMs,
    log: (line) => console.log(`[main-health ${sha.slice(0, 9)}] ${line}`),
  });
  if (!result.ok) {
    console.error(`Refusing to publish: ${result.verdict} (${result.detail})`);
    process.exit(1);
  }
  console.log(`Main is healthy at ${sha}: ${result.detail} succeeded`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Refusing to publish: ${error.message}`);
    process.exit(1);
  });
}
