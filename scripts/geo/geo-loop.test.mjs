import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { makeTestTempDir, releaseTestTempDir } from '../test-tmpdir.mjs';
import {
  buildLoginChecklist,
  FREE_ENGINES,
  readLatestPanelState,
  summarizePanelResults,
  validatePanelConfig,
} from './citation-panel.mjs';
import { evaluateMaintenance } from './evaluate-maintenance.mjs';
import {
  buildIndexNowPayload,
  recordSubmission,
  shouldSkipRecentSubmission,
  submitIndexNow,
  verifyLiveDeployment,
} from './indexnow-submit.mjs';
import {
  computeNetDmgDownloads,
  fetchCloudflareAnalytics,
  fetchGithubSnapshot,
  normalizeSnapshot,
} from './snapshot-metrics.mjs';

test('validatePanelConfig allows the 8 free engines and rejects Anthropic or paid APIs', () => {
  const validConfig = {
    mode: 'free_consumer_web_browser',
    paidApisAllowed: false,
    anthropicAllowed: false,
    engines: FREE_ENGINES,
    questions: [{ id: 'q1', locale: 'en', prompt: 'What is Cairn?' }],
  };
  assert.equal(validatePanelConfig(validConfig).ok, true);
  assert.equal(FREE_ENGINES.length, 8);
  assert.equal(
    FREE_ENGINES.some((e) => /claude|anthropic/i.test(e.id)),
    false,
  );

  assert.throws(
    () =>
      validatePanelConfig({
        ...validConfig,
        paidApisAllowed: true,
      }),
    /paid/i,
  );

  assert.throws(
    () =>
      validatePanelConfig({
        ...validConfig,
        engines: [...FREE_ENGINES, { id: 'claude', name: 'Claude', url: 'https://claude.ai' }],
      }),
    /anthropic|claude/i,
  );
});

