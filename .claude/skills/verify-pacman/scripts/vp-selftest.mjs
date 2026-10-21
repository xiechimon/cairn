#!/usr/bin/env node
// vp.mjs self-test (#1402): the dispatch and archive rules, checked without a
// stack. drive cases use --dry-run, which prints the resolved command and the
// evidence/run paths instead of running anything. archive cases use a
// throwaway VERIFY_REPO_ROOT. Failure modes from pr-gate runs 2, 3 and 4 on #1411.
// Usage: node .claude/skills/verify-pacman/scripts/vp-selftest.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const VP = resolve(import.meta.dirname, 'vp.mjs');
const ROOT = resolve(import.meta.dirname, '../../../..');
const REGISTRY = JSON.parse(readFileSync(resolve(import.meta.dirname, '../vp-registry.json'), 'utf8'));

// A probe that runs its pre-fix mode when called with no arguments needs the
// post-fix flag as its registry default (pr-gate run 3: chief-unread,
// empty-review and import-rollback had none, so vp.mjs drive went red on a
// healthy stack).
const PRE_FIX_DEFAULTS = [
  [/=== '--expect=new' \? 'new' : 'old'/, '--expect=new'],
  [/includes\('--expect=new'\) \? 'new' : 'old'/, '--expect=new'],
  [/includes\('--expect=after'\) \? 'after' : 'before'/, '--expect=after'],
  [/expectOld === expectNew/, '--expect=new'],
];

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
      return r.code === 2 && /needs rewrites-evidence/.test(r.out) && /--force/.test(r.out);
    },
  ],
  [
    'probes that default to their pre-fix mode get the post-fix flag from the registry',
    () => {
      const missing = [];
      for (const [feature, entry] of Object.entries(REGISTRY.features)) {
        for (const [name, c] of Object.entries(entry.cases)) {
          const src = readFileSync(resolve(ROOT, c.script), 'utf8');
          for (const [pattern, flag] of PRE_FIX_DEFAULTS) {
            if (pattern.test(src) && !c.args.includes(flag)) missing.push(`${feature}/${name} ${flag}`);
          }
        }
      }
      if (missing.length > 0) console.log(`      missing: ${missing.join(', ')}`);
      return missing.length === 0;
    },
  ],
  [
    'no current case creates an agent without machineId (ADR 0019)',
    () => {
      const broken = [];
      for (const [feature, entry] of Object.entries(REGISTRY.features)) {
        for (const [name, c] of Object.entries(entry.cases)) {
          if (c.status !== 'current') continue;
          const src = readFileSync(resolve(ROOT, c.script), 'utf8');
          // Any call that passes .../agents as the URL with something after it: the
          // helpers (sendJson, postJson, jpost, api) default to POST (pr-gate run 4).
          if (/\/agents['"`]\s*,/.test(src) && !/machineId/.test(src)) broken.push(`${feature}/${name}`);
        }
      }
      if (broken.length > 0) console.log(`      broken: ${broken.join(', ')}`);
      return broken.length === 0;
    },
  ],
  [
    'every current case writes where drive points it, or the registry says where it writes',
    () => {
      const blind = [];
      for (const [feature, entry] of Object.entries(REGISTRY.features)) {
        for (const [name, c] of Object.entries(entry.cases)) {
          if (c.status !== 'current') continue;
          const src = readFileSync(resolve(ROOT, c.script), 'utf8');
          if (!src.includes('VERIFY_EVIDENCE_DIR') && c.evidence?.flag === undefined && c.evidence?.writes === undefined) {
            blind.push(`${feature}/${name}`);
          }
        }
      }
      if (blind.length > 0) console.log(`      blind: ${blind.join(', ')}`);
      return blind.length === 0;
    },
  ],
  [
    'a case whose probe takes an output flag gets the evidence directory through it',
    () => {
      const r = vp(['drive', 'glass-journeys', 'create-task', '--dry-run']);
      const own = vp(['drive', 'glass-journeys', 'create-task', '--dry-run', '--', 'create-task', '--out', '/tmp/x']);
      const dir = r.out.match(/VERIFY_EVIDENCE_DIR=(\S+)/)?.[1] ?? 'missing';
      return r.code === 0 && r.out.includes(`--out ${dir}`) && own.code === 0 && (own.out.match(/--out/g) ?? []).length === 1;
    },
  ],
  [
    'a case that writes its evidence itself gets no evidence directory',
    () => {
      const r = vp(['drive', 'pi-convergence', '--force', '--dry-run']);
      return r.code === 0 && /writes its evidence itself: docs\/verify\/926\//.test(r.out) && !r.out.includes('VERIFY_EVIDENCE_DIR=/');
    },
  ],
  [
    '--force lets a stale case run',
    () => {
      const r = vp(['drive', 'stop-button', '--force', '--dry-run']);
      return r.code === 0 && /script \S+drive-/.test(r.out);
    },
  ],
  [
    'a failed doctor leaves no evidence directory behind',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'vp-selftest-'));
      const ev = join(root, 'ev');
      const r = vp(['drive', 'search'], { VERIFY_RUN_DIR: join(root, 'run'), VERIFY_EVIDENCE_DIR: ev });
      const made = existsSync(ev);
      rmSync(root, { recursive: true, force: true });
      return r.code === 1 && /doctor failed/.test(r.out) && !made;
    },
  ],
  [
    'links prints sha-pinned raw links and refuses a ticket with no evidence',
    () => {
      const r = vp(['links', '1402', '--sha', 'HEAD']);
      const lines = r.out.split('\n').filter((l) => l.includes('raw.githubusercontent.com'));
      const pinned = lines.every((l) => /\]\(https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[0-9a-f]{40}\/docs\/verify\/1402\//.test(l));
      const none = vp(['links', '999999', '--sha', 'HEAD']);
      return r.code === 0 && lines.length > 0 && pinned && none.code === 1;
    },
  ],
  [
    'a drive without VERIFY_EVIDENCE_DIR gets its own directory under .claude/verify-evidence',
    () => {
      const r = vp(['drive', 'providers-tabs', 'claude-bin-detection', '--dry-run']);
      const prefix = `VERIFY_EVIDENCE_DIR=${resolve(ROOT, '.claude/verify-evidence')}/`;
      return r.code === 0 && r.out.includes(prefix) && /-providers-tabs-claude-bin-detection\n/.test(r.out);
    },
  ],
  [
    'a tsx case runs from its package directory, a node case from the repo root',
    () => {
      const tsx = vp(['drive', 'failed-send', 'restart-combo', '--dry-run']);
      const node = vp(['drive', 'search', '--dry-run'], {}, resolve(ROOT, 'apps'));
      return tsx.out.includes(`cwd ${resolve(ROOT, 'apps/server')}`) && node.out.includes(`cwd ${ROOT}\n`);
    },
  ],
  [
    'a case that needs the stack runs doctor first',
    () => {
      const r = vp(['drive', 'search', '--dry-run']);
      return r.code === 0 && /doctor first/.test(r.out);
    },
  ],
  [
    'a stale case needs --force',
    () => {
      const r = vp(['drive', 'stop-button', '--dry-run']);
      return r.code === 2 && /is stale/.test(r.out);
    },
  ],
  [
    'a stray positional argument is refused',
    () => {
      const r = vp(['drive', 'hotkeys', 'newtask-key-c', 'm', '--dry-run']);
      return r.code === 2 && /script arguments go after --/.test(r.out);
    },
  ],
  [
    'archive with no source named refuses instead of taking the newest run',
    () => {
      const { root } = tempRoot();
      const r = vp(['archive', 'T2'], { VERIFY_REPO_ROOT: root });
      const copied = existsSync(join(root, 'docs', 'verify', 'T2'));
      rmSync(root, { recursive: true, force: true });
      return r.code === 2 && /name the source/.test(r.out) && !copied;
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
      return r.code === 1 && /share the directory name/.test(r.out) && !copied;
    },
  ],
  [
    'archive --latest takes a positive integer only',
    () => {
      const { root } = tempRoot();
      const codes = ['-1', '0', 'x'].map((n) => vp(['archive', 'T5', '--latest', n], { VERIFY_REPO_ROOT: root }).code);
      const copied = existsSync(join(root, 'docs', 'verify', 'T5'));
      rmSync(root, { recursive: true, force: true });
      return codes.every((c) => c === 2) && !copied;
    },
  ],
  [
    'archive refuses --latest together with --from or VERIFY_EVIDENCE_DIR',
    () => {
      const { root, src } = tempRoot();
      const a = vp(['archive', 'T7', '--from', join(src, 'run-b'), '--latest', '1'], { VERIFY_REPO_ROOT: root });
      const b = vp(['archive', 'T7', '--latest', '1'], { VERIFY_REPO_ROOT: root, VERIFY_EVIDENCE_DIR: join(src, 'run-b') });
      const copied = existsSync(join(root, 'docs', 'verify', 'T7'));
      rmSync(root, { recursive: true, force: true });
      return a.code === 2 && b.code === 2 && !copied;
    },
  ],
  [
    'archive refuses a source given without --from',
    () => {
      const { root, src } = tempRoot();
      const r = vp(['archive', 'T6', join(src, 'run-b')], { VERIFY_REPO_ROOT: root, VERIFY_EVIDENCE_DIR: join(src, 'run-a') });
      const copied = existsSync(join(root, 'docs', 'verify', 'T6'));
      rmSync(root, { recursive: true, force: true });
      return r.code === 2 && !copied;
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
