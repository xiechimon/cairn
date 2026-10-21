#!/usr/bin/env node
// vp.mjs self-test (#1402): the dispatch and archive rules, checked without a
// stack. drive cases use --dry-run, which prints the resolved command and the
// evidence/run paths instead of running anything. archive cases use a
// throwaway VERIFY_REPO_ROOT. Cases that must really run use a copy of vp.mjs
// in a throwaway skill directory with its own registry and a stub probe.
// Failure modes from pr-gate runs 2, 3 and 4 and /code-review on #1411.
// Usage: node .claude/skills/verify-pacman/scripts/vp-selftest.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const VP = resolve(import.meta.dirname, 'vp.mjs');
const ROOT = resolve(import.meta.dirname, '../../../..');
const REGISTRY = JSON.parse(readFileSync(resolve(import.meta.dirname, '../vp-registry.json'), 'utf8'));
// Where drive puts evidence by default: the main checkout of this repository,
// also when vp.mjs runs from a worktree (#345: a worktree's evidence goes with it).
const COMMON_DIR = execFileSync('git', ['-C', ROOT, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
  encoding: 'utf8',
}).trim();
const MAIN_ROOT = COMMON_DIR.endsWith('/.git') ? dirname(COMMON_DIR) : ROOT;

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

// A copy of vp.mjs in a throwaway skill directory: its own registry, a stub
// probe that writes result.json where it is pointed, and the repo's
// node_modules (vp.mjs imports @playwright/test). Outside any git repository,
// so its evidence root is the throwaway directory itself.
function fakeSkill(cases, scripts = {}) {
  const root = mkdtempSync(join(tmpdir(), 'vp-fake-'));
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
  const evidenceRoot = join(root, '.claude', 'verify-evidence');
  return {
    root,
    evidenceRoot,
    run: (args, env = {}) => vp(args, env, root, join(skill, 'scripts', 'vp.mjs')),
    evidence: () => (existsSync(evidenceRoot) ? readdirSync(evidenceRoot) : []),
    done: () => rmSync(root, { recursive: true, force: true }),
  };
}

