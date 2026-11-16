import { pathToFileURL } from 'node:url';

export const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;
export const DEFAULT_INTERVAL_MS = 30 * 1000;

export function decideMainHealth(run) {
  if (!run) return { verdict: 'missing', detail: 'main push CI' };
  if (run.status !== 'completed') return { verdict: 'pending', detail: run.status };
  if (run.conclusion !== 'success') return { verdict: 'red', detail: run.conclusion };
  return { verdict: 'success', detail: 'main push CI' };
}

export async function awaitMainHealth({
  fetchRun,
  sleep,
  now = Date.now,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  intervalMs = DEFAULT_INTERVAL_MS,
  log = () => {},
}) {
  const deadline = now() + timeoutMs;
  for (;;) {
    let decision;
    try {
      decision = decideMainHealth(await fetchRun());
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

export function githubMainRunFetcher({ repo, sha, token }) {
  return async () => {
    const url = `https://api.github.com/repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${sha}&branch=main&event=push&per_page=1`;
    const response = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      },
    });
    if (!response.ok) {
      throw new Error(`main CI request failed: ${response.status}`);
    }
    const run = (await response.json()).workflow_runs[0];
    if (!run || run.head_sha !== sha || run.head_branch !== 'main' || run.event !== 'push')
      return null;
    return run;
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
    fetchRun: githubMainRunFetcher({ repo, sha, token }),
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
