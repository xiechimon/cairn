import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const INDEXNOW_HOST = 'cairn.xmon.me';
export const INDEXNOW_KEY = 'cairn-xmon-me-indexnow-2026';
const DEFAULT_DEDUP_WINDOW_MS = 86_400_000;

export function extractUrlsFromSitemap(xml) {
  const urls = [];
  for (const match of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    urls.push(match[1].trim());
  }
  return urls;
}

export function buildIndexNowPayload({ host = INDEXNOW_HOST, key = INDEXNOW_KEY, urls = [] }) {
  if (!host || !key) {
    throw new Error('IndexNow host and key are required');
  }
  const unique = [...new Set(urls.map((u) => String(u).trim()).filter(Boolean))];
  if (unique.length === 0) {
    throw new Error('IndexNow requires at least one URL');
  }
  for (const rawUrl of unique) {
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error(`Invalid IndexNow URL "${rawUrl}"`);
    }
    if (parsed.hostname !== host) {
      throw new Error(`IndexNow URL host "${parsed.hostname}" does not match "${host}"`);
    }
  }
  return {
    host,
    key,
    keyLocation: `https://${host}/${key}.txt`,
    urlList: unique.slice(0, 10_000),
  };
}

export function hashUrlList(urls) {
  return createHash('sha256')
    .update([...new Set(urls)].sort().join('\n'), 'utf8')
    .digest('hex');
}

export function shouldSkipRecentSubmission(cachePath, urls, nowMs = Date.now()) {
  if (!cachePath || !existsSync(cachePath)) return false;
  try {
    const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
    return (
      cache.urlListHash === hashUrlList(urls) &&
      typeof cache.submittedAtMs === 'number' &&
      nowMs - cache.submittedAtMs < DEFAULT_DEDUP_WINDOW_MS
    );
  } catch {
    return false;
  }
}

export function recordSubmission(cachePath, urls, nowMs = Date.now()) {
  if (!cachePath) return;
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(
    cachePath,
    `${JSON.stringify({ urlListHash: hashUrlList(urls), submittedAtMs: nowMs }, null, 2)}\n`,
  );
}

export async function verifyLiveDeployment(
  { host = INDEXNOW_HOST, key = INDEXNOW_KEY, sampleUrl },
  fetchImpl = fetch,
) {
  const keyUrl = `https://${host}/${key}.txt`;
  try {
    const [keyRes, sampleRes] = await Promise.all([
      fetchImpl(keyUrl, { signal: AbortSignal.timeout(10_000) }),
      fetchImpl(sampleUrl, { signal: AbortSignal.timeout(10_000) }),
    ]);
    if (!keyRes.ok) {
      return { ok: false, reason: `key file ${keyUrl} returned HTTP ${keyRes.status}` };
    }
    const keyText = (await keyRes.text()).trim();
    if (keyText !== key) {
      return { ok: false, reason: `key file ${keyUrl} contents mismatched expected key` };
    }
    if (!sampleRes.ok) {
      return { ok: false, reason: `sample route ${sampleUrl} returned HTTP ${sampleRes.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

export async function submitIndexNow(payload, fetchImpl = fetch) {
  try {
    const res = await fetchImpl('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, body: text };
  } catch (err) {
    return { ok: false, status: 0, body: err.message };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  const submit = argv.includes('--submit');
  const skipLiveCheck = argv.includes('--skip-live-check');
  const cacheIdx = argv.indexOf('--cache-file');
  const cachePath = cacheIdx !== -1 && argv[cacheIdx + 1] ? resolve(argv[cacheIdx + 1]) : null;
  const repoRoot = resolve(import.meta.dirname, '../..');
  const sitemapIdx = argv.indexOf('--sitemap');
  const sitemapPath =
    sitemapIdx !== -1 && argv[sitemapIdx + 1]
      ? resolve(argv[sitemapIdx + 1])
      : join(repoRoot, 'site/dist/sitemap-0.xml');

  let urls = [];
  const urlsIdx = argv.indexOf('--urls');
  if (urlsIdx !== -1 && argv[urlsIdx + 1]) {
    urls = argv[urlsIdx + 1]
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean);
  } else if (existsSync(sitemapPath)) {
    urls = extractUrlsFromSitemap(readFileSync(sitemapPath, 'utf8'));
  } else {
    console.error(
      `[indexnow] sitemap not found at ${sitemapPath}; build or deploy before submitting`,
    );
    process.exit(1);
  }

  let payload;
  try {
    payload = buildIndexNowPayload({ urls });
  } catch (err) {
    console.error(`[indexnow] ${err.message}`);
    process.exit(1);
  }

  if (!submit) {
    console.log(
      JSON.stringify({ mode: 'dry-run', count: payload.urlList.length, payload }, null, 2),
    );
    process.exit(0);
  }

  if (shouldSkipRecentSubmission(cachePath, payload.urlList)) {
    console.log(
      JSON.stringify({ ok: true, skipped: true, reason: 'already_submitted_recently' }, null, 2),
    );
    process.exit(0);
  }

  if (!skipLiveCheck) {
    const sampleUrl = payload.urlList.find((u) => u.includes('/guides/')) ?? payload.urlList[0];
    const live = await verifyLiveDeployment({ host: payload.host, key: payload.key, sampleUrl });
    if (!live.ok) {
      console.error(`[indexnow] live deployment check failed: ${live.reason}`);
      process.exit(1);
    }
  }

  const result = await submitIndexNow(payload);
  if (result.ok) recordSubmission(cachePath, payload.urlList);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