const STUB = { script: 'stub.mjs', args: [], needs: [], status: 'current', purpose: 'stub' };

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
          // Each call that sends a body to .../agents (the helpers default to POST,
          // pr-gate run 4), judged by its own body: a probe that names machineId
          // anywhere else in the file still 400s (/code-review on #1411).
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
    () => {
      const r = vp(['drive', 'glass-journeys', 'create-task', '--dry-run']);
      const own = vp(['drive', 'glass-journeys', 'create-task', '--dry-run', '--', 'create-task', '--out', '/tmp/x']);
      const dir = r.out.match(/VERIFY_EVIDENCE_DIR=(\S+)/)?.[1] ?? 'missing';
      const ownArgs = own.out.match(/ args (.*)\n/)?.[1] ?? '';
      return r.code === 0 && r.out.includes(`--out ${dir}`) && own.code === 0 && ownArgs === 'create-task --out /tmp/x';
    },
  ],
  [
    'arguments after -- keep the case\'s own positional args (the probe or journey name)',
    () => {
      // Giving the name again after -- does not run it twice (covered by the output-flag case).
      const r = vp(['drive', 'glass-journeys', 'create-task', '--dry-run', '--', '--out', '/tmp/x']);
      return r.code === 0 && /args create-task --out \/tmp\/x\n/.test(r.out);
    },
  ],
  [
    'an output option given after -- is the evidence directory; drive makes none of its own',
    () => {
      const dry = vp(['drive', 'glass-journeys', 'create-task', '--dry-run', '--', '--out', '/tmp/x']);
      const fake = fakeSkill({ out: { ...STUB, evidence: { flag: '--out' } } });
      const mine = join(fake.root, 'mine');
      const r = fake.run(['drive', 't', 'out', '--', '--out', mine]);
      const made = fake.evidence();
      // Without the option after --, the probe gets drive's own directory through it.
      const auto = fake.run(['drive', 't', 'out']);
      const autoDir = auto.out.match(/vp: evidence (\S+)/)?.[1] ?? '';
      const argv = existsSync(join(autoDir, 'result.json'))
        ? JSON.parse(readFileSync(join(autoDir, 'result.json'), 'utf8')).argv.join(' ')
        : '';
      fake.done();
      return (
        dry.code === 0 &&
        !dry.out.includes('VERIFY_EVIDENCE_DIR=') &&
        r.code === 0 &&
        r.out.includes(`vp: evidence ${mine}`) &&
        made.length === 0 &&
        auto.code === 0 &&
        argv === `--out ${autoDir}`
      );
    },
  ],
  [
    'a probe that reads another variable gets the evidence directory through it',
    () => {
      const r = vp(['drive', 'skills-injection', 'injection-check', '--force', '--dry-run']);
      return r.code === 0 && /^ +EVIDENCE_DIR=\/\S+-skills-injection-injection-check$/m.test(r.out);
    },
  ],
  [
    'a case whose usage names required arguments refuses to run without them',
    () => {
      const bare = vp(['drive', 'failed-send', 'restart-with-feedback', '--dry-run']);
      const given = vp(['drive', 'failed-send', 'restart-with-feedback', '--dry-run', '--', 't1', 'b1']);
      return bare.code === 2 && /needs arguments/.test(bare.out) && given.code === 0;
    },
  ],
  [
    'a registry entry with a missing script or a tsx case without cwd fails before doctor, also in --dry-run',
    () => {
      const fake = fakeSkill({
        missing: { ...STUB, script: 'nope.mjs', needs: ['stack'] },
        nocwd: { ...STUB, runner: 'tsx', needs: ['stack'] },
      });
      const run = join(fake.root, 'run');
      const a = fake.run(['drive', 't', 'missing'], { VERIFY_RUN_DIR: run });
      const b = fake.run(['drive', 't', 'missing', '--dry-run'], { VERIFY_RUN_DIR: run });
      const c = fake.run(['drive', 't', 'nocwd', '--dry-run'], { VERIFY_RUN_DIR: run });
      const made = fake.evidence();
      fake.done();
      return (
        a.code === 1 &&
        /registered script is missing/.test(a.out) &&
        !/doctor/.test(a.out) &&
        b.code === 1 &&
        c.code === 1 &&
        /no cwd/.test(c.out) &&
        made.length === 0
      );
    },
  ],
  [
    'feature and case names are looked up as registry keys only',
    () => {
      const a = vp(['drive', 'toString', '--dry-run']);
      const b = vp(['list', 'constructor']);
      const c = vp(['drive', 'search', 'constructor', '--dry-run']);
      return a.code === 2 && /unknown feature/.test(a.out) && b.code === 2 && c.code === 2 && /unknown case/.test(c.out);
    },
  ],
  [
    'a case that needs the stack gets the ports of the stack doctor checks',
    () => {
      const run = mkdtempSync(join(tmpdir(), 'vp-selftest-run-'));
      writeFileSync(join(run, 'ports.json'), JSON.stringify({ serverPort: 8792, webPort: 5274 }));
      const r = vp(['drive', 'search', 'search', '--dry-run'], { VERIFY_RUN_DIR: run });
      const clash = vp(['drive', 'search', 'search', '--dry-run'], { VERIFY_RUN_DIR: run, VERIFY_PORT: '8791' });
      rmSync(run, { recursive: true, force: true });
      return (
        r.code === 0 &&
        r.out.includes('VERIFY_PORT=8792') &&
        r.out.includes('VERIFY_WEB_PORT=5274') &&
        clash.code === 2 &&
        /8791/.test(clash.out) &&
        /8792/.test(clash.out)
      );
    },
  ],
  [
    'a drive never writes into an evidence directory that already exists',
    () => {
      const fake = fakeSkill({ ok: STUB });
      const now = Date.now();
      const taken = [0, 1, 2, 3].map((s) => join(fake.evidenceRoot, `${localStamp(now + s * 1000)}-t-ok`));
      for (const dir of taken) mkdirSync(dir, { recursive: true });
      const r = fake.run(['drive', 't', 'ok']);
      const printed = r.out.match(/vp: evidence (\S+)/)?.[1] ?? '';
      const untouched = taken.every((dir) => readdirSync(dir).length === 0);
      const wrote = printed !== '' && existsSync(join(printed, 'result.json'));
      fake.done();
      return r.code === 0 && !taken.includes(printed) && untouched && wrote;
    },
  ],
  [
    'capture never writes into a capture directory that already exists',
    () => {
      const run = mkdtempSync(join(tmpdir(), 'vp-selftest-run-'));
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
    'links encodes non-ASCII file names instead of quoting them',
    () => {
      const repo = mkdtempSync(join(tmpdir(), 'vp-selftest-git-'));
      // The caller's git config may sign commits or run hooks; this repo does neither.
      const g = (...args) =>
        execFileSync(
          'git',
          ['-C', repo, '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
          { encoding: 'utf8' },
        );
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
    () => {
      const keep = vp(['drive', 'review-modal', 'empty-review', '--dry-run', '--', '--focus=hunkless']);
      const swap = vp(['drive', 'review-modal', 'empty-review', '--dry-run', '--', '--expect=before']);
      return (
        /args --expect=after --focus=hunkless\n/.test(keep.out) && /args --expect=before\n/.test(swap.out)
      );
    },
  ],
  [
    'a probe gets the run directory doctor checked',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'vp-selftest-root-'));
      const r = vp(['drive', 'search', 'search', '--dry-run'], { VERIFY_REPO_ROOT: root });
      rmSync(root, { recursive: true, force: true });
      return r.code === 0 && r.out.includes(`VERIFY_RUN_DIR=${join(root, '.claude', 'verify-run')}\n`);
    },
  ],
  [
    'no current case depends on a seed script that creates an agent without machineId',
    () => {
      const broken = Object.entries(REGISTRY.support)
        .filter(([, v]) => v.kind === 'seed')
        .map(([name]) => name)
        .filter((name) => agentBodiesWithoutMachineId(readFileSync(join(import.meta.dirname, name), 'utf8')).length > 0);
      const dependent = [];
      for (const [feature, entry] of Object.entries(REGISTRY.features)) {
        for (const [name, c] of Object.entries(entry.cases)) {
          if (c.status !== 'current' || /optional/.test(c.usage ?? '')) continue;
          const src = readFileSync(resolve(ROOT, c.script), 'utf8');
          const uses = broken.filter((seed) => src.includes(seed) || (c.usage ?? '').includes(seed));
          if (uses.length > 0) dependent.push(`${feature}/${name} (${uses.join(', ')})`);
        }
      }
      if (dependent.length > 0) console.log(`      dependent: ${dependent.join(', ')}`);
      return dependent.length === 0;
    },
  ],
  [
    'cleanup reports the evidence root drive writes to',
    () => {
      const fake = fakeSkill({}, { 'cleanup.mjs': 'console.log(`evidence-root ${process.env.VERIFY_EVIDENCE_DIR}`);\n' });
      const r = fake.run(['cleanup']);
      fake.done();
      return r.code === 0 && r.out.includes(`evidence-root ${fake.evidenceRoot}\n`);
    },
  ],
  [
    'a case that needs arguments is not satisfied by options alone',
    () => {
      const r = vp(['drive', 'failed-send', 'restart-with-feedback', '--dry-run', '--', '--expect=old']);
      return r.code === 2 && /needs arguments/.test(r.out);
    },
  ],
  [
    'an output path given after -- is made absolute against the caller\'s directory',
    () => {
      const cwd = mkdtempSync(join(tmpdir(), 'vp-selftest-cwd-'));
      const r = vp(['drive', 'glass-journeys', 'create-task', '--dry-run', '--', '--out', 'rel/ev'], {}, cwd);
      rmSync(cwd, { recursive: true, force: true });
      return r.code === 0 && r.out.includes(`args create-task --out ${join(cwd, 'rel', 'ev')}\n`);
    },
  ],
  [
    'capture refuses a --wait that is not a number of milliseconds',
    () => {
      const run = mkdtempSync(join(tmpdir(), 'vp-selftest-run-'));
      writeFileSync(join(run, 'ports.json'), JSON.stringify({ serverPort: 9, webPort: 9 }));
      const r = vp(['capture', '/app', '--wait', '1s'], { VERIFY_RUN_DIR: run, VERIFY_EVIDENCE_DIR: join(run, 'ev') });
      const made = existsSync(join(run, 'ev'));
      rmSync(run, { recursive: true, force: true });
      return r.code === 2 && /--wait/.test(r.out) && !made;
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
      const r = vp(['drive', 'stop-button', '--force', '--dry-run', '--', 't1']);
      return r.code === 0 && /script \S+drive-/.test(r.out);
    },
  ],
  [
    'a failed doctor leaves no evidence directory behind',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'vp-selftest-'));
      const ev = join(root, 'ev');
      const r = vp(['drive', 'search', 'search'], { VERIFY_RUN_DIR: join(root, 'run'), VERIFY_EVIDENCE_DIR: ev });
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
    'a drive without VERIFY_EVIDENCE_DIR gets its own directory under the main checkout\'s .claude/verify-evidence',
    () => {
      const r = vp(['drive', 'providers-tabs', 'claude-bin-detection', '--dry-run']);
      const prefix = `VERIFY_EVIDENCE_DIR=${resolve(MAIN_ROOT, '.claude/verify-evidence')}/`;
      return r.code === 0 && r.out.includes(prefix) && /-providers-tabs-claude-bin-detection\n/.test(r.out);
    },
  ],
  [
    'a tsx case runs from its package directory, a node case from the repo root',
    () => {
      const tsx = vp(['drive', 'failed-send', 'restart-combo', '--dry-run']);
      const node = vp(['drive', 'search', 'search', '--dry-run'], {}, resolve(ROOT, 'apps'));
      return tsx.out.includes(`cwd ${resolve(ROOT, 'apps/server')}`) && node.out.includes(`cwd ${ROOT}\n`);
    },
  ],
  [
    'a case that needs the stack runs doctor first',
    () => {
      const r = vp(['drive', 'search', 'search', '--dry-run']);
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
