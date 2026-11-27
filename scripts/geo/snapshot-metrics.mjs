import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readLatestPanelRows, summarizePanelResults } from './citation-panel.mjs';

export function computeNetDmgDownloads(releases) {
  let rawDmg = 0;
  let noiseFloorSum = 0;
  let netDmg = 0;
  for (const release of releases ?? []) {
    const assets = release.assets ?? [];
    const dmgCounts = [];
    let linuxFloor = 0;
    for (const asset of assets) {
      const name = String(asset.name ?? '');
      const count = Number(asset.download_count ?? 0);
      if (name.endsWith('.dmg')) {
        dmgCounts.push(count);
        rawDmg += count;
      } else if (name.endsWith('.tar.gz') && name.includes('linux')) {
        linuxFloor = Math.max(linuxFloor, count);
      }
    }
    noiseFloorSum += linuxFloor * dmgCounts.length;
    for (const count of dmgCounts) {
      netDmg += Math.max(0, count - linuxFloor);
    }
  }
  return { rawDmg, noiseFloorSum, netDmg };
}

export function normalizeSnapshot({
  date,
  repo,
  views,
  referrers,
  releases,
  cloudflare = null,
  gsc = null,
  bing = null,
  panelRows = [],
  githubStatus = 'ok',
}) {
  const dmg = computeNetDmgDownloads(releases);
  const panelSummary = summarizePanelResults(panelRows);
  const missingOwnerActions = [];
  if (cloudflare?.status !== 'ok') missingOwnerActions.push('Cloudflare Web Analytics read token');
  if (!gsc || gsc.status === 'not_configured')
    missingOwnerActions.push('Google Search Console verification/export');
  if (!bing || bing.status === 'not_configured')
    missingOwnerActions.push('Bing Webmaster Tools import');
  return {
    date,
    githubStatus,
    stars: Number(repo?.stargazers_count ?? 0),
    forks: Number(repo?.forks_count ?? 0),
    views14d: Number(views?.count ?? 0),
    uniques14d: Number(views?.uniques ?? 0),
    referrers14d: (referrers ?? []).map((r) => ({
      referrer: r.referrer,
      count: Number(r.count ?? 0),
      uniques: Number(r.uniques ?? 0),
    })),
    rawDmgDownloads: dmg.rawDmg,
    dmgNoiseFloor: dmg.noiseFloorSum,
    netDmgDownloadsEstimated: dmg.netDmg,
    cloudflare: cloudflare ?? { status: 'not_configured' },
    gsc: gsc ?? { status: 'not_configured' },
    bing: bing ?? { status: 'not_configured' },
    panel: panelSummary,
    missingOwnerActions,
  };
}

export async function fetchCloudflareAnalytics(token, siteTag, date, fetchImpl = fetch) {
  if (!token || !siteTag) return { status: 'not_configured' };
  const query = `query($siteTag: string!, $since: Date!, $until: Date!) {
    viewer {
      accounts(limit: 1) {
        rumPageloadEventsAdaptiveGroups(filter: { siteTag: $siteTag, date_geq: $since, date_leq: $until }, limit: 20) {
          count
          dimensions { refererHost requestPath }
        }
      }
    }
  }`;
  try {
    const res = await fetchImpl('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables: { siteTag, since: date, until: date } }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { status: 'error', httpStatus: res.status };
    const payload = await res.json();
    if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
      return { status: 'error', errors: payload.errors };
    }
    return { status: 'ok', data: payload?.data ?? null };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

function ghApiJson(endpoint) {
  const out = execFileSync('gh', ['api', endpoint], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(out);
}

export function fetchGithubSnapshot(apiRunner = ghApiJson) {
  const endpoints = [
    ['repo', 'repos/xiechimon/cairn', null],
    ['views', 'repos/xiechimon/cairn/traffic/views', null],
    ['referrers', 'repos/xiechimon/cairn/traffic/popular/referrers', []],
    ['releases', 'repos/xiechimon/cairn/releases?per_page=100', []],
  ];
  const result = {};
  const errors = [];
  for (const [key, endpoint, fallback] of endpoints) {
    try {
      result[key] = apiRunner(endpoint);
    } catch (err) {
      result[key] = fallback;
      errors.push(`${key}: ${err.message.split('\n')[0]}`);
    }
  }
  let githubStatus = 'ok';
  if (errors.length === endpoints.length) githubStatus = `error: ${errors.join('; ')}`;
  else if (errors.length > 0) githubStatus = `partial_error: ${errors.join('; ')}`;
  return { ...result, githubStatus };
}

function readOptionalJsonArg(argv, flag) {
  const idx = argv.indexOf(flag);
  if (idx === -1 || !argv[idx + 1]) return null;
  const target = argv[idx + 1];
  if (!existsSync(target)) return null;
  return JSON.parse(readFileSync(target, 'utf8'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  const repoRoot = resolve(import.meta.dirname, '../..');
  const date = new Date().toISOString().slice(0, 10);
  const ghData = fetchGithubSnapshot();
  const cloudflare = await fetchCloudflareAnalytics(
    process.env.CF_ANALYTICS_TOKEN ?? '',
    process.env.CF_SITE_TAG ?? '',
    date,
  );
  const gsc = readOptionalJsonArg(argv, '--gsc-json');
  const bing = readOptionalJsonArg(argv, '--bing-json');
  const panelRows = readLatestPanelRows(join(repoRoot, 'site/geo/panel-results'));
  const snapshot = normalizeSnapshot({
    date,
    repo: ghData.repo,
    views: ghData.views,
    referrers: ghData.referrers,
    releases: ghData.releases,
    cloudflare,
    gsc,
    bing,
    panelRows,
    githubStatus: ghData.githubStatus,
  });
  const outIdx = argv.indexOf('--out');
  if (outIdx !== -1 && argv[outIdx + 1]) {
    const outPath = resolve(argv[outIdx + 1]);
    mkdirSync(dirname(outPath), { recursive: true });
    appendFileSync(outPath, `${JSON.stringify(snapshot)}\n`);
  }
  console.log(JSON.stringify(snapshot, null, 2));
}
