import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { type Browser, expect as browserExpect, chromium } from '@playwright/test';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { spawnOwned } from '../../scripts/owned-process.mjs';
import { testRunPort } from '../../scripts/test-admission.mjs';

let server: ReturnType<typeof spawnOwned>;
let browser: Browser;
let baseUrl: string;

beforeAll(async () => {
  baseUrl = `http://127.0.0.1:${await testRunPort(8521)}`;
  server = spawnOwned(
    'pnpm',
    [
      '--filter',
      '@cairn/site',
      'exec',
      'astro',
      'dev',
      '--ignore-lock',
      '--host',
      '127.0.0.1',
      '--port',
      new URL(baseUrl).port,
    ],
    {
      cwd: resolve(import.meta.dirname, '../..'),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, VITEST: '', NODE_ENV: 'development' },
    },
  );
  let output = '';
  server.child.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  server.child.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  let readiness = '';
  for (let attempt = 0; ; attempt += 1) {
    const ready = await fetch(baseUrl)
      .then((response) => {
        readiness = `HTTP ${response.status}: ${response.statusText}`;
        return response.ok;
      })
      .catch((error: Error) => {
        readiness = `${error.message}: ${error.cause}`;
        return false;
      });
    if (ready) break;
    if (attempt === 150 || server.child.exitCode !== null) {
      throw new Error(`Site did not start: ${readiness}\n${output}`);
    }
    await setTimeout(200);
  }
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
  await server?.stop();
});

test.each([
  { locale: 'zh-CN', preference: null, path: '/', expectedPath: '/zh-cn/' },
  { locale: 'en-US', preference: 'zh', path: '/', expectedPath: '/zh-cn/' },
  { locale: 'zh-CN', preference: 'en', path: '/', expectedPath: '/' },
  { locale: 'en-US', preference: null, path: '/', expectedPath: '/' },
  { locale: 'en-US', preference: 'en', path: '/zh-cn/', expectedPath: '/zh-cn/' },
])(
  'language selection preserves attribution: $locale / $preference / $path',
  async ({ locale, preference, path, expectedPath }) => {
    const context = await browser.newContext({
      locale,
      storageState: {
        cookies: [],
        origins:
          preference === null
            ? []
            : [{ origin: baseUrl, localStorage: [{ name: 'cairn-lang', value: preference }] }],
      },
    });
    try {
      await context.route('https://static.cloudflareinsights.com/**', (route) =>
        route.fulfill({ contentType: 'application/javascript', body: '' }),
      );
      const page = await context.newPage();
      const suffix = '?utm_source=chatgpt.com&utm_campaign=first%20task&tag=a&tag=b#install';
      await page.goto(`${baseUrl}${path}${suffix}`);
      await browserExpect(page).toHaveURL(`${baseUrl}${expectedPath}${suffix}`);
      await browserExpect(page.locator('html')).toHaveAttribute(
        'lang',
        expectedPath === '/' ? 'en' : 'zh-CN',
      );
      await browserExpect(page.locator('main h1')).toBeVisible();
    } finally {
      await context.close();
    }
  },
);

test('robots advertises the production sitemap without blocking public crawlers', async () => {
  const response = await fetch(`${baseUrl}/robots.txt`);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/plain');
  const robots = await response.text();
  expect(robots).toMatch(/^User-agent: \*$/m);
  expect(robots).toMatch(/^Allow: \/$/m);
  expect(robots).not.toMatch(/^Disallow: \//m);
  expect(robots).toContain('Sitemap: https://cairn.xmon.me/sitemap-index.xml');
});

test('llms.txt serves a document index whose public site links resolve', async () => {
  const response = await fetch(`${baseUrl}/llms.txt`);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/plain');
  const index = await response.text();
  expect(index).toMatch(/^# Cairn\n/);
  expect(index).toContain('self-hosted');
  const links = [...index.matchAll(/\]\((https:\/\/cairn\.xmon\.me\/[^)]*)\)/g)];
  expect(links.length).toBeGreaterThanOrEqual(2);
  for (const [, href] of links) {
    const target = new URL(href!);
    const page = await fetch(`${baseUrl}${target.pathname}`);
    expect(page.status, href).toBe(200);
  }
});