test('citation-panel CLI records blocked engines on disk and detects malformed or stale files', () => {
  const dir = makeTestTempDir('geo-panel-');
  try {
    const repoRoot = resolve(import.meta.dirname, '../..');
    execFileSync(
      process.execPath,
      ['scripts/geo/citation-panel.mjs', '--init-blocked', '--results-dir', dir],
      {
        cwd: repoRoot,
        encoding: 'utf8',
      },
    );
    const state = readLatestPanelState(dir);
    assert.equal(state.rows.length, 8);
    assert.equal(state.stale, false);
    const summary = summarizePanelResults(state.rows);
    assert.equal(summary.totalChecked, 0);
    const checklist = buildLoginChecklist(state.rows, FREE_ENGINES);
    assert.equal(checklist.length, 8);

    const todayFile = join(dir, state.latestFile);
    const updated = state.rows.map((r) =>
      r.engine === 'perplexity' ? { ...r, status: 'checked', citedCairn: true } : r,
    );
    writeFileSync(todayFile, `${updated.map((r) => JSON.stringify(r)).join('\n')}\n`);
    execFileSync(
      process.execPath,
      ['scripts/geo/citation-panel.mjs', '--init-blocked', '--results-dir', dir],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    const preserved = readLatestPanelState(dir);
    assert.equal(preserved.rows.find((r) => r.engine === 'perplexity')?.status, 'checked');
    assert.equal(preserved.rows.find((r) => r.engine === 'chatgpt')?.status, 'blocked');

    const dirOld = makeTestTempDir('geo-panel-old-');
    try {
      writeFileSync(
        join(dirOld, '2026-10-01.jsonl'),
        `${JSON.stringify({ engine: 'chatgpt', status: 'checked', citedCairn: false })}\n`,
      );
      const staleState = readLatestPanelState(dirOld, { now: new Date('2026-11-27T00:00:00Z') });
      assert.equal(staleState.stale, true);

      writeFileSync(join(dirOld, '2026-10-02.jsonl'), '{broken json\n');
      assert.throws(() => readLatestPanelState(dirOld), /malformed/);
    } finally {
      releaseTestTempDir(dirOld);
    }
  } finally {
    releaseTestTempDir(dir);
  }
});

test('evaluateMaintenance distinguishes new-batch indexing, suppresses EXPAND on freeze, and never redirects cross-locale', () => {
  const now = new Date('2026-11-27T00:00:00Z');
  const maskedNewBatch = evaluateMaintenance({
    now,
    manualAction: false,
    pages: [
      {
        url: '/guides/old-parallel-agents/',
        locale: 'en',
        cluster: 'c1',
        publishedAt: '2026-06-01',
        state: 'indexed',
      },
      {
        url: '/guides/old-2/',
        locale: 'en',
        cluster: 'c1',
        publishedAt: '2026-06-01',
        state: 'indexed',
      },
      {
        url: '/guides/old-3/',
        locale: 'en',
        cluster: 'c1',
        publishedAt: '2026-06-01',
        state: 'indexed',
      },
      {
        url: '/guides/old-4/',
        locale: 'en',
        cluster: 'c1',
        publishedAt: '2026-06-01',
        state: 'indexed',
      },
      {
        url: '/guides/new-parallel-fail/',
        locale: 'en',
        cluster: 'c1',
        publishedAt: '2026-10-01',
        state: 'crawled_not_indexed',
      },
      {
        url: '/zh-cn/guides/cn-only/',
        locale: 'zh-cn',
        cluster: 'c1',
        publishedAt: '2026-10-01',
        state: 'crawled_not_indexed',
      },
    ],
    gscExportDate: '2026-11-27',
    gscRows: [
      {
        url: 'https://cairn.xmon.me/guides/old-parallel-agents',
        impressions: 100,
        clicks: 30,
        position: 3,
      },
    ],
    panelRows: [],
  });
  assert.equal(maskedNewBatch.growthDecision, 'FREEZE_AND_AUDIT');
  assert.equal(maskedNewBatch.growthBlocked, true);
  assert.equal(
    maskedNewBatch.pageActions.find((a) => a.url === '/guides/old-parallel-agents/').action,
    'AUDIT_HOLD',
  );
  assert.equal(
    maskedNewBatch.pageActions.find((a) => a.url === '/guides/new-parallel-fail/').redirectTo,
    '/guides/old-parallel-agents/',
  );
  assert.equal(
    maskedNewBatch.pageActions.find((a) => a.url === '/zh-cn/guides/cn-only/').action,
    'REWRITE_OR_MANUAL_REVIEW',
  );

  const manualFreeze = evaluateMaintenance({
    now,
    manualAction: true,
    gscExportDate: '2026-11-27',
    pages: [
      {
        url: '/guides/a/',
        locale: 'en',
        cluster: 'c1',
        publishedAt: '2026-10-01',
        state: 'indexed',
      },
    ],
    gscRows: [{ url: '/guides/a/', impressions: 100, clicks: 40, position: 2 }],
    panelRows: [
      {
        engine: 'perplexity',
        status: 'checked',
        citedCairn: true,
        citedUrls: ['https://cairn.xmon.me/guides/a/'],
      },
    ],
  });
  assert.equal(manualFreeze.growthDecision, 'FREEZE_AND_AUDIT');
  assert.equal(manualFreeze.pageActions[0].action, 'AUDIT_HOLD');

  const dir = makeTestTempDir('geo-maint-');
  try {
    const repoRoot = resolve(import.meta.dirname, '../..');
    const qPath = join(dir, 'q.jsonl');
    const statePath = join(dir, 'state.json');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      qPath,
      `${JSON.stringify({ id: 'q-1', slug: 'a', locale: 'en', cluster: 'c1', publishedAt: '2026-10-01' })}\n`,
    );
    execFileSync(
      process.execPath,
      [
        'scripts/geo/evaluate-maintenance.mjs',
        '--manual-action',
        '--questions',
        qPath,
        '--state-file',
        statePath,
      ],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    const written = JSON.parse(readFileSync(statePath, 'utf8'));
    assert.equal(written.growthDecision, 'FREEZE_AND_AUDIT');
    assert.deepEqual(written.frozenQuestionIds, ['q-1']);
  } finally {
    releaseTestTempDir(dir);
  }
});

test('computeNetDmgDownloads, normalizeSnapshot, and fetchCloudflareAnalytics handle missing creds and HTTP 200 GraphQL errors', async () => {
  const releases = [
    {
      tag_name: 'desktop-v0.1.790',
      assets: [
        { name: 'Cairn-0.1.790-mac-arm64.dmg', download_count: 10 },
        { name: 'Cairn-0.1.790-mac-x64.dmg', download_count: 3 },
        { name: 'Cairn-0.1.790-linux-x64.tar.gz', download_count: 1 },
      ],
    },
    {
      tag_name: 'desktop-v0.1.789',
      assets: [
        { name: 'Cairn-0.1.789-mac-arm64.dmg', download_count: 1 },
        { name: 'Cairn-0.1.789-mac-x64.dmg', download_count: 0 },
        { name: 'Cairn-0.1.789-linux-x64.tar.gz', download_count: 2 },
      ],
    },
  ];
  const dmg = computeNetDmgDownloads(releases);
  assert.equal(dmg.rawDmg, 14);
  assert.equal(dmg.noiseFloorSum, 6);
  assert.equal(dmg.netDmg, 11);

  const snap = normalizeSnapshot({
    date: '2026-11-27',
    repo: { stargazers_count: 6, forks_count: 0 },
    views: { count: 339, uniques: 50 },
    referrers: [{ referrer: 'github.com', count: 8, uniques: 5 }],
    releases,
  });
  assert.equal(snap.netDmgDownloadsEstimated, 11);
  assert.equal(snap.missingOwnerActions.length, 3);

  const cfErr = await fetchCloudflareAnalytics('tok', 'tag', '2026-11-27', async () => ({
    ok: true,
    json: async () => ({ data: null, errors: [{ message: 'invalid token' }] }),
  }));
  assert.equal(cfErr.status, 'error');
});

test('buildIndexNowPayload validates site host/non-empty URLs and submitIndexNow handles 429', async () => {
  assert.throws(() => buildIndexNowPayload({ urls: [] }), /at least one URL/);
  assert.throws(
    () => buildIndexNowPayload({ urls: ['https://evil.example.com/guides/'] }),
    /does not match/,
  );

  const payload = buildIndexNowPayload({
    host: 'cairn.xmon.me',
    key: 'cairn-xmon-me-indexnow-2026',
    urls: ['https://cairn.xmon.me/guides/', 'https://cairn.xmon.me/zh-cn/guides/'],
  });
  assert.equal(payload.keyLocation, 'https://cairn.xmon.me/cairn-xmon-me-indexnow-2026.txt');

  const rateLimited = await submitIndexNow(payload, async () => ({
    ok: false,
    status: 429,
    text: async () => 'Too Many Requests',
  }));
  assert.equal(rateLimited.ok, false);
  assert.equal(rateLimited.status, 429);

  const timedOut = await submitIndexNow(payload, async () => {
    throw new Error('The operation was aborted due to timeout');
  });
  assert.equal(timedOut.ok, false);
  assert.equal(timedOut.status, 0);

  const repoRoot = resolve(import.meta.dirname, '../..');
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        ['scripts/geo/indexnow-submit.mjs', '--urls', 'https://evil.example.com/x/'],
        { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' },
      ),
    /Status|Command failed/,
  );
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        ['scripts/geo/indexnow-submit.mjs', '--sitemap', '/tmp/nonexistent-sitemap-geo.xml'],
        { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' },
      ),
    /Status|Command failed/,
  );

  const failedLive = await verifyLiveDeployment(
    {
      host: 'cairn.xmon.me',
      key: 'cairn-xmon-me-indexnow-2026',
      sampleUrl: 'https://cairn.xmon.me/guides/',
    },
    async (url) => ({
      ok: url.endsWith('.txt'),
      status: url.endsWith('.txt') ? 200 : 404,
      text: async () => 'cairn-xmon-me-indexnow-2026',
    }),
  );
  assert.equal(failedLive.ok, false);

  const cacheDir = makeTestTempDir('geo-indexnow-cache-');
  try {
    const cachePath = join(cacheDir, 'cache.json');
    recordSubmission(cachePath, payload.urlList, 1_000_000);
    assert.equal(shouldSkipRecentSubmission(cachePath, payload.urlList, 1_100_000), true);
    assert.equal(
      shouldSkipRecentSubmission(
        cachePath,
        [...payload.urlList, 'https://cairn.xmon.me/new/'],
        1_100_000,
      ),
      false,
    );
  } finally {
    releaseTestTempDir(cacheDir);
  }
});

