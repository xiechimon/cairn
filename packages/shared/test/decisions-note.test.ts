import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const SOURCE_DIRS = ['apps/server/src', 'apps/daemon/src', 'apps/web/src', 'packages/shared/src'];
const RENDERER_HOME = 'packages/shared/src/records/prompts.ts';
const RENDERER_CALLER = 'apps/daemon/src/step-prompt.ts';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const files = SOURCE_DIRS.flatMap((dir) => sourceFiles(join(ROOT, dir))).map((path) => ({
  path: relative(ROOT, path),
  text: readFileSync(path, 'utf8'),
}));

describe('task decisions reach the agent through one renderer', () => {
  test('only the daemon renders the decisions section into a prompt', () => {
    const callers = files
      .filter(({ path }) => path !== RENDERER_HOME)
      .filter(({ text }) => text.includes('appendDecisionsNote('))
      .map(({ path }) => path);
    expect(callers).toEqual([RENDERER_CALLER]);
  });

  test('no source builds task text from the spec and the decisions', () => {
    const splicers = files
      .filter(({ text }) => /specWithDecisions|decidedSpec|spec[^\n;]{0,80}\.decisions/.test(text))
      .map(({ path }) => path);
    expect(splicers).toEqual([]);
  });
});
