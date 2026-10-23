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
