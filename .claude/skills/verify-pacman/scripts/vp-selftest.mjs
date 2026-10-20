#!/usr/bin/env node
// vp.mjs self-test (#1402): the dispatch and archive rules, checked without a
// stack. drive cases use --dry-run, which prints the resolved command and the
// evidence/run paths instead of running anything. archive cases use a
// throwaway VERIFY_REPO_ROOT. Failure modes from pr-gate run 2 on #1411.
// Usage: node .claude/skills/verify-pacman/scripts/vp-selftest.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const VP = resolve(import.meta.dirname, 'vp.mjs');

function vp(args, env = {}, cwd = process.cwd()) {
  const r = spawnSync(process.execPath, [VP, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, VERIFY_EVIDENCE_DIR: '', VERIFY_RUN_DIR: '', ...env },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'vp-selftest-'));
  const src = join(root, 'evidence');
  for (const name of ['run-a', 'run-b']) {
    mkdirSync(join(src, name), { recursive: true });
    writeFileSync(join(src, name, 'result.json'), '{}\n');
  }
  mkdirSync(join(root, 'docs', 'verify', 'T', 'run-a'), { recursive: true });
  return { root, src };
}

const cases = [
  [
    'arguments after -- replace the case default args',
    () => {
      const r = vp(['drive', 'failed-send', 'restart-combo', '--dry-run', '--', '--expect=old']);
      return r.code === 0 && r.out.includes('--expect=old') && !r.out.includes('--expect=new');
    },
  ],
  [
    'without arguments a case runs with its default args',
    () => {
      const r = vp(['drive', 'failed-send', 'restart-combo', '--dry-run']);
      return r.code === 0 && r.out.includes('--expect=new');
    },
  ],
  [
    'relative evidence and run paths reach a tsx case as absolute paths',
    () => {
      const r = vp(['drive', 'failed-send', 'restart-combo', '--dry-run'], {
        VERIFY_EVIDENCE_DIR: 'rel/evidence',
        VERIFY_RUN_DIR: 'rel/run',
      });
      return (
        r.code === 0 &&
        r.out.includes(`VERIFY_EVIDENCE_DIR=${resolve('rel/evidence')}`) &&
        r.out.includes(`VERIFY_RUN_DIR=${resolve('rel/run')}`)
      );
    },
  ],
  [
    'a case that rewrites committed evidence needs --force',
    () => {
      const r = vp(['drive', 'pi-convergence', '--dry-run']);
      return r.code === 2 && /--force/.test(r.out);
    },
  ],
  [
    'archive with no source named refuses instead of taking the newest run',
    () => {
      const { root } = tempRoot();
      const r = vp(['archive', 'T2'], { VERIFY_REPO_ROOT: root });
      const copied = existsSync(join(root, 'docs', 'verify', 'T2'));
      rmSync(root, { recursive: true, force: true });
      return r.code === 2 && !copied;
    },
  ],
  [
    'archive refuses to overwrite an archived directory',
    () => {
      const { root, src } = tempRoot();
      const r = vp(['archive', 'T', '--from', join(src, 'run-a')], { VERIFY_REPO_ROOT: root });
      rmSync(root, { recursive: true, force: true });
      return r.code === 1 && /add-only/.test(r.out);
    },
  ],
  [
    'archive refuses two sources with one name and copies nothing',
    () => {
      const { root, src } = tempRoot();
      const r = vp(['archive', 'T3', '--from', join(src, 'run-b'), '--from', join(src, 'run-b')], {
        VERIFY_REPO_ROOT: root,
      });
      const copied = existsSync(join(root, 'docs', 'verify', 'T3'));
      rmSync(root, { recursive: true, force: true });
      return r.code === 1 && !copied;
    },
  ],
  [
    'archive copies a named source',
    () => {
      const { root, src } = tempRoot();
      const r = vp(['archive', 'T4', '--from', join(src, 'run-b')], { VERIFY_REPO_ROOT: root });
      const files = existsSync(join(root, 'docs', 'verify', 'T4', 'run-b'))
        ? readdirSync(join(root, 'docs', 'verify', 'T4', 'run-b'))
        : [];
      rmSync(root, { recursive: true, force: true });
      return r.code === 0 && files.includes('result.json');
    },
  ],
];

let failed = 0;
for (const [name, fn] of cases) {
  let ok = false;
  try {
    ok = fn();
  } catch {
    ok = false;
  }
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}
console.log(`${cases.length - failed}/${cases.length} passed`);
process.exit(failed === 0 ? 0 : 1);
