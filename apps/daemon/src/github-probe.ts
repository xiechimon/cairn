import { spawn } from 'node:child_process';
import { isGithubRepoRef } from '@cairn/shared';

export interface GithubPrProbe {
  number: number;
  url: string;
}

const PROBE_TIMEOUT_MS = 10_000;

export type ProbeFetch = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export function githubRepoRefOf(cloneUrl: string): { owner: string; repo: string } | null {
  let path: string;
  try {
    path = new URL(cloneUrl).pathname;
  } catch {
    return null;
  }
  const ref = path
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '');
  if (!isGithubRepoRef(ref)) return null;
  const slash = ref.indexOf('/');
  return { owner: ref.slice(0, slash), repo: ref.slice(slash + 1) };
}

interface ProbeOpts {
  owner: string;
  repo: string;
  branch: string;
  token?: string | null;
  fetchImpl?: ProbeFetch;
  ghPath?: string;
}

async function probeViaGh(opts: ProbeOpts, ghPath: string): Promise<GithubPrProbe | null> {
  const r = await new Promise<{ code: number; stdout: string } | null>((resolve) => {
    const child = spawn(
      ghPath,
      [
        'pr',
        'list',
        '--repo',
        `${opts.owner}/${opts.repo}`,
        '--head',
        opts.branch,
        '--state',
        'all',
        '--json',
        'number,url,state',
        '--limit',
        '5',
      ],
      { timeout: PROBE_TIMEOUT_MS, windowsHide: true },
    );
    const out: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => out.push(c));
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      if (code === 0) resolve({ code, stdout: Buffer.concat(out).toString('utf8') });
      else resolve(null);
    });
  });
  if (r === null) return null;
  let rows: { number: number; url: string; state?: string }[];
  try {
    rows = JSON.parse(r.stdout) as { number: number; url: string; state?: string }[];
  } catch {
    return null;
  }
  return pickPr(rows);
}

async function probeViaApi(opts: ProbeOpts, fetchImpl: ProbeFetch): Promise<GithubPrProbe | null> {
  const url = `https://api.github.com/repos/${opts.owner}/${opts.repo}/pulls?head=${encodeURIComponent(
    `${opts.owner}:${opts.branch}`,
  )}&state=all`;
  let data: unknown;
  try {
    const res = await fetchImpl(url, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'cairn-daemon',
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    data = await res.json();
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;
  const rows = data
    .filter((r): r is { number: number; html_url: string; state?: string } => {
      if (r === null || typeof r !== 'object') return false;
      const { number, html_url } = r as { number?: unknown; html_url?: unknown };
      return typeof number === 'number' && typeof html_url === 'string';
    })
    .map((r) => ({ number: r.number, url: r.html_url, state: r.state }));
  return pickPr(rows);
}

function pickPr(rows: { number: number; url: string; state?: string }[]): GithubPrProbe | null {
  if (rows.length === 0) return null;
  const open = rows.filter((r) => r.state === 'open');
  const pool = open.length > 0 ? open : rows;
  const best = pool.reduce((a, b) => (b.number > a.number ? b : a));
  return { number: best.number, url: best.url };
}

export async function probeGithubPr(opts: ProbeOpts): Promise<GithubPrProbe | null> {
  const gh = opts.ghPath ?? 'gh';
  const viaGh = await probeViaGh(opts, gh).catch(() => null);
  if (viaGh !== null) return viaGh;
  return probeViaApi(opts, opts.fetchImpl ?? fetch).catch(() => null);
}