test('all public pages load one deferred Cloudflare beacon with the site token', async () => {
  const context = await browser.newContext({ locale: 'en-US' });
  try {
    await context.route('https://static.cloudflareinsights.com/**', (route) =>
      route.fulfill({ contentType: 'application/javascript', body: '' }),
    );
    const page = await context.newPage();
    const docs = ['intro', 'install', 'models', 'runner', 'first-task', 'faq'];
    const paths = [
      '/',
      '/zh-cn/',
      ...docs.flatMap((slug) => [`/docs/${slug}/`, `/zh-cn/docs/${slug}/`]),
      '/missing-page/',
    ];
    for (const path of paths) {
      const response = await page.goto(`${baseUrl}${path}`);
      expect(response?.status(), path).toBe(path === '/missing-page/' ? 404 : 200);
      const beacon = page.locator(
        'script[src="https://static.cloudflareinsights.com/beacon.min.js"]',
      );
      await browserExpect(beacon).toHaveCount(1);
      expect(await beacon.getAttribute('defer'), path).not.toBeNull();
      expect(JSON.parse((await beacon.getAttribute('data-cf-beacon')) ?? '{}'), path).toEqual({
        token: 'a2f5ef9618404d5ea00a0820a8a1fba3',
      });
      await browserExpect(page.locator('script[src*="vercel-insights"]')).toHaveCount(0);
    }
  } finally {
    await context.close();
  }
});

const evalResultsUrl = 'https://raw.githubusercontent.com/xiechimon/cairn/eval-results/latest.json';

function publicEvalPayload(date = new Date().toISOString()) {
  return {
    version: 1,
    dataset: 'cairn-eval-suite',
    suiteVersion: 1,
    date,
    sha: 'a'.repeat(40),
    status: 'incomplete',
    summary: {
      total: 4,
      passed: 2,
      failed: 1,
      incomplete: 1,
      byKind: {
        lane: { total: 1, passed: 1, failed: 0, incomplete: 0 },
        runtime: { total: 2, passed: 1, failed: 1, incomplete: 0 },
        canary: { total: 1, passed: 0, failed: 0, incomplete: 1 },
      },
    },
    cases: [
      {
        caseId: 'fix-bug',
        kind: 'lane',
        status: 'pass',
        passed: 1,
        failed: 0,
        incomplete: 0,
        trials: 1,
        model: 'Devin CLI · model not recorded',
      },
      {
        caseId: 'answer-read-01',
        kind: 'runtime',
        status: 'partial',
        passed: 1,
        failed: 1,
        incomplete: 0,
        trials: 2,
        model: 'fauxProvider replay',
      },
      {
        caseId: 'canary-answer',
        kind: 'canary',
        status: 'incomplete',
        passed: 0,
        failed: 0,
        incomplete: 1,
        trials: 1,
        model: 'fauxProvider replay',
      },
    ],
  };
}

test.each([
  {
    name: 'English',
    path: '/',
    locale: 'en-US',
    latest: 'Latest daily eval',
    kindScore: 'Real coding 1/1',
    shortKind: 'Real coding',
    details: 'Per-case results',
    status: 'Incomplete',
  },
  {
    name: 'Chinese',
    path: '/zh-cn/',
    locale: 'zh-CN',
    latest: '最新每日评测',
    kindScore: '真实编码 1/1',
    shortKind: '真实编码',
    details: '逐题结果',
    status: '未完成',
  },
])(
  'renders public eval results in both locales: $name',
  async ({ path, locale, latest, kindScore, shortKind, details, status }) => {
    const context = await browser.newContext({ locale });
    try {
      let requested = false;
      await context.route(evalResultsUrl, (route) => {
        requested = true;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(publicEvalPayload()),
        });
      });
      const page = await context.newPage();
      await page.goto(`${baseUrl}${path}`);
      await browserExpect(page.locator('#eval-live')).toBeVisible();
      expect(requested).toBe(true);
      await browserExpect(page.locator('#eval-empty')).toBeHidden();
      await browserExpect(page.locator('#eval-date')).toContainText(latest);
      await browserExpect(page.locator('#eval-score')).toContainText(kindScore);
      await browserExpect(page.locator('[data-eval-bar-fill]')).toHaveCount(3);
      expect(await page.locator('[data-eval-bar-fill="lane"]').getAttribute('width')).toBe('224');
      expect(await page.locator('[data-eval-bar-fill="runtime"]').getAttribute('width')).toBe(
        '112',
      );
      expect(await page.locator('[data-eval-bar-fill="canary"]').getAttribute('width')).toBe('0');
      type StyledNode = {
        ownerDocument: {
          defaultView: { getComputedStyle(node: StyledNode): { fill: string } } | null;
        };
      };
      const readFill = (node: StyledNode) =>
        node.ownerDocument.defaultView?.getComputedStyle(node).fill ?? '';
      const trackFill = await page.locator('[data-eval-bar="track"]').first().evaluate(readFill);
      const barFill = await page.locator('[data-eval-bar-fill="lane"]').evaluate(readFill);
      expect(trackFill).not.toBe('');
      expect(barFill).not.toBe('');
      expect(trackFill).not.toBe('rgb(0, 0, 0)');
      expect(barFill).not.toBe('rgb(0, 0, 0)');
      expect(barFill).not.toBe(trackFill);
      await page.locator('#eval-details summary').focus();
      await page.keyboard.press('Enter');
      await browserExpect(page.locator('#eval-details')).toBeVisible();
      expect(await page.locator('#eval-details summary').textContent()).toContain(details);
      const rows = page.locator('#eval-case-rows tr');
      await browserExpect(rows).toHaveCount(3);
      await browserExpect(rows.nth(0)).toContainText('fix-bug');
      await browserExpect(rows.nth(0)).toContainText(shortKind);
      await browserExpect(rows.nth(0)).toContainText('Devin CLI · model not recorded');
      await browserExpect(rows.nth(1).locator('td').nth(2)).toHaveText('1/2');
      await browserExpect(rows.nth(1).locator('td').nth(3)).toHaveText('1');
      await browserExpect(rows.nth(1).locator('td').nth(4)).toHaveText('0');
      await browserExpect(rows.nth(2).locator('td').nth(2)).toHaveText('0/1');
      await browserExpect(rows.nth(2).locator('td').nth(3)).toHaveText('0');
      await browserExpect(rows.nth(2).locator('td').nth(4)).toHaveText('1');
      await browserExpect(rows.nth(2)).toContainText(status);
    } finally {
      await context.close();
    }
  },
);

