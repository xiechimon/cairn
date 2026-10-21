#!/usr/bin/env node
// vp.mjs self-test (#1402): the dispatch and archive rules, checked without a
// stack. drive cases run a copy of vp.mjs in a throwaway skill directory with
// its own registry and a stub probe, and set each case's status, needs and
// arguments themselves, so no case depends on a real registry entry; most use
// --dry-run, which prints the resolved command and the evidence/run paths
// instead of running anything. The whole-registry scans read the real
// registry. archive cases use a throwaway VERIFY_REPO_ROOT.
// Usage: node .claude/skills/verify-pacman/scripts/vp-selftest.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const VP = resolve(import.meta.dirname, 'vp.mjs');
const GATE = resolve(import.meta.dirname, 'vp-registry-gate.mjs');
const ROOT = resolve(import.meta.dirname, '../../../..');
const REGISTRY = JSON.parse(readFileSync(resolve(import.meta.dirname, '../vp-registry.json'), 'utf8'));

// A new directory under the system temp dir, as its physical path. vp.mjs
// derives its paths from import.meta.url and process.cwd(), which Node gives
// with symlinks resolved; where the temp dir sits behind a symlink (macOS:
// /var -> /private/var) the link path never equals them as a string.
function tempDir(prefix) {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function localStamp(at) {
  const d = new Date(at);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function callStart(src, from) {
  let depth = 0;
  for (let i = from; i > 0; i -= 1) {
    if (src[i] === ')') depth += 1;
    else if (src[i] === '(') {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return 0;
}

function callEnd(src, open) {
  let depth = 0;
  for (let j = open; j < src.length; j += 1) {
    if (src[j] === '(') depth += 1;
    else if (src[j] === ')') {
      depth -= 1;
      if (depth === 0) return j + 1;
    }
  }
  return src.length;
}

// Each call in a probe that sends a body to .../agents, judged by its own
// argument text plus the 200 characters after it (a probe that checks the 400
// of a body without machineId names machineId there). A body passed through a
// helper (createAgent(teamId, body)) has no machineId in the call and counts as
// broken: the check fails closed and names the helper's line.
function agentBodiesWithoutMachineId(src) {
  const lines = [];
  for (const m of src.matchAll(/\/agents['"`]\s*,/g)) {
    const open = callStart(src, m.index);
    if (!/machineId/.test(src.slice(open, callEnd(src, open) + 200))) lines.push(src.slice(0, m.index).split('\n').length);
  }
  return lines;
}

// Current cases that depend on a seed script whose call to .../agents sends no
// machineId: the probe names the seed, or its usage does. A seed the usage
// names inside a parenthesized clause that says optional ("[todoId] (optional;
// seed via setup-review-seed.mjs)") feeds an optional path and does not count;
// every other seed does. Seeds live in scriptsDir; case script paths are
// relative to root.
function seedDependents(registry, scriptsDir, root) {
  const broken = Object.entries(registry.support)
    .filter(([, v]) => v.kind === 'seed')
    .map(([name]) => name)
    .filter((name) => agentBodiesWithoutMachineId(readFileSync(join(scriptsDir, name), 'utf8')).length > 0);
  const dependent = [];
  for (const [feature, entry] of Object.entries(registry.features)) {
    for (const [name, c] of Object.entries(entry.cases)) {
      if (c.status !== 'current') continue;
      const usage = c.usage ?? '';
      const optional = [...usage.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]).filter((clause) => /optional/.test(clause));
      const src = readFileSync(resolve(root, c.script), 'utf8');
      const uses = broken.filter(
        (seed) => (src.includes(seed) || usage.includes(seed)) && !optional.some((clause) => clause.includes(seed)),
      );
      if (uses.length > 0) dependent.push(`${feature}/${name} (${uses.join(', ')})`);
    }
  }
  return dependent;
}

// The registry gate run on a skill directory of its own: a copy of the gate,
// the given registry, an empty file per script name, and the given feature
// maps. Run from the system temp dir, not the fake root, so a gate that reads
// the caller's cwd scans the wrong place and fails here.
function runGate(registry, scripts, maps) {
  const root = tempDir('vp-selftest-gate-');
  try {
    const skill = join(root, '.claude', 'skills', 'verify-pacman');
    mkdirSync(join(skill, 'scripts'), { recursive: true });
    mkdirSync(join(skill, 'features'), { recursive: true });
    for (const name of scripts) writeFileSync(join(skill, 'scripts', name), '');
    if (existsSync(GATE)) cpSync(GATE, join(skill, 'scripts', 'vp-registry-gate.mjs'));
    writeFileSync(join(skill, 'vp-registry.json'), JSON.stringify(registry));
    for (const [name, body] of Object.entries(maps)) writeFileSync(join(skill, 'features', name), body);
    const r = spawnSync(process.execPath, [join(skill, 'scripts', 'vp-registry-gate.mjs')], {
      cwd: tmpdir(),
      encoding: 'utf8',
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// A skill the registry gate passes: support scripts, a ticket-named probe that
// exists today, a probe named after its feature, and a map naming a drive line.
const GATE_DIR = '.claude/skills/verify-pacman/scripts/';
const GATE_SCRIPTS = [
  'cleanup.mjs',
  'doctor.mjs',
  'launch.mjs',
  'setup-x-seed.mjs',
  'stub-x.mjs',
  'vp.mjs',
  'vp-selftest.mjs',
  'drive-902-gate-actor.mjs',
  'drive-hotkeys.mjs',
];
const GATE_MAPS = { 't.md': '# t\n\n- `node .claude/skills/verify-pacman/scripts/vp.mjs drive t legacy`\n' };

function gateRegistry(cases = {}, support = {}) {
  const kinds = { 'setup-x-seed.mjs': 'seed', 'stub-x.mjs': 'stub', 'vp-selftest.mjs': 'test' };
  const base = Object.fromEntries(
    ['cleanup.mjs', 'doctor.mjs', 'launch.mjs', 'setup-x-seed.mjs', 'stub-x.mjs', 'vp.mjs', 'vp-selftest.mjs', 'vp-registry-gate.mjs'].map(
      (name) => [name, { kind: kinds[name] ?? 'infra', purpose: name }],
    ),
  );
  return {
    support: { ...base, ...support },
    features: {
      t: {
        recipe: 'features/t.md',
        cases: {
          legacy: { ...STUB, script: `${GATE_DIR}drive-902-gate-actor.mjs` },
          named: { ...STUB, script: `${GATE_DIR}drive-hotkeys.mjs` },
          ...cases,
        },
      },
    },
  };
}

// A copy of vp.mjs in <root>/.claude/skills/verify-pacman: its own registry
// (feature t with the given cases), the given scripts beside vp.mjs, a stub
// probe <root>/stub.mjs that writes result.json where it is pointed, and the
// repo's node_modules (vp.mjs imports @playwright/test). Returns the copy's path.
function installSkill(root, cases, scripts = {}) {
  const skill = join(root, '.claude', 'skills', 'verify-pacman');
  mkdirSync(join(skill, 'scripts'), { recursive: true });
  cpSync(VP, join(skill, 'scripts', 'vp.mjs'));
  symlinkSync(join(ROOT, 'node_modules'), join(root, 'node_modules'));
  writeFileSync(join(skill, 'vp-registry.json'), JSON.stringify({ features: { t: { recipe: null, cases } } }));
  for (const [name, body] of Object.entries(scripts)) writeFileSync(join(skill, 'scripts', name), body);
  writeFileSync(
    join(root, 'stub.mjs'),
    [
      "import { mkdirSync, writeFileSync } from 'node:fs';",
      "const at = process.argv.indexOf('--out');",
      'const dir = at === -1 ? process.env.VERIFY_EVIDENCE_DIR : process.argv[at + 1];',
      'mkdirSync(dir, { recursive: true });',
      'writeFileSync(`${dir}/result.json`, JSON.stringify({ argv: process.argv.slice(2) }));',
      '',
    ].join('\n'),
  );
  return join(skill, 'scripts', 'vp.mjs');
}

// installSkill in a throwaway directory that is a git repository of its own, so
// its evidence root is the throwaway directory itself, also when the temp dir
// sits inside another checkout. run() runs from the root unless given a cwd.
function fakeSkill(cases, scripts = {}) {
  const root = tempDir('vp-fake-');
  gitAt(root)('init', '-q');
  const script = installSkill(root, cases, scripts);
  const evidenceRoot = join(root, '.claude', 'verify-evidence');
  return {
    root,
    evidenceRoot,
    run: (args, env = {}, cwd = root) => vp(args, env, cwd, script),
    evidence: () => (existsSync(evidenceRoot) ? readdirSync(evidenceRoot) : []),
    done: () => rmSync(root, { recursive: true, force: true }),
  };
}

// fakeSkill for the length of check(fake), removed afterwards whatever happens.
function withFake(cases, check, scripts = {}) {
  const fake = fakeSkill(cases, scripts);
  try {
    return check(fake);
  } finally {
    fake.done();
  }
}

const STUB = { script: 'stub.mjs', args: [], needs: [], status: 'current', purpose: 'stub' };
// A case whose probe takes its evidence directory through an output option,
// with a journey name as its default argument (glass.mjs <journey> --out <dir>).
const JOURNEY = { ...STUB, args: ['create-task'], evidence: { flag: '--out' } };
// A case that refuses to run without a positional argument.
const NEEDS_ARGS = { ...STUB, needsArgs: true, usage: '<todoId> <branch>' };

// git in a throwaway repository. The caller's git config may sign commits or
// run hooks; this repository does neither.
function gitAt(repo) {
  return (...args) =>
    execFileSync('git', ['-C', repo, '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
      encoding: 'utf8',
    });
}

// A probe that runs its pre-fix mode, or refuses to run, when called with no
// arguments needs the post-fix flag as its registry default; without it,
// vp.mjs drive goes red on a healthy stack.
const PRE_FIX_DEFAULTS = [
  [/=== '--expect=new' \? 'new' : 'old'/, '--expect=new'],
  [/includes\('--expect=new'\) \? 'new' : 'old'/, '--expect=new'],
  [/includes\('--expect=after'\) \? 'after' : 'before'/, '--expect=after'],
  [/expectOld === expectNew/, '--expect=new'],
];

function vp(args, env = {}, cwd = process.cwd(), script = VP) {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      VERIFY_REPO_ROOT: '',
      VERIFY_EVIDENCE_DIR: '',
      VERIFY_RUN_DIR: '',
      VERIFY_PORT: '',
      VERIFY_WEB_PORT: '',
      ...env,
    },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

// Every entry under dir, files with their contents: equal snapshots mean
// nothing was added, removed or rewritten.
function snapshot(dir) {
  return readdirSync(dir, { recursive: true })
    .sort()
    .map((p) => (statSync(join(dir, p)).isDirectory() ? `${p}/` : `${p}:${readFileSync(join(dir, p), 'utf8')}`))
    .join('\n');
}

function tempRoot() {
  const root = tempDir('vp-selftest-');
  const src = join(root, 'evidence');
  for (const name of ['run-a', 'run-b']) {
    mkdirSync(join(src, name), { recursive: true });
    writeFileSync(join(src, name, 'result.json'), '{}\n');
  }
  mkdirSync(join(root, 'docs', 'verify', 'T', 'run-a'), { recursive: true });
  return { root, src };
}

// <root>/docs/verify/T/run-a holding one committed file, as archive leaves it.
function committedEvidence(root) {
  const archived = join(root, 'docs', 'verify', 'T', 'run-a');
  mkdirSync(archived, { recursive: true });
  writeFileSync(join(archived, 'result.json'), '{"archived":true}\n');
  return archived;
}

const cases = [
  [
    'arguments after -- replace the case default args',
    () =>
      withFake({ x: { ...STUB, args: ['--expect=new'] } }, (fake) => {
        const r = fake.run(['drive', 't', 'x', '--dry-run', '--', '--expect=old']);
        return r.code === 0 && /args --expect=old\n/.test(r.out) && !r.out.includes('--expect=new');
      }),
  ],
  [
    'without arguments a case runs with its default args',
    () =>
      withFake({ x: { ...STUB, args: ['--expect=new'] } }, (fake) => {
        const r = fake.run(['drive', 't', 'x', '--dry-run']);
        return r.code === 0 && /args --expect=new\n/.test(r.out);
      }),
  ],
  [
    'relative evidence and run paths reach a tsx case as absolute paths',
    () =>
      withFake({ x: { ...STUB, runner: 'tsx', cwd: 'pkg' } }, (fake) => {
        const r = fake.run(['drive', 't', 'x', '--dry-run'], {
          VERIFY_EVIDENCE_DIR: 'rel/evidence',
          VERIFY_RUN_DIR: 'rel/run',
        });
        return (
          r.code === 0 &&
          r.out.includes(`VERIFY_EVIDENCE_DIR=${join(fake.root, 'rel', 'evidence')}\n`) &&
          r.out.includes(`VERIFY_RUN_DIR=${join(fake.root, 'rel', 'run')}\n`)
        );
      }),
  ],
  [
    'a case that rewrites committed evidence needs --force',
    () =>
      withFake({ x: { ...STUB, needs: ['rewrites-evidence'] } }, (fake) => {
        const refused = fake.run(['drive', 't', 'x', '--dry-run']);
        const forced = fake.run(['drive', 't', 'x', '--force', '--dry-run']);
        return (
          refused.code === 2 &&
          /needs rewrites-evidence \(rewrites committed docs\/verify evidence in place\)/.test(refused.out) &&
          /--force/.test(refused.out) &&
          forced.code === 0
        );
      }),
  ],
  [
    'a case that needs github needs --force',
    () =>
      withFake({ x: { ...STUB, needs: ['github'] } }, (fake) => {
        const refused = fake.run(['drive', 't', 'x', '--dry-run']);
        const forced = fake.run(['drive', 't', 'x', '--force', '--dry-run']);
        return refused.code === 2 && /needs github \(calls GitHub\)/.test(refused.out) && forced.code === 0;
      }),
  ],
  [
    'a case that needs real-llm needs --force and runs nothing without it',
    () =>
      withFake({ llm: { ...STUB, needs: ['real-llm'] } }, (fake) => {
        const refused = fake.run(['drive', 't', 'llm']);
        const before = fake.evidence().length;
        const forced = fake.run(['drive', 't', 'llm', '--force']);
        const after = fake.evidence().length;
        return (
          refused.code === 2 &&
          /needs real-llm \(spends model tokens\)/.test(refused.out) &&
          before === 0 &&
          forced.code === 0 &&
          after === 1
        );
      }),
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
          // Each call that sends a body to .../agents (the helpers default to
          // POST), judged by its own body: a probe that names machineId anywhere
          // else in the file still 400s.
          const lines = agentBodiesWithoutMachineId(readFileSync(resolve(ROOT, c.script), 'utf8'));
          if (lines.length > 0) broken.push(`${feature}/${name} (${c.script.split('/').at(-1)}:${lines.join(',')})`);
        }
      }
      if (broken.length > 0) console.log(`      broken: ${broken.join(', ')}`);
      return broken.length === 0;
    },
  ],
  [
    'every case writes where drive points it, or the registry says where it writes',
    () => {
      // Any status: --force runs a stale or host-bound case too.
      const blind = [];
      for (const [feature, entry] of Object.entries(REGISTRY.features)) {
        for (const [name, c] of Object.entries(entry.cases)) {
          const src = readFileSync(resolve(ROOT, c.script), 'utf8');
          if (!src.includes('VERIFY_EVIDENCE_DIR') && c.evidence === undefined) {
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
    () =>
      withFake({ x: JOURNEY }, (fake) => {
        const r = fake.run(['drive', 't', 'x', '--dry-run']);
        const own = fake.run(['drive', 't', 'x', '--dry-run', '--', 'create-task', '--out', '/tmp/x']);
        const dir = r.out.match(/VERIFY_EVIDENCE_DIR=(\S+)/)?.[1] ?? 'missing';
        const ownArgs = own.out.match(/ args (.*)\n/)?.[1] ?? '';
        return (
          r.code === 0 &&
          r.out.includes(`args create-task --out ${dir}\n`) &&
          own.code === 0 &&
          ownArgs === 'create-task --out /tmp/x'
        );
      }),
  ],
  [
    "arguments after -- keep the case's own positional args (the probe or journey name)",
    () =>
      withFake({ x: JOURNEY }, (fake) => {
        // Giving the name again after -- does not run it twice (covered by the output-flag case).
        const r = fake.run(['drive', 't', 'x', '--dry-run', '--', '--out', '/tmp/x']);
        return r.code === 0 && /args create-task --out \/tmp\/x\n/.test(r.out);
      }),
  ],
  [
    'an output option given after -- is the evidence directory; drive makes none of its own',
    () =>
      withFake({ x: JOURNEY, out: { ...STUB, evidence: { flag: '--out' } } }, (fake) => {
        const dry = fake.run(['drive', 't', 'x', '--dry-run', '--', '--out', '/tmp/x']);
        const mine = join(fake.root, 'mine');
        const r = fake.run(['drive', 't', 'out', '--', '--out', mine]);
        const made = fake.evidence();
        // Without the option after --, the probe gets drive's own directory through it.
        const auto = fake.run(['drive', 't', 'out']);
        const autoDir = auto.out.match(/vp: evidence (\S+)/)?.[1] ?? '';
        const argv = existsSync(join(autoDir, 'result.json'))
          ? JSON.parse(readFileSync(join(autoDir, 'result.json'), 'utf8')).argv.join(' ')
          : '';
        return (
          dry.code === 0 &&
          !dry.out.includes('VERIFY_EVIDENCE_DIR=') &&
          r.code === 0 &&
          r.out.includes(`vp: evidence ${mine}`) &&
          made.length === 0 &&
          auto.code === 0 &&
          argv === `--out ${autoDir}`
        );
      }),
  ],
  [
    'a probe that reads another variable gets the evidence directory through it',
    () =>
      withFake({ x: { ...STUB, evidence: { env: 'EVIDENCE_DIR' } } }, (fake) => {
        const r = fake.run(['drive', 't', 'x', '--dry-run']);
        return (
          r.code === 0 &&
          new RegExp(`^ +EVIDENCE_DIR=${fake.evidenceRoot}/\\d{8}-\\d{6}-t-x$`, 'm').test(r.out) &&
          !r.out.includes('VERIFY_EVIDENCE_DIR=')
        );
      }),
  ],
  [
    'a case whose usage names required arguments refuses to run without them',
    () =>
      withFake({ x: { ...NEEDS_ARGS, status: 'stale' } }, (fake) => {
        const bare = fake.run(['drive', 't', 'x', '--force', '--dry-run']);
        const given = fake.run(['drive', 't', 'x', '--force', '--dry-run', '--', 't1', 'b1']);
        // The --force list is printed for a run that goes ahead, not before this refusal.
        return (
          bare.code === 2 &&
          bare.out.includes('needs arguments: <todoId> <branch>') &&
          !/--force drives/.test(bare.out) &&
          given.code === 0 &&
          /--force drives/.test(given.out) &&
          /args t1 b1\n/.test(given.out)
        );
      }),
  ],
  [
    'a registry entry with a missing script or a tsx case without cwd fails before doctor, also in --dry-run',
    () =>
      withFake(
        {
          missing: { ...STUB, script: 'nope.mjs', needs: ['stack'] },
          nocwd: { ...STUB, runner: 'tsx', needs: ['stack'] },
        },
        (fake) => {
          const run = join(fake.root, 'run');
          const a = fake.run(['drive', 't', 'missing'], { VERIFY_RUN_DIR: run });
          const b = fake.run(['drive', 't', 'missing', '--dry-run'], { VERIFY_RUN_DIR: run });
          const c = fake.run(['drive', 't', 'nocwd', '--dry-run'], { VERIFY_RUN_DIR: run });
          return (
            a.code === 1 &&
            /registered script is missing/.test(a.out) &&
            !/doctor/.test(a.out) &&
            b.code === 1 &&
            c.code === 1 &&
            /no cwd/.test(c.out) &&
            fake.evidence().length === 0
          );
        },
      ),
  ],
  [
    'feature and case names are looked up as registry keys only',
    () =>
      withFake({ x: STUB }, (fake) => {
        const a = fake.run(['drive', 'toString', '--dry-run']);
        const b = fake.run(['list', 'constructor']);
        const c = fake.run(['drive', 't', 'constructor', '--dry-run']);
        return a.code === 2 && /unknown feature/.test(a.out) && b.code === 2 && c.code === 2 && /unknown case/.test(c.out);
      }),
  ],
  [
    'a case that needs the stack gets the ports of the stack doctor checks',
    () =>
      withFake({ x: { ...STUB, needs: ['stack'] } }, (fake) => {
        const run = join(fake.root, 'run');
        mkdirSync(run);
        writeFileSync(join(run, 'ports.json'), JSON.stringify({ serverPort: 8792, webPort: 5274 }));
        const r = fake.run(['drive', 't', 'x', '--dry-run'], { VERIFY_RUN_DIR: run });
        const clash = fake.run(['drive', 't', 'x', '--dry-run'], { VERIFY_RUN_DIR: run, VERIFY_PORT: '8791' });
        return (
          r.code === 0 &&
          r.out.includes('VERIFY_PORT=8792') &&
          r.out.includes('VERIFY_WEB_PORT=5274') &&
          clash.code === 2 &&
          /8791/.test(clash.out) &&
          /8792/.test(clash.out)
        );
      }),
  ],
  [
    'a drive never writes into an evidence directory that already exists',
    () =>
      withFake({ ok: STUB }, (fake) => {
        const now = Date.now();
        const taken = [0, 1, 2, 3].map((s) => join(fake.evidenceRoot, `${localStamp(now + s * 1000)}-t-ok`));
        for (const dir of taken) mkdirSync(dir, { recursive: true });
        const r = fake.run(['drive', 't', 'ok']);
        const printed = r.out.match(/vp: evidence (\S+)/)?.[1] ?? '';
        const untouched = taken.every((dir) => readdirSync(dir).length === 0);
        const wrote = printed !== '' && existsSync(join(printed, 'result.json'));
        return r.code === 0 && !taken.includes(printed) && untouched && wrote;
      }),
  ],
  [
    'capture never writes into a capture directory that already exists',
    () => {
      const run = tempDir('vp-selftest-run-');
      const ev = join(run, 'ev');
      mkdirSync(join(ev, 'capture-page'), { recursive: true });
      writeFileSync(join(run, 'ports.json'), JSON.stringify({ serverPort: 9, webPort: 9 }));
      vp(['capture', '/app', '--wait', '0'], { VERIFY_RUN_DIR: run, VERIFY_EVIDENCE_DIR: ev });
      const first = readdirSync(join(ev, 'capture-page')).length;
      // The page cannot load (port 9); capture records that in the new directory.
      const second = existsSync(join(ev, 'capture-page-2', 'result.json'));
      rmSync(run, { recursive: true, force: true });
      return first === 0 && second;
    },
  ],
  [
    'drive refuses an evidence directory inside committed docs/verify before anything runs',
    () =>
      withFake({ x: STUB, out: { ...STUB, evidence: { flag: '--out' } } }, (fake) => {
        const archived = committedEvidence(fake.root);
        const verify = join(fake.root, 'docs', 'verify');
        symlinkSync(join(verify, 'T'), join(fake.root, 'link'));
        const before = snapshot(verify);
        const refused = [
          ...['docs/verify/T/run-a', archived, 'docs/verify/T/run-new', 'link/run-a'].flatMap((dir) => [
            fake.run(['drive', 't', 'x'], { VERIFY_EVIDENCE_DIR: dir }),
            fake.run(['drive', 't', 'x', '--dry-run'], { VERIFY_EVIDENCE_DIR: dir }),
          ]),
          fake.run(['drive', 't', 'out', '--', '--out', 'docs/verify/T/run-a']),
          fake.run(['drive', 't', 'out', '--dry-run', '--', '--out', archived]),
        ];
        // A directory beside docs/verify whose name starts the same is not committed evidence.
        const beside = fake.run(['drive', 't', 'x', '--dry-run'], { VERIFY_EVIDENCE_DIR: 'docs/verify-notes/run' });
        return (
          refused.every(
            (r) => r.code === 2 && r.out.includes('vp.mjs archive <ticket> --from <dir>') && !/ -> |dry-run/.test(r.out),
          ) &&
          snapshot(verify) === before &&
          fake.evidence().length === 0 &&
          beside.code === 0
        );
      }),
  ],
  [
    'capture refuses an evidence directory inside committed docs/verify before anything runs',
    () =>
      withFake({}, (fake) => {
        const archived = committedEvidence(fake.root);
        const verify = join(fake.root, 'docs', 'verify');
        const run = join(fake.root, 'run');
        mkdirSync(run);
        writeFileSync(join(run, 'ports.json'), JSON.stringify({ serverPort: 9, webPort: 9 }));
        const before = snapshot(verify);
        const refused = ['docs/verify/T/run-a', archived].map((dir) =>
          fake.run(['capture', '/app', '--wait', '0'], { VERIFY_RUN_DIR: run, VERIFY_EVIDENCE_DIR: dir }),
        );
        return (
          refused.every((r) => r.code === 2 && r.out.includes('vp.mjs archive <ticket> --from <dir>') && !/captured/.test(r.out)) &&
          snapshot(verify) === before &&
          fake.evidence().length === 0
        );
      }),
  ],
  [
    'links encodes non-ASCII file names instead of quoting them',
    () => {
      const repo = tempDir('vp-selftest-git-');
      const g = gitAt(repo);
      let r = { code: null, out: '' };
      try {
        g('init', '-q');
        g('remote', 'add', 'origin', 'https://github.com/o/r.git');
        mkdirSync(join(repo, 'docs', 'verify', 'T'), { recursive: true });
        writeFileSync(join(repo, 'docs', 'verify', 'T', '截图.png'), 'x');
        g('add', '.');
        g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 't');
        r = vp(['links', 'T', '--sha', 'HEAD'], { VERIFY_REPO_ROOT: repo });
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
      return r.code === 0 && /^!\[截图\.png\]\(https:\/\/raw\.githubusercontent\.com\/o\/r\/[0-9a-f]{40}\/docs\/verify\/T\/%E6%88%AA%E5%9B%BE\.png\)$/m.test(r.out);
    },
  ],
  [
    'arguments after -- replace only the default options they name',
    () =>
      withFake({ x: { ...STUB, args: ['--expect=after'] } }, (fake) => {
        const keep = fake.run(['drive', 't', 'x', '--dry-run', '--', '--focus=hunkless']);
        const swap = fake.run(['drive', 't', 'x', '--dry-run', '--', '--expect=before']);
        return /args --expect=after --focus=hunkless\n/.test(keep.out) && /args --expect=before\n/.test(swap.out);
      }),
  ],
  [
    'a probe gets the run directory doctor checked',
    () =>
      withFake({ x: { ...STUB, needs: ['stack'] } }, (fake) => {
        const other = join(fake.root, 'other');
        mkdirSync(other);
        const r = fake.run(['drive', 't', 'x', '--dry-run'], { VERIFY_REPO_ROOT: other });
        return r.code === 0 && r.out.includes(`VERIFY_RUN_DIR=${join(other, '.claude', 'verify-run')}\n`);
      }),
  ],
  [
    'no current case depends on a seed script that creates an agent without machineId',
    () => {
      const dependent = seedDependents(REGISTRY, import.meta.dirname, ROOT);
      if (dependent.length > 0) console.log(`      dependent: ${dependent.join(', ')}`);
      return dependent.length === 0;
    },
  ],
  [
    "the seed check's optional exemption covers only the seed the usage marks optional",
    () => {
      const dir = tempDir('vp-selftest-seed-');
      try {
        const broken = 'const t = 1;\nawait post(`/api/teams/${t}/agents`, { name: "a" });\n';
        writeFileSync(join(dir, 'setup-bad-seed.mjs'), broken);
        writeFileSync(join(dir, 'setup-other-seed.mjs'), broken);
        // [probe source, usage]: a calls the seed and only an option is optional;
        // b names the seed in its optional clause; c calls one seed and marks
        // another optional; d names the seed outside the optional clause.
        const probes = {
          a: ['// run setup-bad-seed.mjs first\n', '--expect=old optional'],
          b: ['', '[todoId] (optional; seed via setup-bad-seed.mjs)'],
          c: ["import './setup-bad-seed.mjs';\n", '[todoId] (optional; seed via setup-other-seed.mjs)'],
          d: ['', 'needs setup-bad-seed.mjs; --expect=old optional'],
        };
        const cases = {};
        for (const [name, [src, usage]] of Object.entries(probes)) {
          writeFileSync(join(dir, `probe-${name}.mjs`), src);
          cases[name] = { ...STUB, script: `probe-${name}.mjs`, usage };
        }
        const registry = {
          support: { 'setup-bad-seed.mjs': { kind: 'seed' }, 'setup-other-seed.mjs': { kind: 'seed' } },
          features: { t: { recipe: null, cases } },
        };
        const got = seedDependents(registry, dir, dir).join(', ');
        const want = 't/a (setup-bad-seed.mjs), t/c (setup-bad-seed.mjs), t/d (setup-bad-seed.mjs)';
        if (got !== want) console.log(`      dependent: ${got || '(none)'}`);
        return got === want;
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  ],
  [
    'cleanup reports the evidence root drive writes to',
    () =>
      withFake({}, (fake) => {
        const r = fake.run(['cleanup']);
        return r.code === 0 && r.out.includes(`evidence-root ${fake.evidenceRoot}\n`);
      }, { 'cleanup.mjs': 'console.log(`evidence-root ${process.env.VERIFY_EVIDENCE_DIR}`);\n' }),
  ],
  [
    'with the temp dir inside a git repository, a fake skill writes nothing outside its own root',
    () => {
      // The outer repository stands for a checkout that holds TMPDIR. Its
      // .claude/verify-evidence is a shared root that archive --latest reads.
      const outer = tempDir('vp-selftest-outer-');
      const saved = process.env.TMPDIR;
      let fake;
      let r = { code: null, out: '' };
      let top = [];
      let inTmp = [];
      try {
        gitAt(outer)('init', '-q');
        mkdirSync(join(outer, 'tmp'));
        process.env.TMPDIR = join(outer, 'tmp');
        fake = fakeSkill({ ok: STUB });
        r = fake.run(['drive', 't', 'ok']);
        top = readdirSync(outer).sort();
        inTmp = readdirSync(join(outer, 'tmp'));
      } finally {
        if (saved === undefined) delete process.env.TMPDIR;
        else process.env.TMPDIR = saved;
        fake?.done();
        rmSync(outer, { recursive: true, force: true });
      }
      const dir = r.out.match(/vp: evidence (\S+)/)?.[1] ?? '';
      return (
        r.code === 0 &&
        dir.startsWith(`${fake?.evidenceRoot}/`) &&
        top.join(',') === '.git,tmp' &&
        inTmp.length === 1
      );
    },
  ],
  [
    '--help lists every command',
    () => {
      const r = vp(['--help']);
      const commands = ['launch', 'doctor', 'cleanup', 'list', 'drive', 'capture', 'archive', 'links'];
      const missing = commands.filter((c) => !new RegExp(`^  ${c}\\b`, 'm').test(r.out));
      if (missing.length > 0) console.log(`      missing: ${missing.join(', ')}`);
      return r.code === 0 && missing.length === 0;
    },
  ],
  [
    'launch and doctor forward their arguments and exit code to their scripts',
    () => {
      const stub = (marker, code) =>
        `console.log('${marker}', JSON.stringify(process.argv.slice(2)));\nprocess.exit(${code});\n`;
      return withFake(
        {},
        (fake) => {
          const launch = fake.run(['launch', '--keep', 'x']);
          const doctor = fake.run(['doctor', '--json']);
          return (
            launch.code === 3 &&
            launch.out.includes('launch-stub ["--keep","x"]\n') &&
            doctor.code === 4 &&
            doctor.out.includes('doctor-stub ["--json"]\n')
          );
        },
        { 'launch.mjs': stub('launch-stub', 3), 'doctor.mjs': stub('doctor-stub', 4) },
      );
    },
  ],
  [
    'a case that needs arguments is not satisfied by options alone',
    () =>
      withFake({ x: NEEDS_ARGS }, (fake) => {
        const r = fake.run(['drive', 't', 'x', '--dry-run', '--', '--expect=old']);
        return r.code === 2 && /needs arguments/.test(r.out);
      }),
  ],
  [
    "an output path given after -- is made absolute against the caller's directory",
    () =>
      withFake({ x: JOURNEY }, (fake) => {
        const cwd = join(fake.root, 'caller');
        mkdirSync(cwd);
        const r = fake.run(['drive', 't', 'x', '--dry-run', '--', '--out', 'rel/ev'], {}, cwd);
        return r.code === 0 && r.out.includes(`args create-task --out ${join(cwd, 'rel', 'ev')}\n`);
      }),
  ],
  [
    'an output directory named like the journey does not replace the journey',
    () =>
      withFake({ x: JOURNEY }, (fake) => {
        const cwd = join(fake.root, 'caller');
        mkdirSync(cwd);
        const r = fake.run(['drive', 't', 'x', '--dry-run', '--', '--out', 'create-task'], {}, cwd);
        return r.code === 0 && r.out.includes(`args create-task --out ${join(cwd, 'create-task')}\n`);
      }),
  ],
  [
    'an output option without its directory as the next argument is refused before anything runs',
    () =>
      withFake({ x: JOURNEY }, (fake) => {
        const joined = fake.run(['drive', 't', 'x', '--dry-run', '--', '--out=rel/ev']);
        const bare = fake.run(['drive', 't', 'x', '--dry-run', '--', '--out']);
        return [joined, bare].every((r) => r.code === 2 && r.out.includes('--out takes its directory as the next argument'));
      }),
  ],
  [
    'capture refuses a --wait that is not a number of milliseconds',
    () => {
      const run = tempDir('vp-selftest-run-');
      writeFileSync(join(run, 'ports.json'), JSON.stringify({ serverPort: 9, webPort: 9 }));
      const r = vp(['capture', '/app', '--wait', '1s'], { VERIFY_RUN_DIR: run, VERIFY_EVIDENCE_DIR: join(run, 'ev') });
      const made = existsSync(join(run, 'ev'));
      rmSync(run, { recursive: true, force: true });
      return r.code === 2 && /--wait/.test(r.out) && !made;
    },
  ],
  [
    'a case that writes its evidence itself gets no evidence directory',
    () =>
      withFake({ x: { ...STUB, evidence: { writes: 'docs/verify/926/' } } }, (fake) => {
        const r = fake.run(['drive', 't', 'x', '--dry-run']);
        return (
          r.code === 0 && /writes its evidence itself: docs\/verify\/926\//.test(r.out) && !r.out.includes('VERIFY_EVIDENCE_DIR=')
        );
      }),
  ],
  [
    '--force lets a stale case run',
    () =>
      withFake({ x: { ...STUB, status: 'stale' } }, (fake) => {
        const r = fake.run(['drive', 't', 'x', '--force']);
        return r.code === 0 && fake.evidence().length === 1;
      }),
  ],
  [
    'a failed doctor leaves no evidence directory behind',
    () =>
      withFake(
        { x: { ...STUB, needs: ['stack'] } },
        (fake) => {
          const ev = join(fake.root, 'ev');
          const r = fake.run(['drive', 't', 'x'], { VERIFY_EVIDENCE_DIR: ev });
          return r.code === 1 && /doctor failed/.test(r.out) && !existsSync(ev) && fake.evidence().length === 0;
        },
        { 'doctor.mjs': 'process.exit(1);\n' },
      ),
  ],
  [
    'links prints sha-pinned raw links and refuses a ticket with no evidence',
    () => {
      // A throwaway repository with its own committed evidence, so the case does
      // not depend on this repository's docs/verify.
      const repo = tempDir('vp-selftest-git-');
      const g = gitAt(repo);
      let r = { code: null, out: '' };
      let none = { code: null, out: '' };
      let sha = '';
      try {
        g('init', '-q');
        g('remote', 'add', 'origin', 'https://github.com/o/r.git');
        for (const [ticket, file] of [
          ['T', 'result.json'],
          ['T', 'shot.png'],
          ['U', 'other.json'],
        ]) {
          mkdirSync(join(repo, 'docs', 'verify', ticket), { recursive: true });
          writeFileSync(join(repo, 'docs', 'verify', ticket, file), 'x');
        }
        g('add', '.');
        g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 't');
        sha = g('rev-parse', 'HEAD').trim();
        r = vp(['links', 'T', '--sha', 'HEAD'], { VERIFY_REPO_ROOT: repo });
        none = vp(['links', '999999', '--sha', 'HEAD'], { VERIFY_REPO_ROOT: repo });
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
      const base = `https://raw.githubusercontent.com/o/r/${sha}/docs/verify/T`;
      const lines = r.out.split('\n').filter((l) => l.includes('raw.githubusercontent.com'));
      return (
        r.code === 0 &&
        /^[0-9a-f]{40}$/.test(sha) &&
        lines.join('\n') === `[result.json](${base}/result.json)\n![shot.png](${base}/shot.png)` &&
        none.code === 1 &&
        /no files under docs\/verify\/999999/.test(none.out)
      );
    },
  ],
  [
    "a drive without VERIFY_EVIDENCE_DIR gets its own <time>-<feature>-<case> directory under the checkout's .claude/verify-evidence",
    () =>
      withFake({ x: STUB }, (fake) => {
        const r = fake.run(['drive', 't', 'x', '--dry-run']);
        return r.code === 0 && new RegExp(`VERIFY_EVIDENCE_DIR=${fake.evidenceRoot}/\\d{8}-\\d{6}-t-x\\n`).test(r.out);
      }),
  ],
  [
    'a drive from a worktree puts its evidence under the main checkout, not the worktree',
    () => {
      // vp.mjs runs from a real worktree of a throwaway repository.
      const root = tempDir('vp-selftest-wt-');
      const main = join(root, 'main');
      const wt = join(main, '.claude', 'worktrees', 'wt');
      let r = { code: null, out: '' };
      try {
        mkdirSync(main);
        const g = gitAt(main);
        g('init', '-q');
        writeFileSync(join(main, 'README'), 'x\n');
        g('add', 'README');
        g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 't');
        g('worktree', 'add', '-q', '--detach', wt);
        const script = installSkill(wt, { ok: STUB });
        r = vp(['drive', 't', 'ok', '--dry-run'], {}, wt, script);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
      return (
        r.code === 0 &&
        r.out.includes(`VERIFY_EVIDENCE_DIR=${join(main, '.claude', 'verify-evidence')}/`) &&
        !r.out.includes(join(wt, '.claude', 'verify-evidence'))
      );
    },
  ],
  [
    'a tsx case runs from its package directory, a node case from the repo root',
    () =>
      withFake({ tsx: { ...STUB, runner: 'tsx', cwd: 'pkg' }, node: STUB }, (fake) => {
        const elsewhere = join(fake.root, 'elsewhere');
        mkdirSync(elsewhere);
        const tsx = fake.run(['drive', 't', 'tsx', '--dry-run']);
        const node = fake.run(['drive', 't', 'node', '--dry-run'], {}, elsewhere);
        return tsx.out.includes(`runner tsx  cwd ${join(fake.root, 'pkg')}\n`) && node.out.includes(`runner node  cwd ${fake.root}\n`);
      }),
  ],
  [
    'a case that needs the stack runs doctor first',
    () =>
      withFake({ x: { ...STUB, needs: ['stack'] }, y: STUB }, (fake) => {
        const r = fake.run(['drive', 't', 'x', '--dry-run']);
        const plain = fake.run(['drive', 't', 'y', '--dry-run']);
        return r.code === 0 && /doctor first/.test(r.out) && plain.code === 0 && !/doctor first/.test(plain.out);
      }),
  ],
  [
    'a stale case needs --force',
    () =>
      withFake({ x: { ...STUB, status: 'stale' } }, (fake) => {
        const r = fake.run(['drive', 't', 'x']);
        return r.code === 2 && /is stale/.test(r.out) && fake.evidence().length === 0;
      }),
  ],
  [
    'a stale case that also has a forced need names both in its refusal, and --force names them before running',
    () =>
      withFake(
        { x: { ...STUB, status: 'stale', note: 'waits for a removed chip.', needs: ['real-llm', 'rewrites-evidence'] } },
        (fake) => {
          const refused = fake.run(['drive', 't', 'x']);
          const before = fake.evidence().length;
          const forced = fake.run(['drive', 't', 'x', '--force']);
          const after = fake.evidence().length;
          const reasons = [
            'is stale: waits for a removed chip',
            'needs real-llm (spends model tokens)',
            'needs rewrites-evidence (rewrites committed docs/verify evidence in place)',
          ];
          const ranAt = forced.out.indexOf('vp: t/x -> ');
          return (
            refused.code === 2 &&
            reasons.every((s) => refused.out.includes(s)) &&
            /--force/.test(refused.out) &&
            before === 0 &&
            forced.code === 0 &&
            ranAt !== -1 &&
            reasons.every((s) => forced.out.slice(0, ranAt).includes(s)) &&
            after === 1
          );
        },
      ),
  ],
  [
    'a stray positional argument is refused',
    () =>
      withFake({ x: STUB }, (fake) => {
        const r = fake.run(['drive', 't', 'x', 'm', '--dry-run']);
        return r.code === 2 && /script arguments go after --/.test(r.out);
      }),
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
    'archive refuses to overwrite an archived directory and leaves the archive as it was',
    () => {
      // The archive is unchanged after the refusal, and a run naming one new and
      // one archived source copies neither: a refusal that comes after the copy
      // fails here.
      const { root, src } = tempRoot();
      const archive = join(root, 'docs', 'verify', 'T');
      writeFileSync(join(archive, 'run-a', 'result.json'), '{"archived":true}\n');
      writeFileSync(join(src, 'run-a', 'shot.png'), 'x');
      const before = snapshot(archive);
      const one = vp(['archive', 'T', '--from', join(src, 'run-a')], { VERIFY_REPO_ROOT: root });
      const mixed = vp(['archive', 'T', '--from', join(src, 'run-b'), '--from', join(src, 'run-a')], {
        VERIFY_REPO_ROOT: root,
      });
      const after = snapshot(archive);
      rmSync(root, { recursive: true, force: true });
      return [one, mixed].every((r) => r.code === 1 && /add-only/.test(r.out)) && after === before;
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
      const runs = ['-1', '0', 'x'].map((n) => vp(['archive', 'T5', '--latest', n], { VERIFY_REPO_ROOT: root }));
      const copied = existsSync(join(root, 'docs', 'verify', 'T5'));
      rmSync(root, { recursive: true, force: true });
      return runs.every((r) => r.code === 2 && r.out.includes('--latest needs a positive integer\n')) && !copied;
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
      const refused = '--latest cannot be combined with --from or VERIFY_EVIDENCE_DIR; name one source\n';
      return [a, b].every((r) => r.code === 2 && r.out.includes(refused)) && !copied;
    },
  ],
  [
    'archive refuses a source given without --from',
    () => {
      const { root, src } = tempRoot();
      const stray = join(src, 'run-b');
      const r = vp(['archive', 'T6', stray], { VERIFY_REPO_ROOT: root, VERIFY_EVIDENCE_DIR: join(src, 'run-a') });
      const copied = existsSync(join(root, 'docs', 'verify', 'T6'));
      rmSync(root, { recursive: true, force: true });
      return r.code === 2 && r.out.includes(`unexpected argument(s) ${stray}: name a source with --from <dir>\n`) && !copied;
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
  [
    'archive --latest 1 copies the newest run only',
    () =>
      withFake({}, (fake) => {
        // Name order and mtime order disagree, so only the newest by mtime is run-b.
        const now = Date.now() / 1000;
        for (const [name, age] of [
          ['run-a', 200],
          ['run-b', 0],
          ['run-c', 100],
        ]) {
          const dir = join(fake.evidenceRoot, name);
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, 'result.json'), '{}\n');
          utimesSync(dir, now - age, now - age);
        }
        const repo = join(fake.root, 'repo');
        const r = fake.run(['archive', 'T8', '--latest', '1'], { VERIFY_REPO_ROOT: repo });
        const target = join(repo, 'docs', 'verify', 'T8');
        const copied = existsSync(target) ? readdirSync(target) : [];
        const files = existsSync(join(target, 'run-b')) ? readdirSync(join(target, 'run-b')) : [];
        return r.code === 0 && copied.join(',') === 'run-b' && files.includes('result.json');
      }),
  ],
  [
    "a VERIFY_WEB_PORT other than the stack's web port is refused",
    () =>
      withFake({ x: { ...STUB, needs: ['stack'] } }, (fake) => {
        const run = join(fake.root, 'run');
        mkdirSync(run);
        writeFileSync(join(run, 'ports.json'), JSON.stringify({ serverPort: 8792, webPort: 5274 }));
        const clash = fake.run(['drive', 't', 'x', '--dry-run'], { VERIFY_RUN_DIR: run, VERIFY_WEB_PORT: '5273' });
        const same = fake.run(['drive', 't', 'x', '--dry-run'], { VERIFY_RUN_DIR: run, VERIFY_WEB_PORT: '5274' });
        return (
          clash.code === 2 &&
          clash.out.includes(`VERIFY_WEB_PORT=5273, but the stack in ${run} runs on 5274`) &&
          !/dry-run/.test(clash.out) &&
          same.code === 0
        );
      }),
  ],
  [
    'drive and capture refuse an evidence directory inside docs/verify of any worktree of the repository',
    () => {
      // vp.mjs sits in the main checkout; the caller works in worktree p2, and p3
      // is a third worktree. other is a repository of its own (a second clone).
      // p2, p3 and other each hold archived evidence.
      const root = tempDir('vp-selftest-wts-');
      const main = join(root, 'main');
      const [p2, p3, other] = [join(root, 'p2'), join(root, 'p3'), join(root, 'other')];
      let runs = [];
      let beside = { code: null, out: '' };
      let unchanged = false;
      let made = ['not run'];
      try {
        mkdirSync(main);
        const g = gitAt(main);
        g('init', '-q');
        writeFileSync(join(main, 'README'), 'x\n');
        g('add', 'README');
        g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 't');
        g('worktree', 'add', '-q', '--detach', p2);
        g('worktree', 'add', '-q', '--detach', p3);
        mkdirSync(other);
        gitAt(other)('init', '-q');
        const script = installSkill(main, { x: STUB, out: { ...STUB, evidence: { flag: '--out' } } });
        for (const wt of [p2, p3, other]) committedEvidence(wt);
        const run = join(root, 'run');
        mkdirSync(run);
        writeFileSync(join(run, 'ports.json'), JSON.stringify({ serverPort: 9, webPort: 9 }));
        const before = [p2, p3, other].map((wt) => snapshot(join(wt, 'docs', 'verify')));
        const at = (cwd, args, env = {}) => vp(args, env, cwd, script);
        const inP2 = 'docs/verify/T/run-a';
        runs = [
          // The reproduction from pr-gate run 9: relative to the caller's worktree.
          at(p2, ['drive', 't', 'x'], { VERIFY_EVIDENCE_DIR: inP2 }),
          at(p2, ['drive', 't', 'x', '--dry-run'], { VERIFY_EVIDENCE_DIR: inP2 }),
          at(main, ['drive', 't', 'x'], { VERIFY_EVIDENCE_DIR: join(p3, 'docs', 'verify', 'T', 'run-new') }),
          at(p2, ['drive', 't', 'out', '--', '--out', join(p3, 'docs', 'verify', 'T', 'run-a')]),
          at(p2, ['drive', 't', 'out', '--', '--out', 'docs/verify/T/run-b']),
          at(p2, ['capture', '/app', '--wait', '0'], { VERIFY_RUN_DIR: run, VERIFY_EVIDENCE_DIR: inP2 }),
          // The caller's own repository, which is not vp.mjs's.
          at(other, ['drive', 't', 'x'], { VERIFY_EVIDENCE_DIR: inP2 }),
        ];
        beside = at(p2, ['drive', 't', 'x', '--dry-run'], { VERIFY_EVIDENCE_DIR: 'docs/verify-notes/run' });
        unchanged = [p2, p3, other].every((wt, i) => snapshot(join(wt, 'docs', 'verify')) === before[i]);
        const evidenceRoot = join(main, '.claude', 'verify-evidence');
        made = existsSync(evidenceRoot) ? readdirSync(evidenceRoot) : [];
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
      return (
        runs.every((r) => r.code === 2 && r.out.includes('vp.mjs archive <ticket> --from <dir>')) &&
        unchanged &&
        made.length === 0 &&
        beside.code === 0
      );
    },
  ],
  [
    'a fresh-stack case runs only on a stack nothing was driven on since launch',
    () =>
      withFake(
        { plain: { ...STUB, needs: ['stack'] }, fresh: { ...STUB, needs: ['stack', 'fresh-stack'] } },
        (fake) => {
          const stackAt = (name) => {
            const run = join(fake.root, name);
            mkdirSync(run);
            writeFileSync(join(run, 'ports.json'), JSON.stringify({ serverPort: 8792, webPort: 5274 }));
            return { VERIFY_RUN_DIR: run };
          };
          const a = stackAt('run-a');
          // A dry run drives nothing, so the first real drive still finds the stack fresh.
          const dry = fake.run(['drive', 't', 'plain', '--dry-run'], a);
          const first = fake.run(['drive', 't', 'fresh'], a);
          const again = fake.run(['drive', 't', 'fresh'], a);
          const forced = fake.run(['drive', 't', 'fresh', '--force'], a);
          // Another stack (a new launch empties its run directory): the plain drive
          // before it is what the refusal names.
          const b = stackAt('run-b');
          const plain = fake.run(['drive', 't', 'plain'], b);
          const after = fake.run(['drive', 't', 'fresh'], b);
          return (
            dry.code === 0 &&
            first.code === 0 &&
            again.code === 2 &&
            again.out.includes('needs fresh-stack') &&
            again.out.includes('t/fresh') &&
            again.out.includes('vp.mjs launch') &&
            forced.code === 0 &&
            /--force drives t\/fresh:[\s\S]*fresh-stack/.test(forced.out) &&
            plain.code === 0 &&
            after.code === 2 &&
            after.out.includes('t/plain')
          );
        },
        { 'doctor.mjs': 'process.exit(0);\n' },
      ),
  ],
  [
    'an own-stack case is refused while a stack is up in the run directory, also with --force',
    () =>
      withFake({ glass: { ...JOURNEY, needs: ['own-stack'] } }, (fake) => {
        const run = join(fake.root, 'run');
        mkdirSync(run);
        writeFileSync(join(run, 'ports.json'), JSON.stringify({ serverPort: 8791, webPort: 5273 }));
        const up = [
          fake.run(['drive', 't', 'glass'], { VERIFY_RUN_DIR: run }),
          fake.run(['drive', 't', 'glass', '--dry-run'], { VERIFY_RUN_DIR: run }),
          fake.run(['drive', 't', 'glass', '--force'], { VERIFY_RUN_DIR: run }),
        ];
        const down = fake.run(['drive', 't', 'glass', '--dry-run'], { VERIFY_RUN_DIR: join(fake.root, 'none') });
        return (
          up.every((r) => r.code === 2 && r.out.includes(run) && r.out.includes('vp.mjs cleanup')) &&
          fake.evidence().length === 0 &&
          down.code === 0
        );
      }),
  ],
  [
    'cases whose usage asks for a fresh stack need fresh-stack; cases that start their own stack need own-stack',
    () => {
      const missing = [];
      for (const [feature, entry] of Object.entries(REGISTRY.features)) {
        for (const [name, c] of Object.entries(entry.cases)) {
          const usage = c.usage ?? '';
          if (/fresh (DB|database|stack)/i.test(usage) && !c.needs.includes('fresh-stack')) missing.push(`${feature}/${name} fresh-stack`);
          if (/starts and stops its own stack/.test(usage) && !c.needs.includes('own-stack')) missing.push(`${feature}/${name} own-stack`);
        }
      }
      if (missing.length > 0) console.log(`      missing: ${missing.join(', ')}`);
      return missing.length === 0;
    },
  ],
  [
    'the registry gate passes on this checkout',
    () => {
      const r = spawnSync(process.execPath, [GATE], { encoding: 'utf8' });
      if (r.status !== 0) console.log(`${r.stdout}${r.stderr}`.replace(/^/gm, '      ').trimEnd());
      return r.status === 0;
    },
  ],
  [
    'the registry gate keeps support scripts, seeds and the existing ticket-named probes green',
    () => {
      const r = runGate(gateRegistry(), GATE_SCRIPTS, GATE_MAPS);
      return r.code === 0 && /^vp-registry-gate: OK/m.test(r.out);
    },
  ],
  [
    'a new drive-<number> script turns the registry gate red, registered or not',
    () => {
      const stray = runGate(gateRegistry(), [...GATE_SCRIPTS, 'drive-1500-new.mjs'], GATE_MAPS);
      const registered = runGate(
        gateRegistry({ new: { ...STUB, script: `${GATE_DIR}drive-1500-new.mjs` } }),
        [...GATE_SCRIPTS, 'drive-1500-new.mjs'],
        GATE_MAPS,
      );
      const helper = runGate(gateRegistry(), [...GATE_SCRIPTS, 'helper.mjs'], GATE_MAPS);
      return (
        stray.code === 1 &&
        stray.out.includes('scripts/drive-1500-new.mjs: not registered') &&
        stray.out.includes('scripts/drive-1500-new.mjs: named after a ticket') &&
        registered.code === 1 &&
        !registered.out.includes('not registered') &&
        registered.out.includes('scripts/drive-1500-new.mjs: named after a ticket') &&
        helper.code === 1 &&
        helper.out.includes('scripts/helper.mjs: not registered') &&
        !helper.out.includes('named after a ticket')
      );
    },
  ],
  [
    'the registry gate refuses a registry without cases',
    () => {
      const scripts = GATE_SCRIPTS.filter((name) => !name.startsWith('drive-'));
      const none = runGate({ support: gateRegistry().support, features: {} }, scripts, {});
      const empty = runGate({ support: gateRegistry().support, features: { t: { recipe: null, cases: {} } } }, scripts, {});
      return [none, empty].every((r) => r.code === 1 && r.out.includes('vp-registry.json has no cases'));
    },
  ],
  [
    'the registry gate: a case that writes into docs/verify needs rewrites-evidence',
    () => {
      const writes = (needs, path) => gateRegistry({ w: { ...STUB, script: `${GATE_DIR}drive-hotkeys.mjs`, needs, evidence: { writes: path } } });
      const bare = runGate(writes([], 'docs/verify/9/x.json'), GATE_SCRIPTS, GATE_MAPS);
      const marked = runGate(writes(['rewrites-evidence'], 'docs/verify/9/x.json'), GATE_SCRIPTS, GATE_MAPS);
      const elsewhere = runGate(writes([], '.claude/verify-evidence/x/'), GATE_SCRIPTS, GATE_MAPS);
      return (
        bare.code === 1 &&
        bare.out.includes('t/w: writes docs/verify/9/x.json inside docs/verify but does not need rewrites-evidence') &&
        marked.code === 0 &&
        elsewhere.code === 0
      );
    },
  ],
  [
    'the registry gate checks script paths, recipes, statuses and needs',
    () => {
      const runs = [
        [gateRegistry({ gone: { ...STUB, script: `${GATE_DIR}drive-gone.mjs` } }), 't/gone: script .claude/skills/verify-pacman/scripts/drive-gone.mjs does not exist'],
        [gateRegistry({}, { 'setup-gone-seed.mjs': { kind: 'seed', purpose: 'x' } }), 'support setup-gone-seed.mjs: no such file in scripts/'],
        [{ ...gateRegistry(), features: { t: { ...gateRegistry().features.t, recipe: 'features/none.md' } } }, 't: recipe features/none.md does not exist'],
        [gateRegistry({ s: { ...STUB, script: `${GATE_DIR}drive-hotkeys.mjs`, status: 'current-ish' } }), 't/s: status current-ish is not current, stale or host-bound'],
        [gateRegistry({ n: { ...STUB, script: `${GATE_DIR}drive-hotkeys.mjs`, needs: ['rewrite-evidence'] } }), 't/n: unknown need rewrite-evidence'],
      ].map(([registry, message]) => [runGate(registry, GATE_SCRIPTS, GATE_MAPS), message]);
      const wrong = runs.filter(([r, message]) => r.code !== 1 || !r.out.includes(message));
      for (const [r, message] of wrong) console.log(`      want "${message}", got exit ${r.code}: ${r.out.trim().split('\n')[0]}`);
      return wrong.length === 0;
    },
  ],
  [
    'the registry gate: drive lines in feature maps name registered cases, and each mapped feature has one',
    () => {
      const line = (text) => ({ 't.md': `${GATE_MAPS['t.md']}- \`${text}\`\n` });
      const nope = runGate(gateRegistry(), GATE_SCRIPTS, line('vp.mjs drive t nope'));
      const other = runGate(gateRegistry(), GATE_SCRIPTS, line('vp.mjs drive other x'));
      const none = runGate(gateRegistry(), GATE_SCRIPTS, { 't.md': '# t\n\nno drive line here\n' });
      // A feature named alone, a placeholder and a flag after the feature are not case names.
      const fine = runGate(gateRegistry(), GATE_SCRIPTS, {
        't.md': `${GATE_MAPS['t.md']}- \`vp.mjs drive t\`, \`vp.mjs drive <feature> [case]\`, \`vp.mjs drive t --dry-run\`\n`,
      });
      return (
        nope.code === 1 &&
        nope.out.includes('features/t.md: vp.mjs drive t nope names no registered case') &&
        other.code === 1 &&
        other.out.includes('features/t.md: vp.mjs drive other x names no registered case') &&
        none.code === 1 &&
        none.out.includes('features/t.md: names no vp.mjs drive t line') &&
        fine.code === 0
      );
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