test('evaluateMaintenance enforces stale panel ignore, undated/incomplete GSC, topical merge matching, dry-run, and unfreeze', () => {
  const now = new Date('2026-11-27T00:00:00Z');
  const stalePanelRes = evaluateMaintenance({
    now,
    gscExportDate: '2026-11-27',
    panelStale: true,
    panelRows: [
      {
        engine: 'perplexity',
        status: 'checked',
        citedCairn: true,
        citedUrls: ['https://cairn.xmon.me/guides/a/'],
      },
    ],
    pages: [
      {
        url: '/guides/a/',
        locale: 'en',
        cluster: 'c1',
        publishedAt: '2026-10-01',
        state: 'indexed',
      },
    ],
  });
  assert.equal(stalePanelRes.pageActions[0].action, 'KEEP');

  const undatedGsc = evaluateMaintenance({
    now,
    gscRows: [{ url: '/guides/a/', impressions: 10, clicks: 1, position: 4 }],
    pages: [
      {
        url: '/guides/a/',
        locale: 'en',
        cluster: 'c1',
        publishedAt: '2026-10-01',
        state: 'indexed',
      },
    ],
  });
  assert.equal(undatedGsc.growthDecision, 'STALE_GSC_DATA');

  const incompleteGsc = evaluateMaintenance({
    now,
    gscExportDate: '2026-11-27',
    pages: [
      {
        url: '/guides/p1/',
        locale: 'en',
        cluster: 'c1',
        publishedAt: '2026-10-01',
        state: 'indexed',
      },
      {
        url: '/guides/p2/',
        locale: 'en',
        cluster: 'c1',
        publishedAt: '2026-10-01',
        state: 'unknown',
      },
      {
        url: '/guides/p3/',
        locale: 'en',
        cluster: 'c1',
        publishedAt: '2026-10-01',
        state: 'unknown',
      },
    ],
  });
  assert.equal(incompleteGsc.growthDecision, 'INCOMPLETE_GSC_DATA');

  const unrelatedNonHub = evaluateMaintenance({
    now,
    gscExportDate: '2026-11-27',
    pages: [
      {
        url: '/guides/codex-device-code/',
        locale: 'en',
        cluster: 'c1',
        publishedAt: '2026-09-01',
        state: 'crawled_not_indexed',
      },
      {
        url: '/guides/tailscale-subnet-router/',
        locale: 'en',
        cluster: 'c1',
        publishedAt: '2026-09-01',
        state: 'indexed',
      },
    ],
  });
  assert.equal(unrelatedNonHub.pageActions[0].action, 'REWRITE_OR_MANUAL_REVIEW');

  const staleVerify = evaluateMaintenance({
    now,
    gscExportDate: '2026-11-27',
    pages: [
      {
        url: '/guides/old-verify/',
        locale: 'en',
        cluster: 'c1',
        publishedAt: '2026-06-01',
        verifiedDate: '2026-06-01',
        state: 'indexed',
      },
    ],
  });
  assert.equal(staleVerify.pageActions[0].action, 'REFRESH_VERIFICATION');

  const dir = makeTestTempDir('geo-unfreeze-');
  try {
    const repoRoot = resolve(import.meta.dirname, '../..');
    const qPath = join(dir, 'q.jsonl');
    const gscPath = join(dir, 'gsc.json');
    const statePath = join(dir, 'state.json');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      qPath,
      `${[
        JSON.stringify({
          id: 'q-1',
          slug: 'a',
          locale: 'en',
          cluster: 'c1',
          publishedAt: '2026-10-01',
        }),
        JSON.stringify({
          id: 'q-2',
          slug: 'b',
          locale: 'en',
          cluster: 'c1',
          publishedAt: '2026-10-01',
        }),
      ].join('\n')}\n`,
    );
    writeFileSync(
      gscPath,
      JSON.stringify({
        exportedAt: new Date().toISOString().slice(0, 10),
        pages: [
          { url: '/guides/a/', state: 'indexed', impressions: 100, clicks: 30, position: 3 },
          { url: '/guides/b/', state: 'crawled_not_indexed' },
        ],
      }),
    );
    execFileSync(
      process.execPath,
      [
        'scripts/geo/evaluate-maintenance.mjs',
        '--questions',
        qPath,
        '--gsc-json',
        gscPath,
        '--manual-action',
        '--state-file',
        statePath,
      ],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).growthBlocked, true);

    execFileSync(
      process.execPath,
      [
        'scripts/geo/evaluate-maintenance.mjs',
        '--questions',
        qPath,
        '--gsc-json',
        gscPath,
        '--dry-run',
        '--state-file',
        statePath,
      ],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).growthBlocked, true);

    execFileSync(
      process.execPath,
      ['scripts/geo/evaluate-maintenance.mjs', '--questions', qPath, '--state-file', statePath],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    const stillFrozen = JSON.parse(readFileSync(statePath, 'utf8'));
    assert.equal(stillFrozen.growthDecision, 'FREEZE_AND_AUDIT');
    assert.equal(stillFrozen.growthBlocked, true);

    execFileSync(
      process.execPath,
      [
        'scripts/geo/evaluate-maintenance.mjs',
        '--questions',
        qPath,
        '--gsc-json',
        gscPath,
        '--state-file',
        statePath,
      ],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    const unblocked = JSON.parse(readFileSync(statePath, 'utf8'));
    assert.equal(unblocked.growthDecision, 'HOLD');
    assert.equal(unblocked.growthBlocked, false);

    const mdxPath = join(dir, 'site/src/content/docs/guides/a.mdx');
    mkdirSync(join(mdxPath, '..'), { recursive: true });
    writeFileSync(
      mdxPath,
      '---\ntitle: Old verify\ndescription: Old\ngeo:\n  verifiedDate: "2026-01-01"\n---\nBody\n',
    );
    const cliStdout = execFileSync(
      process.execPath,
      [
        'scripts/geo/evaluate-maintenance.mjs',
        '--site-dir',
        join(dir, 'site'),
        '--questions',
        qPath,
        '--gsc-json',
        gscPath,
        '--state-file',
        statePath,
      ],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    const cliReport = JSON.parse(cliStdout);
    assert.equal(
      cliReport.pageActions.find((p) => p.url === '/guides/a/')?.action,
      'REFRESH_VERIFICATION',
    );

    execFileSync(
      process.execPath,
      [
        'scripts/geo/evaluate-maintenance.mjs',
        '--questions',
        qPath,
        '--gsc-json',
        gscPath,
        '--manual-action',
        '--state-file',
        statePath,
      ],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    writeFileSync(
      qPath,
      `${[
        JSON.stringify({
          id: 'q-1',
          slug: 'a',
          locale: 'en',
          cluster: 'c1',
          publishedAt: '2026-10-01',
        }),
        JSON.stringify({
          id: 'q-2',
          slug: 'b',
          locale: 'en',
          cluster: 'c1',
          publishedAt: '2026-10-01',
        }),
        JSON.stringify({
          id: 'q-3',
          slug: 'c',
          locale: 'en',
          cluster: 'c1',
          publishedAt: '2026-11-27',
        }),
      ].join('\n')}\n`,
    );
    execFileSync(
      process.execPath,
      ['scripts/geo/evaluate-maintenance.mjs', '--questions', qPath, '--state-file', statePath],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    const frozenAfterAppend = JSON.parse(readFileSync(statePath, 'utf8'));
    assert.equal(frozenAfterAppend.growthBlocked, true);
    assert.deepEqual(frozenAfterAppend.frozenQuestionIds, ['q-1', 'q-2']);
  } finally {
    releaseTestTempDir(dir);
  }

  const halfIndexedHalfUnknown = evaluateMaintenance({
    now,
    gscExportDate: '2026-11-27',
    pages: Array.from({ length: 10 }, (_, idx) => ({
      url: `/guides/page-${idx + 1}/`,
      locale: 'en',
      cluster: 'c1',
      publishedAt: '2026-10-01',
      state: idx < 5 ? 'indexed' : 'unknown',
    })),
  });
  assert.equal(halfIndexedHalfUnknown.growthDecision, 'HOLD');
  assert.equal(halfIndexedHalfUnknown.verifiedOverallIndexedRatio, 0.5);

  const holdNoExpand = evaluateMaintenance({
    now,
    gscExportDate: '2026-11-27',
    pages: [
      {
        url: '/guides/h1/',
        locale: 'en',
        cluster: 'c1',
        publishedAt: '2026-10-01',
        state: 'indexed',
      },
      {
        url: '/guides/h2/',
        locale: 'en',
        cluster: 'c1',
        publishedAt: '2026-10-01',
        state: 'indexed',
      },
      {
        url: '/guides/h3/',
        locale: 'en',
        cluster: 'c1',
        publishedAt: '2026-10-01',
        state: 'indexed',
      },
      {
        url: '/guides/h4/',
        locale: 'en',
        cluster: 'c1',
        publishedAt: '2026-10-01',
        state: 'crawled_not_indexed',
      },
    ],
    gscRows: [{ url: '/guides/h1/', impressions: 100, clicks: 40, position: 2 }],
    panelRows: [
      {
        engine: 'perplexity',
        status: 'checked',
        citedCairn: true,
        citedUrls: ['https://cairn.xmon.me/guides/h1/'],
      },
    ],
  });
  assert.equal(holdNoExpand.growthDecision, 'HOLD');
  assert.equal(holdNoExpand.pageActions.find((p) => p.url === '/guides/h1/')?.action, 'KEEP');

  const allNewUnknown = evaluateMaintenance({
    now,
    gscExportDate: '2026-11-27',
    pages: [
      {
        url: '/guides/o1/',
        locale: 'en',
        cluster: 'c1',
        publishedAt: '2026-06-01',
        state: 'indexed',
      },
      {
        url: '/guides/o2/',
        locale: 'en',
        cluster: 'c1',
        publishedAt: '2026-06-01',
        state: 'indexed',
      },
      {
        url: '/guides/o3/',
        locale: 'en',
        cluster: 'c1',
        publishedAt: '2026-06-01',
        state: 'indexed',
      },
      {
        url: '/guides/o4/',
        locale: 'en',
        cluster: 'c1',
        publishedAt: '2026-06-01',
        state: 'indexed',
      },
      {
        url: '/guides/n1/',
        locale: 'en',
        cluster: 'c1',
        publishedAt: '2026-10-01',
        state: 'unknown',
      },
      {
        url: '/guides/n2/',
        locale: 'en',
        cluster: 'c1',
        publishedAt: '2026-10-01',
        state: 'unknown',
      },
    ],
  });
  assert.equal(allNewUnknown.growthDecision, 'INCOMPLETE_GSC_DATA');

  const staleGsc = evaluateMaintenance({
    now,
    gscExportDate: '2026-10-01',
    pages: [
      {
        url: '/guides/a/',
        locale: 'en',
        cluster: 'c1',
        publishedAt: '2026-10-01',
        state: 'crawled_not_indexed',
      },
    ],
  });
  assert.equal(staleGsc.growthDecision, 'STALE_GSC_DATA');
  assert.equal(staleGsc.growthBlocked, false);

  const mergedRepeat = evaluateMaintenance({
    now,
    existingRedirects: [{ source: '/guides/old-merge/' }],
    pages: [
      {
        url: '/guides/old-merge/',
        locale: 'en',
        cluster: 'c1',
        publishedAt: '2026-09-01',
        state: 'crawled_not_indexed',
      },
      {
        url: '/guides/partial-unknown/',
        locale: 'en',
        cluster: 'c1',
        publishedAt: '2026-10-01',
        state: 'unknown',
      },
      {
        url: '/guides/winner/',
        locale: 'en',
        cluster: 'c1',
        publishedAt: '2026-09-01',
        state: 'indexed',
      },
    ],
  });
  assert.equal(
    mergedRepeat.pageActions.find((p) => p.url === '/guides/old-merge/').action,
    'ALREADY_MERGED_301',
  );
  assert.equal(
    mergedRepeat.pageActions.find((p) => p.url === '/guides/partial-unknown/').action,
    'WAIT_FOR_GSC',
  );
});

test('fetchGithubSnapshot degrades cleanly on 403/rate-limit and snapshot-metrics CLI degrades without creds', () => {
  const ghPartial = fetchGithubSnapshot((endpoint) => {
    if (endpoint.includes('traffic')) throw new Error('HTTP 403 Forbidden');
    if (endpoint.endsWith('cairn')) return { stargazers_count: 6, forks_count: 0 };
    return [];
  });
  assert.match(ghPartial.githubStatus, /^partial_error:/);
  assert.equal(ghPartial.repo.stargazers_count, 6);
  const snap = normalizeSnapshot({
    date: '2026-11-27',
    repo: ghPartial.repo,
    views: ghPartial.views,
    referrers: ghPartial.referrers,
    releases: ghPartial.releases,
    githubStatus: ghPartial.githubStatus,
  });
  assert.equal(snap.stars, 6);
  assert.equal(snap.missingOwnerActions.length, 3);

  const dir = makeTestTempDir('geo-snap-cli-');
  try {
    const repoRoot = resolve(import.meta.dirname, '../..');
    const outPath = join(dir, 'snap.jsonl');
    const stdout = execFileSync(
      process.execPath,
      ['scripts/geo/snapshot-metrics.mjs', '--out', outPath],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          PATH: process.execPath.replace(/\/[^/]+$/, ''),
          HOME: dir,
        },
      },
    );
    const parsed = JSON.parse(stdout);
    assert.match(parsed.githubStatus, /^error:/);
    assert.equal(parsed.missingOwnerActions.length, 3);
    assert.equal(readFileSync(outPath, 'utf8').trim().split('\n').length, 1);
  } finally {
    releaseTestTempDir(dir);
  }
});