test('keeps neutral fallback when public results unavailable', async () => {
  const inconsistent = publicEvalPayload();
  inconsistent.summary.byKind.lane.passed = 0;
  const summaryMismatch = publicEvalPayload();
  summaryMismatch.summary.total = 99;
  summaryMismatch.summary.passed = 97;
  const negativeCaseCount = publicEvalPayload();
  const firstCase = negativeCaseCount.cases[0];
  if (!firstCase) throw new Error('expected first case');
  firstCase.passed = -1;
  firstCase.failed = 2;
  const { sha: _omittedSha, ...missingMetadata } = publicEvalPayload();
  const emptyCases = { ...publicEvalPayload(), cases: [] };
  const scenarios = [
    {
      name: 'missing metadata',
      respond: (route: import('@playwright/test').Route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(missingMetadata),
        }),
    },
    {
      name: 'http 404',
      respond: (route: import('@playwright/test').Route) =>
        route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
    },
    {
      name: 'http 429',
      respond: (route: import('@playwright/test').Route) =>
        route.fulfill({ status: 429, contentType: 'application/json', body: '{}' }),
    },
    {
      name: 'http 500',
      respond: (route: import('@playwright/test').Route) =>
        route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
    },
    {
      name: 'inconsistent counts',
      respond: (route: import('@playwright/test').Route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(inconsistent),
        }),
    },
    {
      name: 'summary mismatch',
      respond: (route: import('@playwright/test').Route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(summaryMismatch),
        }),
    },
    {
      name: 'negative case count',
      respond: (route: import('@playwright/test').Route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(negativeCaseCount),
        }),
    },
    {
      name: 'empty cases',
      respond: (route: import('@playwright/test').Route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(emptyCases),
        }),
    },
    {
      name: 'malformed json',
      respond: (route: import('@playwright/test').Route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '{broken' }),
    },
    {
      name: 'network abort',
      respond: (route: import('@playwright/test').Route) => route.abort(),
    },
  ];
  for (const scenario of scenarios) {
    const context = await browser.newContext({ locale: 'en-US' });
    try {
      let requested = false;
      await context.route(evalResultsUrl, (route) => {
        requested = true;
        return scenario.respond(route);
      });
      const page = await context.newPage();
      await page.goto(`${baseUrl}/`);
      for (let attempt = 0; attempt < 60 && !requested; attempt += 1) await setTimeout(50);
      expect(requested, scenario.name).toBe(true);
      await setTimeout(150);
      await browserExpect(page.locator('#eval-empty'), scenario.name).toBeVisible();
      await browserExpect(page.locator('#eval-empty'), scenario.name).toContainText(
        'Public eval results are unavailable',
      );
      await browserExpect(page.locator('#eval-live'), scenario.name).toBeHidden();
    } finally {
      await context.close();
    }
  }

  const noJs = await browser.newContext({ locale: 'en-US', javaScriptEnabled: false });
  try {
    const page = await noJs.newPage();
    await page.goto(`${baseUrl}/`);
    await browserExpect(page.locator('#eval-empty')).toContainText(
      'Public eval results are unavailable',
    );
  } finally {
    await noJs.close();
  }
});

test('marks stale public eval results', async () => {
  const context = await browser.newContext({ locale: 'en-US' });
  try {
    await context.route(evalResultsUrl, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          publicEvalPayload(new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString()),
        ),
      }),
    );
    const page = await context.newPage();
    await page.goto(`${baseUrl}/`);
    await browserExpect(page.locator('#eval-live')).toBeVisible();
    await browserExpect(page.locator('#eval-date')).toContainText('Latest daily eval');
    await browserExpect(page.locator('#eval-stale')).toContainText('This snapshot may be stale');
  } finally {
    await context.close();
  }
});
