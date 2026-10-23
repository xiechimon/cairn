import assert from 'node:assert/strict';
import test from 'node:test';
import { missingPackages, packagesIn } from './npm-command-gate.mjs';

test('collects package names from npx and npm install commands', () => {
  const text = [
    '<pre>npx @xiechimon/cairn</pre>',
    'Use `PORT=9000 npx -y @xiechimon/pacman`.',
    'npm i -g @xiechimon/pacman-cli',
    "toHaveText('npm install -g @xiechimon/pacman-cli@latest')",
    'npx playwright test',
    'pnpm install',
  ].join('\n');
  assert.deepEqual(packagesIn(text), [
    '@xiechimon/cairn',
    '@xiechimon/pacman',
    '@xiechimon/pacman-cli',
    'playwright',
  ]);
});

test('collects package names from the PUBLISHED_PACKAGES table', () => {
  const text = [
    "export const BRAND = { cliPackageName: '@xiechimon/cairn-cli' } as const;",
    'export const PUBLISHED_PACKAGES = {',
    "  cli: { name: '@xiechimon/pacman-cli', command: 'pacman' },",
    "  server: { name: '@xiechimon/pacman', command: 'pacman' },",
    '} as const;',
  ].join('\n');
  assert.deepEqual(packagesIn(text), ['@xiechimon/pacman-cli', '@xiechimon/pacman']);
});

test('reports packages the registry answers 404 for', async () => {
  const published = new Set(['@xiechimon/pacman']);
  const fetchFn = async (url) => ({
    status: published.has(decodeURIComponent(url.split('/').pop())) ? 200 : 404,
  });
  assert.deepEqual(
    await missingPackages(
      {
        'site/index.html': '<pre>npx @xiechimon/cairn</pre>',
        'README.md': 'npx @xiechimon/pacman',
      },
      fetchFn,
    ),
    [{ name: '@xiechimon/cairn', files: ['site/index.html'] }],
  );
});
