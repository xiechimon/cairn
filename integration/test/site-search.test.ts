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
