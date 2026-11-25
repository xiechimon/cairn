import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function usage() {
  console.error(
    'usage: github-ci-evidence.mjs --repo <owner/repo> --sha <40hex> --required <a,b,c> --state <dir>',
  );
  process.exit(2);
}

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const repo = args.get('--repo');
const sha = args.get('--sha');
const required = (args.get('--required') ?? '').split(',').filter(Boolean);
const state = args.get('--state');
if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') || !/^[0-9a-f]{40}$/.test(sha ?? '') || !state) usage();
const apiBase = (process.env.CAIRN_GITHUB_API_BASE ?? 'https://api.github.com').replace(/\/$/, '');
const cacheDir = join(state, 'github-evidence');
const cachePath = join(cacheDir, `${sha}.json`);
try {
  const cached = JSON.parse(readFileSync(cachePath, 'utf8'));
  if (cached.green === true) process.exit(0);
} catch {}

async function fetchJson(path) {
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'cairn-self-deploy',
    'x-github-api-version': '2022-11-28',
  };
  if (process.env.CAIRN_GITHUB_TOKEN)
    headers.authorization = `Bearer ${process.env.CAIRN_GITHUB_TOKEN}`;
  const response = await fetch(`${apiBase}${path}`, {
    headers,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${path}`);
  return response.json();
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

try {
  const runQuery = new URLSearchParams({
    branch: 'main',
    event: 'push',
    head_sha: sha,
    per_page: '1',
  });
  const runs = await fetchJson(`/repos/${repo}/actions/workflows/ci.yml/runs?${runQuery}`);
  const run = runs.workflow_runs?.[0];
  const bound = [run?.head_sha, run?.head_branch, run?.event, run?.status, run?.conclusion];
  if (bound.join('\t') !== [sha, 'main', 'push', 'completed', 'success'].join('\t'))
    fail(`main push CI is not successful on ${sha}`);

  const seen = new Map();
  for (let page = 1; page <= 20; page++) {
    const query = new URLSearchParams({ per_page: '100', page: String(page) });
    const checks = await fetchJson(`/repos/${repo}/commits/${sha}/check-runs?${query}`);
    const rows = checks.check_runs ?? [];
    for (const row of rows) seen.set(row.name, row.conclusion);
    if (rows.length < 100) break;
  }
  for (const name of required) {
    if (seen.get(name) !== 'success') fail(`required check ${name} is not green on ${sha}`);
  }
  mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
  writeFileSync(cachePath, JSON.stringify({ green: true, sha, at: new Date().toISOString() }), {
    mode: 0o600,
  });
} catch (error) {
  if (error instanceof Error && /^(main push CI|required check)/.test(error.message)) throw error;
  fail(error instanceof Error ? error.message : String(error));
}
