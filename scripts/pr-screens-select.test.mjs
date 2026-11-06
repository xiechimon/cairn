import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { pageNames, selectPages, slugOf } from './pr-screens-select.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const sources = JSON.parse(
  readFileSync(resolve(ROOT, 'apps/web/pr-screens/route-sources.json'), 'utf8'),
);
const slugsOf = (file) => [
  ...new Set(pageNames(readFileSync(resolve(ROOT, file), 'utf8')).map(slugOf)),
];
const slugs = [
  ...slugsOf('apps/web/e2e/audit-pages.ts'),
  ...slugsOf('apps/web/pr-screens/state-pages.ts'),
];

test('every audited page has a route-sources entry and every entry names an audited page', () => {
  assert.deepEqual(Object.keys(sources).sort(), [...slugs].sort());
});

test('every source prefix points at a tracked path', () => {
  const tracked = readFileSync(resolve(ROOT, 'apps/web/e2e/audit-pages.ts'), 'utf8').length > 0;
  assert.ok(tracked);
  for (const [slug, prefixes] of Object.entries(sources)) {
    assert.ok(prefixes.length > 0, slug);
    for (const prefix of prefixes)
      assert.ok(prefix.startsWith('apps/web/src/'), `${slug}: ${prefix}`);
  }
});

test('a change to one route module selects only the pages that route owns', () => {
  const result = selectPages({
    changed: ['apps/web/src/routes/api-keys-page.tsx'],
    sources,
    slugs,
  });
  assert.deepEqual(result, { all: false, pages: ['api-keys'] });
});

test('a change inside a directory shared by several pages selects those pages', () => {
  const result = selectPages({
    changed: ['apps/web/src/resources/secrets-page.tsx', 'apps/web/src/search/query-chip.tsx'],
    sources,
    slugs,
  });
  assert.deepEqual(result.pages, ['search', 'secrets']);
  assert.equal(result.all, false);
});

test('provider files select the providers page and its loading and error states by prefix', () => {
  assert.deepEqual(
    selectPages({ changed: ['apps/web/src/resources/provider-model-list.tsx'], sources, slugs })
      .pages,
    ['providers', 'settings-loading', 'settings-error'],
  );
});

test('shared surfaces select every page', () => {
  for (const path of [
    'apps/web/src/components/ui/button.tsx',
    'apps/web/src/styles/app.css',
    'apps/web/src/lib/format.ts',
    'apps/web/src/App.tsx',
    'packages/shared/src/schema.ts',
    'pnpm-lock.yaml',
    'apps/web/vite.config.ts',
    'apps/web/e2e/audit-pages.ts',
    'apps/web/pr-screens/capture.shots.ts',
  ]) {
    const result = selectPages({
      changed: ['apps/web/src/routes/api-keys-page.tsx', path],
      sources,
      slugs,
    });
    assert.equal(result.all, true, path);
    assert.equal(result.pages.length, slugs.length, path);
  }
});

test('tests, docs and the gallery select nothing', () => {
  const result = selectPages({
    changed: [
      'apps/web/e2e/team.spec.ts',
      'apps/web/src/design/gallery.tsx',
      'apps/web/DESIGN.md',
      'apps/web/src/routes/team-page.test.tsx',
    ],
    sources,
    slugs,
  });
  assert.deepEqual(result, { all: false, pages: [] });
});

test('a change to the home surface selects the first-run state page, and a state page names itself live', () => {
  const result = selectPages({
    changed: ['apps/web/src/board/first-run-checklist.tsx'],
    sources,
    slugs,
  });
  assert.ok(result.pages.includes('first-run-home'));
  assert.ok(result.pages.includes('failed-thread'));
});

test('a change under api/ is shared and selects every page, state pages included', () => {
  const result = selectPages({ changed: ['apps/web/src/api/mappers.ts'], sources, slugs });
  assert.equal(result.all, true);
  assert.deepEqual(result.pages, slugs);
});
