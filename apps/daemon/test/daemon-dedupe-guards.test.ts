import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');
const DAEMON_SRC = join(REPO_ROOT, 'apps', 'daemon', 'src');
const SERVER_SRC = join(REPO_ROOT, 'apps', 'server', 'src');

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

function readRepo(relPath: string): string {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

const SLEEP_PROMISE_RE = /new Promise(?:<void>)?\(\s*\(?\w+\)?\s*=>\s*setTimeout\(/;
const SLEEP_PROMISE_ALLOWLIST = new Set(['apps/daemon/src/machine-client.ts']);

describe('daemon and server helper deduplication guards', () => {
  test('managed tool installers reuse unsafeManagedVersion and sha256File from @cairn/shared/managed-bin', () => {
    for (const rel of [
      'apps/daemon/src/backend/managed-runtime.ts',
      'apps/daemon/src/backend/runtime-channels.ts',
    ]) {
      const source = readRepo(rel);
      expect(source, rel).not.toMatch(/function\s+unsafeVersion\s*\(/);
      expect(source, rel).not.toMatch(/function\s+sha256File\s*\(/);
      expect(source, rel).toContain("from '@cairn/shared/managed-bin'");
    }
  });

  test('runtime-homes.ts is the sole definition of tool install roots and agent-config import marker', () => {
    const violations: string[] = [];
    for (const file of tsFiles(DAEMON_SRC)) {
      const rel = relative(REPO_ROOT, file);
      if (rel === 'apps/daemon/src/runtime-homes.ts') continue;
      const source = readFileSync(file, 'utf8');
      if (/join\([^)]*['"]tools['"],\s*['"](?:devin|gemini|antigravity)['"]\)/.test(source)) {
        violations.push(`${rel}: inline tool install root`);
      }
      if (/join\([^)]*['"]imports['"],\s*['"]agent-config\.json['"]\)/.test(source)) {
        violations.push(`${rel}: inline agent-config import marker`);
      }
    }
    expect(violations).toEqual([]);
    expect(readRepo('apps/daemon/src/backend/runtime-channels.ts')).not.toContain(
      "join(homedir(), '.cairn')",
    );
  });

  test('sleeps use shared sleep() or node:timers/promises instead of hand-rolled setTimeout promises', () => {
    const violations: string[] = [];
    const seenAllowed = new Set<string>();
    for (const root of [DAEMON_SRC, SERVER_SRC]) {
      for (const file of tsFiles(root)) {
        const rel = relative(REPO_ROOT, file);
        const source = readFileSync(file, 'utf8');
        if (!SLEEP_PROMISE_RE.test(source)) continue;
        if (SLEEP_PROMISE_ALLOWLIST.has(rel)) {
          seenAllowed.add(rel);
          continue;
        }
        violations.push(rel);
      }
    }
    expect(violations).toEqual([]);
    expect([...seenAllowed].sort()).toEqual([...SLEEP_PROMISE_ALLOWLIST].sort());
  });

  test('screen drivers share ScreenStop and refuseScreen from computer/screen-stop.ts', () => {
    for (const rel of [
      'apps/daemon/src/computer/host-screen.ts',
      'apps/daemon/src/computer/desktop-accessibility.ts',
      'apps/daemon/src/computer/desktop-screen.ts',
    ]) {
      const source = readRepo(rel);
      expect(source, rel).not.toMatch(/class\s+Stop\s+extends\s+Error/);
      expect(source, rel).not.toMatch(/function\s+refuse\s*\(/);
      expect(source, rel).toContain("from './screen-stop.js'");
    }
  });

  test('step reporters and transcript stream reuse errorMessage from @cairn/shared', () => {
    for (const rel of [
      'apps/daemon/src/step-reporters.ts',
      'apps/daemon/src/step-transcript-stream.ts',
    ]) {
      const source = readRepo(rel);
      expect(source, rel).not.toMatch(/function\s+errorText\s*\(/);
      expect(source, rel).toContain('errorMessage');
    }
  });

  test('verify-verdict reuses capReason from review-findings', () => {
    const verify = readRepo('apps/daemon/src/verify-verdict.ts');
    expect(verify).not.toMatch(/function\s+capReason\s*\(/);
    expect(verify).toContain('capReason');
  });

  test('computer browser reuses escapeRegExp from @cairn/shared', () => {
    const browser = readRepo('apps/daemon/src/computer/browser.ts');
    expect(browser).not.toMatch(/\.replace\(\/\[\.\*\+\?\^\$\{\}\(\)\|\[\]\\\]\/g/);
    expect(browser).toContain('escapeRegExp');
  });
});
