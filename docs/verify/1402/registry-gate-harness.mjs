#!/usr/bin/env node
// Failure modes of scripts/verify-registry-gate.mjs, each in a throwaway git
// repo that holds a copy of the gate, the registry and empty stand-ins for the
// scripts. Usage: node docs/verify/1402/registry-gate-harness.mjs [gate path]
// The modes come from pr-gate run 1 on #1411 (unregistered .mts probes, a
// registry case without needs, tsx cases without a working cwd) plus a rename
// into a ticket-numbered name, which `git diff --diff-filter=A` does not list.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../../..');
const GATE = resolve(process.argv[2] ?? join(ROOT, 'scripts/verify-registry-gate.mjs'));
const SKILL = '.claude/skills/verify-pacman';
const REGISTRY = `${SKILL}/vp-registry.json`;
const source = JSON.parse(readFileSync(join(ROOT, REGISTRY), 'utf8'));

function scripts(reg) {
  const names = new Set(Object.keys(reg.support).map((n) => `${SKILL}/scripts/${n}`));
  for (const f of Object.values(reg.features)) for (const c of Object.values(f.cases)) names.add(c.script);
  return [...names];
}

function git(dir, args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
}

// Builds the base repo, applies change(dir, reg) on top, commits, runs the gate
// with --base. Returns the gate's exit code.
function scenario(change) {
  const dir = mkdtempSync(join(tmpdir(), 'registry-gate-'));
  const reg = structuredClone(source);
  for (const f of Object.values(reg.features).filter((e) => e.recipe)) {
    const name = Object.keys(reg.features).find((k) => reg.features[k] === f);
    const p = join(dir, SKILL, f.recipe);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, `${existsSync(p) ? readFileSync(p, 'utf8') : ''}- \`vp.mjs drive ${name} x\`\n`);
  }
  for (const p of scripts(reg)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), `// stand-in for ${p}\n${'x'.repeat(200)}\n`);
  }
  for (const pkg of ['apps/server', 'apps/daemon']) {
    mkdirSync(join(dir, pkg), { recursive: true });
    writeFileSync(join(dir, pkg, 'package.json'), '{"devDependencies":{"tsx":"4.23.15"}}\n');
  }
  mkdirSync(join(dir, 'scripts'));
  copyFileSync(GATE, join(dir, 'scripts/verify-registry-gate.mjs'));
  writeFileSync(join(dir, REGISTRY), `${JSON.stringify(reg, null, 2)}\n`);
  git(dir, ['init', '-q']);
  git(dir, ['add', '.']);
  git(dir, ['-c', 'user.email=h@h', '-c', 'user.name=h', 'commit', '-qm', 'base']);
  const base = git(dir, ['rev-parse', 'HEAD']);
  change(dir, reg);
  writeFileSync(join(dir, REGISTRY), `${JSON.stringify(reg, null, 2)}\n`);
  git(dir, ['add', '-A']);
  git(dir, ['-c', 'user.email=h@h', '-c', 'user.name=h', 'commit', '-qm', 'change', '--allow-empty']);
  const run = spawnSync(process.execPath, [join(dir, 'scripts/verify-registry-gate.mjs'), '--base', base], {
    encoding: 'utf8',
  });
  rmSync(dir, { recursive: true, force: true });
  return { code: run.status, out: `${run.stdout}${run.stderr}` };
}

const firstCase = (reg) => {
  const [feature, entry] = Object.entries(reg.features)[0];
  const [name, c] = Object.entries(entry.cases)[0];
  return { feature, name, c };
};
const tsxCase = (reg) =>
  Object.values(reg.features)
    .flatMap((f) => Object.values(f.cases))
    .find((c) => c.runner === 'tsx');

const cases = [
  ['unchanged registry and scripts pass', 0, () => {}],
  ['an unregistered .mts file fails', 1, (dir) => writeFileSync(join(dir, SKILL, 'scripts/probe-x.mts'), 'x\n')],
  ['an unregistered .mjs file fails', 1, (dir) => writeFileSync(join(dir, SKILL, 'scripts/probe-x.mjs'), 'x\n')],
  ['a registered script that is missing fails', 1, (_dir, reg) => {
    firstCase(reg).c.script = `${SKILL}/scripts/gone.mjs`;
  }],
  ['a case without needs fails', 1, (_dir, reg) => {
    delete firstCase(reg).c.needs;
  }],
  ['a case with an unknown status fails', 1, (_dir, reg) => {
    firstCase(reg).c.status = 'maybe';
  }],
  ['a tsx case without cwd fails', 1, (_dir, reg) => {
    delete tsxCase(reg).cwd;
  }],
  ['a tsx case whose cwd has no package.json fails', 1, (_dir, reg) => {
    tsxCase(reg).cwd = 'apps/nowhere';
  }],
  ['a recipe file that does not name its drive command fails', 1, (dir, reg) => {
    const f = Object.values(reg.features).find((e) => e.recipe);
    writeFileSync(join(dir, SKILL, f.recipe), '# map without a drive line\n');
  }],
  ['a recipe path that does not exist fails', 1, (_dir, reg) => {
    Object.values(reg.features).find((e) => e.recipe).recipe = 'features/nowhere.md';
  }],
  ['a new drive-<number> script fails even when registered', 1, (dir, reg) => {
    const p = `${SKILL}/scripts/drive-9999-new.mjs`;
    writeFileSync(join(dir, p), 'x\n');
    firstCase(reg).c.script = p;
  }],
  ['renaming an existing script to drive-<number> fails', 1, (dir, reg) => {
    const { c } = firstCase(reg);
    const p = `${SKILL}/scripts/drive-9999-renamed.mjs`;
    renameSync(join(dir, c.script), join(dir, p));
    c.script = p;
  }],
  ['editing an existing drive-<number> script passes', 0, (dir, reg) => {
    const existing = scripts(reg).find((p) => /\/drive-\d/.test(p));
    writeFileSync(join(dir, existing), `${readFileSync(join(dir, existing), 'utf8')}// edit\n`);
  }],
];

let failed = 0;
for (const [name, want, change] of cases) {
  const { code, out } = scenario(change);
  const ok = code === want;
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (exit ${code}, want ${want})`);
  if (!ok) console.log(out.split('\n').filter(Boolean).slice(0, 4).map((l) => `      ${l}`).join('\n'));
}
console.log(`${cases.length - failed}/${cases.length} passed (${GATE.startsWith(`${ROOT}/`) ? GATE.slice(ROOT.length + 1) : basename(GATE)})`);
process.exit(failed === 0 ? 0 : 1);
