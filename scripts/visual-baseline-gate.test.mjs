import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  baselineDiffErrors,
  importGraph,
  pageRoots,
  pagesUsing,
  sharedComponentCoverageErrors,
} from './visual-baseline-gate.mjs';

const registered = new Set(['workbench']);
const baseline = 'apps/web/e2e/visual-baseline.spec.ts-snapshots/workbench-dark-linux.png';
const { surfaces } = JSON.parse(
  readFileSync(new URL('../apps/web/e2e/visual-surfaces.json', import.meta.url), 'utf8'),
);

test('changing or removing a baseline is red until a commit names the surface', () => {
  for (const [status, now] of [
    ['M', registered],
    ['D', new Set()],
  ]) {
    const rows = [[status, baseline]];
    assert.match(
      baselineDiffErrors({ rows, declared: new Set(), registered: now })[0],
      /Visual-Surfaces: workbench/,
    );
    for (const declared of [new Set(['workbench']), new Set(['all'])]) {
      assert.deepEqual(baselineDiffErrors({ rows, declared, registered: now }), []);
    }
  }
});

test('new coverage is green, while deleting a registered surface baseline is red', () => {
  assert.deepEqual(
    baselineDiffErrors({ rows: [['A', baseline]], declared: new Set(), registered }),
    [],
  );
  assert.equal(
    baselineDiffErrors({ rows: [['D', baseline]], declared: new Set(['all']), registered }).length,
    1,
  );
});

test('a shared component is traced to every real page that renders it', () => {
  const pages = pagesUsing('apps/web/src/components/chat/message-body.tsx', importGraph());
  assert.deepEqual(pages, [
    'apps/web/src/board/side-chat.tsx',
    'apps/web/src/chief/chief-conversation.tsx',
  ]);
});

test('a page that uses a shared component without a surface is red', () => {
  const component = 'apps/web/src/components/chat/message-body.tsx';
  const errors = sharedComponentCoverageErrors({
    files: [component],
    surfaces: surfaces.filter((surface) => surface.id !== 'thread'),
    dependencies: importGraph(),
    baselineExists: () => true,
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /board\/side-chat\.tsx has no visual surface/);
});

test('a type-only import does not make a page render a component', () => {
  const dependencies = new Map([
    ['apps/web/src/a-page.tsx', []],
    ['apps/web/src/b-page.tsx', []],
  ]);
  assert.deepEqual(pagesUsing('apps/web/src/components/x.tsx', dependencies), []);
});

test('every page in the web app has a surface, so any shared component can be compared', () => {
  const dependencies = importGraph();
  const covered = new Set(surfaces.flatMap((surface) => surface.sources));
  const components = [...dependencies.keys()].filter((file) =>
    file.startsWith('apps/web/src/components/'),
  );
  const uncovered = pageRoots(dependencies).filter(
    (page) =>
      !covered.has(page) &&
      components.some((component) => {
        const pages = pagesUsing(component, dependencies);
        return pages.length > 1 && pages.includes(page);
      }),
  );
  assert.deepEqual(uncovered, []);
});
