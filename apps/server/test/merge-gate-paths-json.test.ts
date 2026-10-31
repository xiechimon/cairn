import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import {
  AUTO_MERGE_PATH_GLOBS,
  GATE_LIMITS,
  HUMAN_QUEUE_PATH_GLOBS,
  MERGE_GATE_SOURCE_GLOBS,
  PROTECTED_PATH_GLOBS,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { globToRegExp } from '../src/services/merge-gate/paths.js';

const ROOT = join(import.meta.dirname, '../../..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

interface GatePaths {
  autoMerge: string[];
  protected: string[];
  humanQueue: Record<string, string[]>;
  mergeGateSource: string[];
  limits: { maxLines: number; maxFiles: number };
}

const gatePaths = JSON.parse(read('packages/shared/merge-gate-paths.json')) as GatePaths;
const securityCapabilities = ['credentials', 'machineAndCommandBoundary', 'externalEntryAuth'];

const sandbox = { timeout: 1000, contextCodeGeneration: { strings: false, wasm: false } };

function prGateEffective(source: string, paths: unknown) {
  const from = source.indexOf('const AUTO_MERGE =');
  const region = source.slice(from, source.indexOf('const FILES_CMD =', from));
  return runInNewContext(
    `${region}\n;({ AUTO_MERGE, PROTECTED, MAX_LINES, MAX_FILES })`,
    { args: { gatePaths: paths } },
    sandbox,
  ) as { AUTO_MERGE: string[]; PROTECTED: string[]; MAX_LINES: number; MAX_FILES: number };
}

function reviewGateEffective(source: string, json: string) {
  const from = source.indexOf('const globToRe');
  const body = source.slice(from, source.indexOf('mkdirSync(', from));
  const gitCalls: string[][] = [];
  const execFileSync = (_cmd: string, args: string[]) => {
    gitCalls.push(args);
    return json;
  };
  const load = new Function(
    'execFileSync',
    'MAIN',
    `${body}\nreturn { repoProtected, globToRe }`,
  ) as (
    exec: typeof execFileSync,
    main: string,
  ) => { repoProtected: () => RegExp[]; globToRe: (glob: string) => RegExp };
  const { repoProtected, globToRe } = load(execFileSync, '/main');
  return { sources: repoProtected().map((re) => re.source), globToRe, gitCalls };
}

function expandBraces(spec: string): string[] {
  const match = /\{([^{}]+)\}/.exec(spec);
  if (!match) return [spec];
  const alternatives = (match[1] ?? '').split(',');
  return alternatives.flatMap((alt) => expandBraces(spec.replace(match[0], alt)));
}

function listedSecurityPaths(guide: string): string[] {
  const afterHeader = guide.slice(guide.indexOf('Security surfaces'));
  const bullets = afterHeader
    .split('\n')
    .slice(1)
    .filter((line) => line.trim() !== '')
    .filter((_, i, all) => all.slice(0, i + 1).every((l) => l.startsWith('- ')));
  return bullets
    .flatMap((line) => [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1] as string))
    .flatMap(expandBraces)
    .sort();
}

describe('merge-gate-paths.json is the single source', () => {
  test('merge-gate.ts exports are exactly the JSON lists and limits', () => {
    expect([...AUTO_MERGE_PATH_GLOBS]).toEqual(gatePaths.autoMerge);
    expect([...PROTECTED_PATH_GLOBS]).toEqual(gatePaths.protected);
    expect([...MERGE_GATE_SOURCE_GLOBS]).toEqual(gatePaths.mergeGateSource);
    expect(HUMAN_QUEUE_PATH_GLOBS).toEqual(gatePaths.humanQueue);
    expect(GATE_LIMITS.maxLines).toBe(gatePaths.limits.maxLines);
    expect(GATE_LIMITS.maxFiles).toBe(gatePaths.limits.maxFiles);
    expect(gatePaths.limits).toEqual({ maxLines: 800, maxFiles: 40 });
  });

  test('every human-queue path is protected', () => {
    const protectedRe = [...gatePaths.protected, ...gatePaths.mergeGateSource].map((glob) =>
      globToRegExp(glob, { protect: true }),
    );
    const unprotected = Object.values(gatePaths.humanQueue)
      .flat()
      .filter((path) => !protectedRe.some((re) => re.test(path)));
    expect(unprotected).toEqual([]);
  });

  test('pr-gate.js effective lists equal the JSON, protected followed by the gate source', () => {
    const effective = prGateEffective(read('.claude/workflows/pr-gate.js'), gatePaths);
    expect(effective.AUTO_MERGE).toEqual(gatePaths.autoMerge);
    expect(effective.PROTECTED).toEqual([...gatePaths.protected, ...gatePaths.mergeGateSource]);
    expect(effective.MAX_LINES).toBe(gatePaths.limits.maxLines);
    expect(effective.MAX_FILES).toBe(gatePaths.limits.maxFiles);
  });

  test('negative control: an inline list in pr-gate.js differs from the JSON', () => {
    const source = read('.claude/workflows/pr-gate.js');
    const inlined = source.replace(
      /const AUTO_MERGE = requireGlobs\([^\n]+\)/,
      "const AUTO_MERGE = ['apps/*/src/**']",
    );
    expect(inlined).not.toBe(source);
    expect(prGateEffective(inlined, gatePaths).AUTO_MERGE).not.toEqual(gatePaths.autoMerge);
    const widened = source.replace(
      'const MAX_LINES = requireLimit(',
      'const MAX_LINES = 1 + requireLimit(',
    );
    expect(widened).not.toBe(source);
    expect(prGateEffective(widened, gatePaths).MAX_LINES).not.toBe(gatePaths.limits.maxLines);
  });

  test('pr-gate.js fails closed without the JSON in args', () => {
    const source = read('.claude/workflows/pr-gate.js');
    expect(() => prGateEffective(source, undefined)).toThrow(/gatePaths/);
    expect(() => prGateEffective(source, { ...gatePaths, protected: [] })).toThrow(/protected/);
    expect(() =>
      prGateEffective(source, { ...gatePaths, limits: { maxLines: 0, maxFiles: 40 } }),
    ).toThrow(/maxLines/);
  });

  test('review-gate.mjs effective list equals JSON.protected and reads origin/main', () => {
    const source = read('scripts/ops/review-gate/review-gate.mjs');
    const { sources, globToRe, gitCalls } = reviewGateEffective(source, JSON.stringify(gatePaths));
    expect(sources).toEqual(gatePaths.protected.map((glob) => globToRe(glob).source));
    expect(gitCalls).toEqual([['show', 'origin/main:packages/shared/merge-gate-paths.json']]);
  });

  test('negative control: review-gate.mjs follows the JSON it is given, not an inline list', () => {
    const source = read('scripts/ops/review-gate/review-gate.mjs');
    const tampered = JSON.stringify({ ...gatePaths, protected: ['zz-only/**'] });
    const { sources, globToRe } = reviewGateEffective(source, tampered);
    expect(sources).toEqual([globToRe('zz-only/**').source]);
    expect(sources).not.toEqual(gatePaths.protected.map((glob) => globToRe(glob).source));
  });

  test('batch-merger.mjs takes the JSON from origin/main, beside pr-gate.js', () => {
    const source = read('scripts/batch-merger.mjs');
    expect(source).toContain("'origin/main:packages/shared/merge-gate-paths.json'");
    expect(source).not.toMatch(/secret-box|\*\*\/drizzle\/\*\*/);
  });

  test('no consumer keeps an inline copy of the lists', () => {
    for (const path of [
      '.claude/workflows/pr-gate.js',
      'scripts/ops/review-gate/review-gate.mjs',
      'scripts/ops/host/tools/merge-pr.sh',
      'packages/shared/src/records/merge-gate.ts',
    ]) {
      expect(read(path), path).not.toMatch(
        /secret-box|'\*\*\/drizzle\/\*\*'|'apps\/\*\/src\/\*\*'/,
      );
    }
  });
});

describe('AGENTS.md security surfaces match the JSON', () => {
  const jsonSecurity = securityCapabilities
    .flatMap((key) => gatePaths.humanQueue[key] ?? [])
    .sort();

  test('the paths listed under Security surfaces are exactly the credentials, machine and external-entry capabilities', () => {
    expect(listedSecurityPaths(read('AGENTS.md'))).toEqual(jsonSecurity);
    expect(listedSecurityPaths(read('CLAUDE.md'))).toEqual(jsonSecurity);
  });

  test('negative control: a path dropped or added in the guide is reported', () => {
    const guide = read('AGENTS.md');
    const dropped = guide.replace('`apps/server/src/services/machine*.ts`, ', '');
    expect(dropped).not.toBe(guide);
    expect(listedSecurityPaths(dropped)).not.toEqual(jsonSecurity);
    const added = guide.replace('{mcp-face,mcp-servers}', '{mcp-face,mcp-servers,extra}');
    expect(added).not.toBe(guide);
    expect(listedSecurityPaths(added)).not.toEqual(jsonSecurity);
  });
});
