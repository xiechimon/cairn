import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { expect, test } from 'vitest';

const SRC = resolve(import.meta.dirname, '../src');
const SHARED = 'components/chat/failure-marker.tsx';
const ROW_DIRS = ['detail', 'components/chat'];
const ROW_FILE = /^chief\/[\w-]*rows?\.tsx$/;
const FAIL_TONE = /--fail-fg|--destructive|text-destructive|chat-para--fail/;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx$/.test(entry.name) ? [relative(SRC, path)] : [];
  });
}

function offenders(): string[] {
  return sources(SRC).filter((file) => {
    if (file === SHARED) return false;
    const code = readFileSync(join(SRC, file), 'utf8');
    if (!/<CircleAlert\b/.test(code)) return false;
    const marker = /components\/ui\/marker\.js|['"]\.\/marker\.js['"]/.test(code);
    const row = ROW_DIRS.some((dir) => file.startsWith(`${dir}/`)) || ROW_FILE.test(file);
    return marker || (row && FAIL_TONE.test(code));
  });
}

test('C32: a failure row in a conversation is drawn only by FailureMarker', () => {
  expect(
    offenders(),
    `C32: these files draw their own failure row; render FailureMarker from src/${SHARED} instead`,
  ).toEqual([]);
});
