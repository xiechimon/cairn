import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect, test } from '@playwright/test';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { bootLiveServer, type LiveServer } from './live-server';

let live: LiveServer;
let proxy: ReturnType<typeof createServer>;
let origin: string;
let certificates: string;

test.beforeAll(async () => {
  certificates = makeTestTempDir('owner-cert-');
  const key = join(certificates, 'key.pem');
  const cert = join(certificates, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=cairn.tail.example'], { stdio: 'ignore' });
  const binary = join(certificates, 'sidecar');
  writeFileSync(binary, `#!${process.execPath}\nprocess.stdout.write(JSON.stringify({type:'ready',dnsName:'cairn.tail.example',ownerLogin:'owner@example.com',selfTagged:false})+'\\n');\nprocess.stdin.on('data',()=>process.exit(0));\n`, { mode: 0o700 });
  live = await bootLiveServer('tailnet-browser-test-secret', { CAIRN_TSNET: '1', CAIRN_TSNET_BINARY: binary, CAIRN_TAILSCALE_USERS: '' });
  proxy = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (incoming, outgoing) => {
    const headers = { ...incoming.headers };
    for (const name of Object.keys(headers)) if (name.startsWith('tailscale-')) delete headers[name];
    headers['tailscale-user-login'] = 'owner@example.com';
    const upstream = request({ socketPath: join(live.home, 'tsnet', 'tailnet.sock'), path: incoming.url, method: incoming.method, headers }, (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(outgoing);
    });
    upstream.on('error', () => { outgoing.writeHead(502); outgoing.end(); });
    outgoing.on('close', () => upstream.destroy());
    incoming.pipe(upstream);
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  origin = `https://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  if (proxy !== undefined) await new Promise<void>((resolve) => { proxy.closeAllConnections(); proxy.close(() => resolve()); });
  await live?.dispose();
  if (certificates !== undefined) releaseTestTempDir(certificates);
});

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1440, 390]) {
    test(`owner opens Remote access without a token, ${theme} ${width}`, async ({}, testInfo) => {
      const browser = await chromium.launch({ args: ['--no-proxy-server'] });
      const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height: 900 }, colorScheme: theme });
      try {
        const page = await context.newPage();
        await page.addInitScript((theme) => {
          localStorage.setItem('cairn-theme', theme);
          localStorage.setItem('cairn.locale', 'en');
          localStorage.setItem('cairn-locale', 'en');
        }, theme);
        const teams = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/teams');
        void teams.catch(() => {});
        await page.goto(`${origin}/app/settings/remote`);
        expect((await teams).status()).toBe(401);
        await expect(page.locator('.token-gate')).toBeVisible();
        await expect(page.locator('.token-gate-title')).toHaveText('Pair this computer');
        await expect(page.getByTestId('tailnet-owner-identity')).toHaveCount(0);
        expect(await page.evaluate(() => localStorage.getItem('cairn.token'))).toBeNull();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`pair-${theme}-${width}.png`), fullPage: true });
        const identity = await page.evaluate(async () => {
          const response = await fetch('/api/remote/identity');
          return { status: response.status, body: await response.json() as { login: null; via: null } };
        });
        expect(identity.status).toBe(401);
        const transcript = testInfo.outputPath('calls.txt');
        writeFileSync(transcript, [
          'Isolated live server; synthetic sidecar metadata and HTTPS identity proxy.',
          'No bearer token or session cookie used as an authentication credential.',
          '',
          'GET /api/teams',
          `HTTP ${(await teams).status()}`,
          '',
          'GET /api/remote/identity',
          `HTTP ${identity.status}`,
          JSON.stringify(identity.body),
          '',
          'Pair page shown. Tailscale identity did not sign the browser in.',
        ].join('\n'));
        const viewer = await context.newPage();
        await viewer.goto(pathToFileURL(transcript).href);
        await viewer.screenshot({ path: testInfo.outputPath('calls.png'), fullPage: true });
        await viewer.close();
      } finally {
        await context.close();
        await browser.close();
      }
    });
  }
}
