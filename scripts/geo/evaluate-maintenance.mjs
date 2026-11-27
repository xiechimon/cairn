import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readLatestPanelState } from './citation-panel.mjs';

const MS_PER_DAY = 86_400_000;
const DEFAULT_NEW_BATCH_WINDOW_DAYS = 90;
const DEFAULT_STALE_EXPORT_DAYS = 14;
const DEFAULT_VERIFICATION_STALE_DAYS = 90;
const SLUG_STOPWORDS = new Set([
  'cairn',
  'guides',
  'zh',
  'cn',
  'how',
  'to',
  'with',
  'from',
  'and',
  'the',
  'for',
  'mac',
  'your',
]);

function extractSlugTokens(urlOrSlug) {
  return String(urlOrSlug ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !SLUG_STOPWORDS.has(w));
}

export function normalizeUrlPath(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  let path = raw.trim();
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return '';
    }
  }
  if (!path.startsWith('/')) path = `/${path}`;
  if (path !== '/' && !path.endsWith('/')) path = `${path}/`;
  return path;
}

function parseDateMs(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function findStrongestClusterPeer(page, allPages, gscByUrl, mergedUrls) {
  const pageTokens = new Set(extractSlugTokens(page.url));
  const candidates = allPages
    .filter(
      (other) =>
        other.url !== page.url &&
        other.locale === page.locale &&
        other.cluster === page.cluster &&
        other.state === 'indexed' &&
        other.status !== 'merged_301' &&
        !mergedUrls.has(other.url),
    )
    .map((other) => {
      const sharedTokens = extractSlugTokens(other.url).filter((t) => pageTokens.has(t)).length;
      const isHub = other.template === 'hub';
      return { other, sharedTokens, isHub, clicks: gscByUrl.get(other.url)?.clicks ?? 0 };
    })
    .filter((item) => item.isHub || item.sharedTokens >= 1)
    .sort((a, b) => {
      if (b.sharedTokens !== a.sharedTokens) return b.sharedTokens - a.sharedTokens;
      if (b.isHub !== a.isHub) return Number(b.isHub) - Number(a.isHub);
      return b.clicks - a.clicks;
    });
  return candidates[0]?.other.url ?? null;
}

export function evaluateMaintenance({
  pages = [],
  gscRows = [],
  gscExportDate = null,
  existingRedirects = [],
  panelRows = [],
  panelStale = false,
  manualAction = false,
  previousGrowthBlocked = false,
  newBatchWindowDays = DEFAULT_NEW_BATCH_WINDOW_DAYS,
  now = new Date(),
}) {
  const normalizedPages = pages.map((p) => ({
    ...p,
    url: normalizeUrlPath(p.url),
    locale: p.locale ?? (normalizeUrlPath(p.url).startsWith('/zh-cn/') ? 'zh-cn' : 'en'),
  }));
  const mergedUrls = new Set(
    existingRedirects.map((r) => normalizeUrlPath(r.source ?? r)).filter(Boolean),
  );
  for (const p of normalizedPages) {
    if (p.status === 'merged_301' && p.url) mergedUrls.add(p.url);
  }
  const gscByUrl = new Map(gscRows.map((row) => [normalizeUrlPath(row.url), row]));
  const exportMs = gscExportDate ? parseDateMs(gscExportDate) : null;
  const gscStale =
    (gscRows.length > 0 && !gscExportDate) ||
    (Boolean(gscExportDate) &&
      (exportMs === null ||
        Math.floor((now.getTime() - exportMs) / MS_PER_DAY) > DEFAULT_STALE_EXPORT_DAYS));
  const citedUrls = new Set();
  const competitorGapPrompts = [];

  if (!panelStale) {
    for (const row of panelRows) {
      if (row.status !== 'checked') continue;
      if (row.citedCairn) {
        for (const fullUrl of row.citedUrls ?? []) {
          const path = normalizeUrlPath(fullUrl);
          if (path) citedUrls.add(path);
        }
      } else if ((row.competitorDomains ?? []).length > 0 && row.targetPath) {
        competitorGapPrompts.push({
          targetPath: normalizeUrlPath(row.targetPath),
          engine: row.engine,
          competitorDomains: row.competitorDomains,
        });
      }
    }
  }

  const activePages = normalizedPages.filter((p) => !mergedUrls.has(p.url));
  const evaluatedAll = activePages.filter((p) => p.state && p.state !== 'unknown');
  const agedActivePages = activePages.filter((p) => {
    const ms = parseDateMs(p.publishedAt);
    if (ms === null) return false;
    return Math.floor((now.getTime() - ms) / MS_PER_DAY) >= 28;
  });
  const agedNewBatchPages = agedActivePages.filter((p) => {
    const ms = parseDateMs(p.publishedAt);
    if (ms === null) return false;
    return Math.floor((now.getTime() - ms) / MS_PER_DAY) <= newBatchWindowDays;
  });
  const gscCoverageRatio =
    agedActivePages.length === 0 ? 1 : evaluatedAll.length / agedActivePages.length;
  const newBatchCoverageRatio =
    agedNewBatchPages.length === 0
      ? 1
      : agedNewBatchPages.filter((p) => p.state && p.state !== 'unknown').length /
        agedNewBatchPages.length;
  const indexedAll = evaluatedAll.filter((p) => p.state === 'indexed').length;
  const overallIndexedRatio = evaluatedAll.length === 0 ? 0 : indexedAll / evaluatedAll.length;

  const newBatchPages = evaluatedAll.filter((p) => {
    const ms = parseDateMs(p.publishedAt);
    if (ms === null) return false;
    const ageDays = Math.floor((now.getTime() - ms) / MS_PER_DAY);
    return ageDays >= 0 && ageDays <= newBatchWindowDays;
  });
  const newIndexedCount = newBatchPages.filter((p) => p.state === 'indexed').length;
  const newIndexedRatio =
    newBatchPages.length === 0 ? overallIndexedRatio : newIndexedCount / newBatchPages.length;

  let growthDecision = 'AWAITING_GSC_DATA';
  if (manualAction) {
    growthDecision = 'FREEZE_AND_AUDIT';
  } else if (gscStale) {
    growthDecision = 'STALE_GSC_DATA';
  } else if (evaluatedAll.length > 0) {
    if (newIndexedRatio < 0.5 || overallIndexedRatio < 0.5) growthDecision = 'FREEZE_AND_AUDIT';
    else if (
      (agedActivePages.length > 0 && gscCoverageRatio < 0.5) ||
      (agedNewBatchPages.length > 0 && newBatchCoverageRatio < 0.5)
    ) {
      growthDecision = 'INCOMPLETE_GSC_DATA';
    } else if (newIndexedRatio >= 0.8 && overallIndexedRatio >= 0.8) growthDecision = 'GROW';
    else growthDecision = 'HOLD';
  }

  if (
    previousGrowthBlocked &&
    (growthDecision === 'AWAITING_GSC_DATA' ||
      growthDecision === 'STALE_GSC_DATA' ||
      growthDecision === 'INCOMPLETE_GSC_DATA')
  ) {
    growthDecision = 'FREEZE_AND_AUDIT';
  }

  const growthBlocked = growthDecision === 'FREEZE_AND_AUDIT';

  const pageActions = normalizedPages.map((page) => {
    if (mergedUrls.has(page.url)) {
      return {
        url: page.url,
        action: 'ALREADY_MERGED_301',
        reason: 'permanent 301 redirect already recorded; skip to avoid redirect loops',
      };
    }
    const pubMs = parseDateMs(page.publishedAt);
    if (pubMs === null) {
      return {
        url: page.url,
        action: 'INVALID_DATE',
        reason: 'missing or invalid publishedAt date',
      };
    }
    if (gscStale) {
      return {
        url: page.url,
        action: 'STALE_GSC_DATA',
        reason: `GSC export "${gscExportDate}" is invalid or older than ${DEFAULT_STALE_EXPORT_DAYS}d`,
      };
    }
    const ageDays = Math.floor((now.getTime() - pubMs) / MS_PER_DAY);
    if (ageDays < 28) {
      return { url: page.url, action: 'WAIT_FOR_DATA', reason: `published ${ageDays}d ago (<28d)` };
    }
    if (page.state === 'crawled_not_indexed' && ageDays >= 42) {
      const peer = findStrongestClusterPeer(page, normalizedPages, gscByUrl, mergedUrls);
      if (!peer) {
        return {
          url: page.url,
          action: 'REWRITE_OR_MANUAL_REVIEW',
          reason: `crawled_not_indexed after ${ageDays}d with no same-locale indexed peer`,
        };
      }
      return {
        url: page.url,
        action: 'MERGE_WITH_301',
        redirectTo: peer,
        reason: `crawled_not_indexed after ${ageDays}d (>=42d)`,
      };
    }
    if (!page.state || page.state === 'unknown') {
      return {
        url: page.url,
        action: 'WAIT_FOR_GSC',
        reason: 'page not yet covered by GSC export',
      };
    }
    if (page.state === 'discovered_not_indexed') {
      return {
        url: page.url,
        action: 'INTERNAL_LINKS_AND_INDEXNOW',
        reason: 'discovered_not_indexed (crawl priority / internal linking)',
      };
    }
    const gsc = gscByUrl.get(page.url);
    if (
      page.state === 'indexed' &&
      gsc &&
      gsc.impressions >= 50 &&
      (gsc.clicks / gsc.impressions < 0.02 || gsc.position > 12)
    ) {
      return {
        url: page.url,
        action: 'REWRITE',
        reason: 'indexed with impressions but low CTR or rank > 12',
      };
    }
    const verMs = page.verifiedDate ? parseDateMs(page.verifiedDate) : null;
    if (
      verMs !== null &&
      Math.floor((now.getTime() - verMs) / MS_PER_DAY) > DEFAULT_VERIFICATION_STALE_DAYS
    ) {
      return {
        url: page.url,
        action: 'REFRESH_VERIFICATION',
        reason: `verifiedDate ${page.verifiedDate} is older than ${DEFAULT_VERIFICATION_STALE_DAYS}d`,
      };
    }
    if (growthBlocked) {
      return {
        url: page.url,
        action: 'AUDIT_HOLD',
        reason: 'growth frozen (FREEZE_AND_AUDIT); expansion suppressed until audit passes',
      };
    }
    if (citedUrls.has(page.url) || (gsc && gsc.clicks >= 20)) {
      return { url: page.url, action: 'EXPAND', reason: 'cited or top-performing clicks' };
    }
    const gap = competitorGapPrompts.find((g) => g.targetPath === page.url);
    if (gap) {
      return {
        url: page.url,
        action: 'GAP_IMPROVE_AND_OFFSITE',
        reason: `competitors cited on ${gap.engine}: ${gap.competitorDomains.join(', ')}`,
      };
    }
    return { url: page.url, action: 'KEEP', reason: 'healthy or insufficient signal' };
  });

  return {
    evaluatedAt: now.toISOString(),
    totalPages: normalizedPages.length,
    evaluatedCount: evaluatedAll.length,
    agedCount: agedActivePages.length,
    gscCoverageRatio,
    indexedCount: indexedAll,
    overallIndexedRatio,
    newBatchCount: newBatchPages.length,
    newIndexedRatio,
    panelStale,
    gscStale,
    growthDecision,
    growthBlocked,
    pageActions,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  const repoRoot = resolve(import.meta.dirname, '../..');
  const siteIdx = argv.indexOf('--site-dir');
  const siteDir =
    siteIdx !== -1 && argv[siteIdx + 1] ? resolve(argv[siteIdx + 1]) : join(repoRoot, 'site');
  const qIdx = argv.indexOf('--questions');
  const questionsPath =
    qIdx !== -1 && argv[qIdx + 1] ? resolve(argv[qIdx + 1]) : join(siteDir, 'geo/questions.jsonl');
  const questions = existsSync(questionsPath)
    ? readFileSync(questionsPath, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
  const gscIdx = argv.indexOf('--gsc-json');
  const gscPayload =
    gscIdx !== -1 && argv[gscIdx + 1] && existsSync(argv[gscIdx + 1])
      ? JSON.parse(readFileSync(argv[gscIdx + 1], 'utf8'))
      : [];
  const gscRows = Array.isArray(gscPayload) ? gscPayload : (gscPayload?.pages ?? []);
  const gscExportDate = Array.isArray(gscPayload) ? null : (gscPayload?.exportedAt ?? null);
  const vercelPath = join(siteDir, 'vercel.json');
  const existingRedirects = existsSync(vercelPath)
    ? (JSON.parse(readFileSync(vercelPath, 'utf8')).redirects ?? [])
    : [];
  const gscMap = new Map(gscRows.map((r) => [normalizeUrlPath(r.url), r]));
  const pages = questions.map((q) => {
    const url = q.locale === 'zh-cn' ? `/zh-cn/guides/${q.slug}/` : `/guides/${q.slug}/`;
    const gscRow = gscMap.get(url);
    const mdxPath = join(
      siteDir,
      'src/content/docs',
      q.locale === 'zh-cn' ? 'zh-cn/guides' : 'guides',
      `${q.slug}.mdx`,
    );
    let verifiedDate = q.verifiedDate ?? null;
    if (!verifiedDate && existsSync(mdxPath)) {
      const mdxText = readFileSync(mdxPath, 'utf8');
      const m = /^\s*verifiedDate:\s*["']?(\d{4}-\d{2}-\d{2})["']?/m.exec(mdxText);
      if (m) verifiedDate = m[1];
    }
    return {
      url,
      locale: q.locale,
      cluster: q.cluster,
      template: q.template,
      status: q.status ?? 'active',
      publishedAt: q.publishedAt ?? '',
      verifiedDate,
      state: gscRow?.state ?? 'unknown',
    };
  });
  const stateIdx = argv.indexOf('--state-file');
  const writeIdx = argv.indexOf('--write-state');
  const outPath =
    stateIdx !== -1 && argv[stateIdx + 1]
      ? resolve(argv[stateIdx + 1])
      : writeIdx !== -1 && argv[writeIdx + 1]
        ? resolve(argv[writeIdx + 1])
        : join(siteDir, 'geo/maintenance-state.json');
  let previousState = null;
  if (existsSync(outPath)) {
    try {
      previousState = JSON.parse(readFileSync(outPath, 'utf8'));
    } catch {
      previousState = null;
    }
  }
  const panelState = readLatestPanelState(join(siteDir, 'geo/panel-results'));
  const manualAction = argv.includes('--manual-action');
  const report = evaluateMaintenance({
    pages,
    gscRows,
    gscExportDate,
    existingRedirects,
    panelRows: panelState.rows,
    panelStale: panelState.stale,
    manualAction,
    previousGrowthBlocked: Boolean(previousState?.growthBlocked),
  });
  const dryRun = argv.includes('--dry-run');
  if (!dryRun) {
    mkdirSync(dirname(outPath), { recursive: true });
    const tmpPath = `${outPath}.tmp.${process.pid}`;
    const frozenQuestionIds = report.growthBlocked
      ? [
          ...new Set([
            ...(Array.isArray(previousState?.frozenQuestionIds)
              ? previousState.frozenQuestionIds
              : []),
            ...questions.map((q) => q.id),
          ]),
        ]
      : [];
    writeFileSync(
      tmpPath,
      `${JSON.stringify(
        {
          growthDecision: report.growthDecision,
          growthBlocked: report.growthBlocked,
          frozenQuestionIds,
          updatedAt: report.evaluatedAt,
        },
        null,
        2,
      )}\n`,
    );
    renameSync(tmpPath, outPath);
  }
  console.log(JSON.stringify(report, null, 2));
}
