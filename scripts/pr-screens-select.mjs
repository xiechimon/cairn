#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const SOURCES_FILE = 'apps/web/pr-screens/route-sources.json';
const AUDIT_PAGES = 'apps/web/e2e/audit-pages.ts';
const STATE_PAGES = 'apps/web/pr-screens/state-pages.ts';
const IGNORED = ['apps/web/e2e/', 'apps/web/test/', 'apps/web/src/design/', 'apps/web/src/demo/'];
const IGNORED_FILES = /\.(?:md|test\.tsx?)$/;

export function slugOf(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function pageNames(auditPagesSource) {
  return [...auditPagesSource.matchAll(/\bname: '([^']+)',\s*url:/g)].map((match) => match[1]);
}

export function selectPages({ changed, sources, slugs }) {
  const relevant = changed.filter(
    (path) =>
      path === AUDIT_PAGES ||
      (!IGNORED.some((prefix) => path.startsWith(prefix)) && !IGNORED_FILES.test(path)),
  );
  const touched = new Set();
  let shared = false;
  for (const path of relevant) {
    if (!path.startsWith('apps/web/src/')) {
      if (
        path.startsWith('apps/web/') &&
        !/^apps\/web\/(?:public\/|index\.html|design\.html|vite\.config\.ts|postcss\.config\.js|pr-screens\/|playwright\.pr-screens|e2e\/audit-pages)/.test(
          path,
        )
      )
        continue;
      shared = true;
      continue;
    }
    const owners = slugs.filter((slug) =>
      (sources[slug] ?? []).some((prefix) => path.startsWith(prefix)),
    );
    if (owners.length === 0) shared = true;
    for (const slug of owners) touched.add(slug);
  }
  const unmapped = slugs.filter((slug) => sources[slug] === undefined);
  if (shared) return { all: true, pages: slugs };
  return {
    all: false,
    pages: slugs.filter(
      (slug) => touched.has(slug) || (touched.size > 0 && unmapped.includes(slug)),
    ),
  };
}

function main(argv) {
  const option = (name) => argv[argv.indexOf(name) + 1];
  const changed = execFileSync('git', ['diff', '--name-only', option('--base'), option('--head')], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
  const sources = JSON.parse(readFileSync(resolve(REPO_ROOT, SOURCES_FILE), 'utf8'));
  const slugsIn = (file) => [
    ...new Set(pageNames(readFileSync(resolve(REPO_ROOT, file), 'utf8')).map(slugOf)),
  ];
  const stateSlugs = slugsIn(STATE_PAGES);
  const slugs = [...slugsIn(AUDIT_PAGES), ...stateSlugs];
  const { all, pages } = selectPages({ changed, sources, slugs });
  process.stdout.write(
    `${JSON.stringify({
      all,
      count: pages.length,
      live: pages.filter((slug) => stateSlugs.includes(slug)).length,
      total: slugs.length,
      pages: pages.join(','),
    })}\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
