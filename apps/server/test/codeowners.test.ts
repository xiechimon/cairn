import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { classifyPaths } from '../src/services/merge-gate/paths.js';

const REPO_ROOT = join(import.meta.dirname, '../../..');
const OWNER = '@xiechimon';
const EVAL_ROOTS = ['integration/eval/', '.claude/hillclimb/'];
const GITHUB_UNSUPPORTED_PATTERN = /[!\[\]\\]|^#/;
const TOKEN_SHAPES = [/gh[pousr]_[A-Za-z0-9]{20,}/, /github_pat_[A-Za-z0-9_]{20,}/];

const read = (path: string) => readFileSync(join(REPO_ROOT, path), 'utf8');
const tracked = execFileSync('git', ['-C', REPO_ROOT, 'ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);
const evalFiles = tracked.filter((p) => EVAL_ROOTS.some((root) => p.startsWith(root)));

interface Rule {
  pattern: string;
  owners: string[];
  line: number;
}

function patternRegExp(pattern: string): RegExp {
  const anchored = pattern.replace(/^\//, '');
  let re = '';
  for (let i = 0; i < anchored.length; i += 1) {
    const ch = anchored[i] ?? '';
    if (ch === '*' && anchored[i + 1] === '*') {
      re += '.*';
      i += 1;
    } else if (ch === '*') {
      re += '[^/]*';
    } else {
      re += ch.replace(/[.+?^${}()|\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

function ownersOf(rules: Rule[], path: string): string[] | null {
  const hit = rules.findLast((rule) => patternRegExp(rule.pattern).test(path));
  return hit ? hit.owners : null;
}

describe('.github/CODEOWNERS', () => {
  const rules: Rule[] = read('.github/CODEOWNERS')
    .split('\n')
    .flatMap((raw, index) => {
      const line = raw.trim();
      if (line === '' || line.startsWith('#')) return [];
      const [pattern = '', ...owners] = line.split(/\s+/);
      return [{ pattern, owners, line: index + 1 }];
    });

  test('every tracked file under an evaluation path is owned by @xiechimon', () => {
    expect(evalFiles.length).toBeGreaterThan(0);
    const unowned = evalFiles.filter((p) => ownersOf(rules, p)?.join(' ') !== OWNER);
    expect(unowned).toEqual([]);
  });

  test('every evaluation path the merge gate hands to a human has a code owner', () => {
    const routedToHuman = evalFiles.filter((p) => {
      const found = classifyPaths(
        [
          {
            filename: p,
            status: 'modified',
            previousFilename: null,
            sha: 'a'.repeat(40),
            additions: 1,
            deletions: 0,
            patchSha: 'c'.repeat(64),
          },
        ],
        'ticket',
      );
      return found.protected.length > 0 || found.outsideAutoMerge.length > 0;
    });
    expect(routedToHuman).toEqual(evalFiles);
  });

  test('every rule uses only GitHub-recognized syntax: one pattern plus at least one @xiechimon', () => {
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule.pattern, `line ${rule.line}`).not.toMatch(GITHUB_UNSUPPORTED_PATTERN);
      expect(rule.owners, `line ${rule.line}`).toEqual([OWNER]);
    }
  });

  test('every rule hits at least one tracked file, a wrong path does not silently go dead', () => {
    for (const rule of rules) {
      const re = patternRegExp(rule.pattern);
      expect(
        tracked.some((p) => re.test(p)),
        `line ${rule.line}: ${rule.pattern}`,
      ).toBe(true);
    }
  });

  test('CODEOWNERS itself is also owned by @xiechimon, removing an entry needs human review', () => {
    expect(ownersOf(rules, '.github/CODEOWNERS')).toEqual([OWNER]);
  });
});

describe('docs/ops/agent-bot-identity.md', () => {
  const doc = read('docs/ops/agent-bot-identity.md');

  test('contains no token values', () => {
    for (const shape of TOKEN_SHAPES) expect(doc).not.toMatch(shape);
  });

  test('the named in-repo scripts and files all exist', () => {
    const named = doc.match(
      /(?:scripts|docs|\.github)\/[\w./-]+\.(?:mjs|md|ts)|\.github\/CODEOWNERS/g,
    );
    expect(named?.length).toBeGreaterThan(0);
    for (const path of new Set(named)) expect(existsSync(join(REPO_ROOT, path)), path).toBe(true);
  });

  test('states that Code Owners review turns on only after the bot pushes the PR', () => {
    expect(doc).toContain('Require review from Code Owners');
    expect(doc).toMatch(/cannot approve his own PR/);
  });
});
