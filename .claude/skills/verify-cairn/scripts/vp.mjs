#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { chromium } from '@playwright/test';
import { isRecordingPath, RECORDING_MAX_BYTES } from '../../../../packages/shared/src/records/recording-trigger.ts';

const SKILL_DIR = fileURLToPath(new URL('..', import.meta.url));
const SCRIPTS_DIR = join(SKILL_DIR, 'scripts');
const SCRIPT_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

for (const key of ['VERIFY_REPO_ROOT', 'VERIFY_RUN_DIR', 'VERIFY_EVIDENCE_DIR']) {
  if (process.env[key]) process.env[key] = resolve(process.env[key]);
  else delete process.env[key];
}
for (const key of ['VERIFY_PORT', 'VERIFY_WEB_PORT']) if (!process.env[key]) delete process.env[key];
const ROOT = process.env.VERIFY_REPO_ROOT ?? SCRIPT_ROOT;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(ROOT, '.claude', 'verify-run');
const MAIN_ROOT = mainCheckout(SCRIPT_ROOT);

const EVIDENCE_ROOT = join(MAIN_ROOT, '.claude', 'verify-evidence');

const DRIVES_FILE = join(RUN_DIR, 'vp-drives.txt');

const FORCE_NEEDS = {
  'real-llm': 'spends model tokens',
  github: 'calls GitHub',
  'rewrites-evidence': 'rewrites committed docs/verify evidence in place',
};
const REGISTRY_FILE = join(SKILL_DIR, 'vp-registry.json');
const TICKET_RE = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg)$/i;

const USAGE = `verify-cairn: node .claude/skills/verify-cairn/scripts/vp.mjs <command>

  launch                         start the isolated stack (scripts/launch.mjs)
  doctor                         read-only health check of the stack (scripts/doctor.mjs)
  list [feature]                 registered features and their cases
  drive <feature> [case] [--force] [--dry-run] [-- <args>]
                                 run a registered case; cases that need the stack run doctor first;
                                 stale and host-bound cases, and cases that need real-llm, github or
                                 rewrites-evidence, need --force (the refusal lists every reason, and
                                 --force prints the same list before it runs); so does a fresh-stack
                                 case once anything was driven on the stack since launch (start a new
                                 one: vp.mjs cleanup, then vp.mjs launch); an own-stack case starts
                                 its own stack and is refused while one is up in VERIFY_RUN_DIR
                                 (vp.mjs cleanup first); a case whose usage
                                 names required arguments needs one; arguments after -- replace the
                                 defaults they name (same option before '=', same probe name), the
                                 rest stay; a case that needs the
                                 stack gets VERIFY_PORT / VERIFY_WEB_PORT from the stack's ports.json;
                                 without VERIFY_EVIDENCE_DIR the case writes to a new
                                 .claude/verify-evidence/<time>-<feature>-<case>/ in the main checkout,
                                 created once doctor passes (a probe with its own output option gets
                                 the directory through it, or uses the one given after --; a probe
                                 that writes fixed evidence is named instead); an evidence directory
                                 inside docs/verify (VERIFY_EVIDENCE_DIR, or the output option's
                                 directory) is refused before anything runs, also with --dry-run;
                                 --dry-run prints what would run
  capture <path> [--name <label>] [--wait <ms>] [--video]
                                 screenshot a live route, record console errors and failed requests
                                 --video records navigation and the wait interval as WebM (max 5 MiB)
                                 (exit 0 when the page loaded; errors are recorded, not judged;
                                 with VERIFY_EVIDENCE_DIR set it writes into a new capture-<label>/,
                                 refused when that directory is inside docs/verify)
  archive <ticket> [--from <dir>]... [--latest <n>]
                                 copy evidence into docs/verify/<ticket>/<dir>/ (never overwrites);
                                 the source is --from, else VERIFY_EVIDENCE_DIR, else --latest <n>
                                 (newest runs in the shared evidence root, other lanes' included);
                                 --latest with either of the others is refused
  links <ticket> [--sha <sha>]   raw.githubusercontent.com links for docs/verify/<ticket>/ at a pushed SHA
  cleanup                        stop the stack (scripts/cleanup.mjs)

Feature recipes: .claude/skills/verify-cairn/features/<feature>.md
Registry: .claude/skills/verify-cairn/vp-registry.json`;

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

function firstLine(err) {
  return String(err.message ?? err).split('\n')[0];
}

function readStack() {
  const file = join(RUN_DIR, 'ports.json');
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fail(`vp: ${file} is not valid JSON; run vp.mjs cleanup, then vp.mjs launch`, 1);
  }
}

function mainCheckout(dir) {
  try {
    const common = execFileSync('git', ['-C', dir, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return common.endsWith('/.git') ? dirname(common) : dir;
  } catch {
    return dir;
  }
}

function physical(path) {
  const rest = [];
  let head = resolve(path);
  while (!existsSync(head) && dirname(head) !== head) {
    rest.unshift(basename(head));
    head = dirname(head);
  }
  try {
    head = realpathSync(head);
  } catch {}
  return join(head, ...rest);
}

function worktrees(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'worktree', 'list', '--porcelain'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .filter((line) => line.startsWith('worktree '))
      .map((line) => line.slice('worktree '.length));
  } catch {
    return [];
  }
}

let committedEvidence;
function committedRoots() {
  committedEvidence ??= [
    ...new Set(
      [ROOT, SCRIPT_ROOT, MAIN_ROOT, ...[...new Set([process.cwd(), ROOT, SCRIPT_ROOT])].flatMap(worktrees)].map((r) =>
        physical(join(r, 'docs', 'verify')),
      ),
    ),
  ];
  return committedEvidence;
}

function refuseCommitted(dir, what) {
  const path = physical(dir);
  const root = committedRoots().find((r) => path === r || path.startsWith(`${r}${sep}`));
  if (root === undefined) return;
  fail(
    `${what} is inside ${root}: committed evidence, add-only (ADR 0015).\n` +
      'Let vp.mjs write to a new directory under .claude/verify-evidence (leave VERIFY_EVIDENCE_DIR unset), ' +
      'then copy it in with vp.mjs archive <ticket> --from <dir>.',
  );
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function localStamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function freshDir(base) {
  mkdirSync(dirname(base), { recursive: true });
  for (let n = 1; ; n += 1) {
    const dir = n === 1 ? base : `${base}-${n}`;
    try {
      mkdirSync(dir);
      return dir;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
}

function takeFlag(argv, name) {
  const at = argv.indexOf(name);
  if (at === -1) return false;
  argv.splice(at, 1);
  return true;
}

function takeOption(argv, name) {
  const values = [];
  for (let at = argv.indexOf(name); at !== -1; at = argv.indexOf(name)) {
    if (at + 1 >= argv.length) fail(`${name} needs a value`);
    values.push(argv[at + 1]);
    argv.splice(at, 2);
  }
  return values;
}

function runNode(script, args, cwd = undefined) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd, stdio: 'inherit', env: process.env });
  if (result.error) fail(`could not run ${script}: ${result.error.message}`, 1);
  return result.status ?? 1;
}

function loadRegistry() {
  if (!existsSync(REGISTRY_FILE)) fail(`registry missing: ${REGISTRY_FILE}`, 1);
  return JSON.parse(readFileSync(REGISTRY_FILE, 'utf8'));
}

function listCommand(argv) {
  const { features } = loadRegistry();
  const wanted = argv[0];
  if (wanted !== undefined && !Object.hasOwn(features, wanted)) fail(`unknown feature: ${wanted}\nfeatures: ${Object.keys(features).join(', ')}`);
  for (const [feature, entry] of Object.entries(features)) {
    if (wanted !== undefined && feature !== wanted) continue;
    console.log(`${feature}${entry.recipe ? `  (${entry.recipe})` : ''}`);
    for (const [name, c] of Object.entries(entry.cases)) {
      const flags = [c.needs.join('+'), c.status === 'current' ? '' : c.status].filter(Boolean).join(', ');
      console.log(`  ${name.padEnd(28)} ${flags.padEnd(28)} ${c.purpose}`);
      if (c.usage) console.log(`  ${''.padEnd(28)} ${''.padEnd(28)} usage: ${c.usage}`);
    }
  }
  return 0;
}

function driveCommand(argv) {
  const dashDash = argv.indexOf('--');
  const extra = dashDash === -1 ? [] : argv.splice(dashDash).slice(1);
  const force = takeFlag(argv, '--force');
  const dryRun = takeFlag(argv, '--dry-run');
  const [feature, caseName, ...stray] = argv;
  if (stray.length > 0) fail(`unexpected argument(s) ${stray.join(' ')}: script arguments go after --`);
  if (process.env.VERIFY_EVIDENCE_DIR) refuseCommitted(process.env.VERIFY_EVIDENCE_DIR, `VERIFY_EVIDENCE_DIR=${process.env.VERIFY_EVIDENCE_DIR}`);
  const { features } = loadRegistry();
  if (feature === undefined) fail(`usage: vp.mjs drive <feature> [case]\nfeatures: ${Object.keys(features).join(', ')}`);
  if (!Object.hasOwn(features, feature)) fail(`unknown feature: ${feature}\nfeatures: ${Object.keys(features).join(', ')}`);
  const entry = features[feature];
  const names = Object.keys(entry.cases);
  let name = caseName;
  if (name === undefined) {
    if (names.length !== 1) fail(`feature ${feature} has ${names.length} cases, name one: ${names.join(', ')}`);
    name = names[0];
  }
  if (!Object.hasOwn(entry.cases, name)) fail(`unknown case ${feature}/${name}; cases: ${names.join(', ')}`);
  const c = entry.cases[name];

  const script = resolve(SCRIPT_ROOT, c.script);
  if (!existsSync(script)) fail(`registered script is missing: ${c.script}`, 1);
  if (c.runner === 'tsx' && c.cwd === undefined) fail(`${feature}/${name} has runner tsx but no cwd in the registry`, 1);

  const up = c.needs.includes('own-stack') ? readStack() : undefined;
  if (up !== undefined) {
    fail(
      `${feature}/${name} starts and stops its own stack in ${RUN_DIR}, where a stack is up ` +
        `(server ${up.serverPort}, web ${up.webPort}); stop it with vp.mjs cleanup first.`,
    );
  }

  const reasons = [];
  if (c.status !== 'current') reasons.push(`is ${c.status}${c.note ? `: ${c.note.replace(/\.+$/, '')}` : ''}`);
  for (const need of c.needs) if (need in FORCE_NEEDS) reasons.push(`needs ${need} (${FORCE_NEEDS[need]})`);
  const driven = c.needs.includes('fresh-stack') && existsSync(DRIVES_FILE) ? readFileSync(DRIVES_FILE, 'utf8').split('\n').filter(Boolean) : [];
  if (driven.length > 0) {
    reasons.push(
      `needs fresh-stack, and the stack in ${RUN_DIR} was driven since launch (${driven.join(', ')}); ` +
        'start a new one with vp.mjs cleanup, then vp.mjs launch',
    );
  }
  const forceList = reasons.map((r) => `\n  - ${r}`).join('');
  if (reasons.length > 0 && !force) {
    fail(`${feature}/${name} runs only with --force:${forceList}\nRe-run with --force to drive it anyway; --force covers every line above.`);
  }

  if (c.needsArgs && !extra.some((a) => !a.startsWith('-'))) {
    fail(`${feature}/${name} needs arguments: ${c.usage}. Pass them after --.`);
  }
  if (c.usage && extra.length === 0) console.log(`vp: ${feature}/${name} usage: ${c.usage}`);

  const evidence = c.evidence ?? {};
  const outAt = evidence.flag === undefined ? -1 : extra.indexOf(evidence.flag);
  if (
    evidence.flag !== undefined &&
    (extra.some((a) => a.startsWith(`${evidence.flag}=`)) || (outAt !== -1 && extra[outAt + 1] === undefined))
  ) {
    fail(`${evidence.flag} takes its directory as the next argument: -- ${evidence.flag} <dir>`);
  }

  const keyOf = (a) => a.split('=')[0];
  const replaced = new Set(extra.filter((_, i) => outAt === -1 || i !== outAt + 1).map(keyOf));
  const args = [...c.args.filter((a) => !replaced.has(keyOf(a))), ...extra];
  const cwd = resolve(SCRIPT_ROOT, c.cwd ?? '.');
  const doctorFirst = c.needs.includes('stack');

  process.env.VERIFY_RUN_DIR = RUN_DIR;

  const stack = doctorFirst ? readStack() : undefined;
  if (stack !== undefined) {
    for (const [key, port] of [
      ['VERIFY_PORT', stack.serverPort],
      ['VERIFY_WEB_PORT', stack.webPort],
    ]) {
      if (port === undefined) continue;
      if (process.env[key] !== undefined && process.env[key] !== String(port)) {
        fail(`${key}=${process.env[key]}, but the stack in ${RUN_DIR} runs on ${port}; unset ${key} or point VERIFY_RUN_DIR at that stack.`);
      }
      process.env[key] = String(port);
    }
  }

  const flagAt = args.indexOf(evidence.flag);

  if (flagAt !== -1 && args[flagAt + 1] !== undefined) args[flagAt + 1] = resolve(args[flagAt + 1]);
  const given = flagAt === -1 ? undefined : args[flagAt + 1];
  if (given !== undefined) refuseCommitted(given, `${evidence.flag} ${given}`);
  const envName = evidence.env ?? 'VERIFY_EVIDENCE_DIR';
  const named = process.env.VERIFY_EVIDENCE_DIR;
  const planned =
    given !== undefined || evidence.writes !== undefined
      ? undefined
      : (named ?? join(EVIDENCE_ROOT, `${localStamp()}-${feature}-${name}`));

  const withEvidence = (dir) => (evidence.flag === undefined || dir === undefined ? args : [...args, evidence.flag, dir]);

  if (reasons.length > 0) console.log(`vp: --force drives ${feature}/${name}:${forceList}`);
  if (dryRun) {
    console.log(`vp: dry-run ${feature}/${name}${doctorFirst ? ' (doctor first)' : ''}`);
    console.log(`    runner ${c.runner ?? 'node'}  cwd ${cwd}`);
    console.log(`    script ${c.script}  args ${withEvidence(planned).join(' ')}`.trimEnd());
    if (evidence.writes !== undefined) console.log(`    writes its evidence itself: ${evidence.writes}`);
    if (given !== undefined) console.log(`    evidence ${given} (given with ${evidence.flag})`);
    if (planned !== undefined) console.log(`    ${envName}=${planned}`);
    for (const key of ['VERIFY_PORT', 'VERIFY_WEB_PORT']) {
      if (stack !== undefined && process.env[key]) console.log(`    ${key}=${process.env[key]}`);
    }
    console.log(`    VERIFY_RUN_DIR=${process.env.VERIFY_RUN_DIR ?? ''}`);
    return 0;
  }
  if (doctorFirst) {
    console.log(`vp: ${feature}/${name} needs the stack, running doctor first`);
    if (runNode(join(SCRIPTS_DIR, 'doctor.mjs'), []) !== 0) {
      fail('vp: doctor failed. Start the stack with `vp.mjs launch` (or fix what doctor reported) and retry.', 1);
    }

    appendFileSync(DRIVES_FILE, `${feature}/${name}\n`);
  }

  let run = args;
  if (evidence.writes !== undefined) {
    console.log(`vp: ${feature}/${name} writes its evidence itself: ${evidence.writes}`);
  } else if (given !== undefined) {
    console.log(`vp: evidence ${given}`);
  } else {
    if (named !== undefined) mkdirSync(named, { recursive: true });
    const dir = named ?? freshDir(planned);
    process.env[envName] = dir;
    run = withEvidence(dir);
    console.log(`vp: evidence ${dir}`);
  }

  const runner = c.runner === 'tsx' ? `(cd ${c.cwd} && pnpm exec tsx)` : 'node';
  console.log(`vp: ${feature}/${name} -> ${runner} ${c.script} ${run.join(' ')}`.trimEnd());
  if (c.runner !== 'tsx') return runNode(script, run, cwd);
  const result = spawnSync('pnpm', ['exec', 'tsx', script, ...run], {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) fail(`could not run ${c.script}: ${result.error.message}`, 1);
  return result.status ?? 1;
}

async function captureCommand(argv) {
  const videoRequested = takeFlag(argv, '--video');
  const label = takeOption(argv, '--name')[0] ?? 'page';
  const waitText = takeOption(argv, '--wait')[0] ?? '1500';
  if (!/^[0-9]+$/.test(waitText)) fail('--wait needs a whole number of milliseconds');
  const waitMs = Number(waitText);
  const path = argv[0];
  if (path === undefined || !path.startsWith('/')) fail('usage: vp.mjs capture </app/route> [--name <label>] [--wait <ms>]');
  if (!/^[A-Za-z0-9-]+$/.test(label)) fail('--name must be letters, digits and dashes');
  if (process.env.VERIFY_EVIDENCE_DIR) refuseCommitted(process.env.VERIFY_EVIDENCE_DIR, `VERIFY_EVIDENCE_DIR=${process.env.VERIFY_EVIDENCE_DIR}`);
  const stack = readStack();
  if (stack === undefined) fail('vp: no stack coordinates, run `vp.mjs launch` first', 1);
  const { webPort } = stack;
  const url = `http://127.0.0.1:${webPort}${path}`;

  const envDir = process.env.VERIFY_EVIDENCE_DIR;
  const dir = freshDir(envDir ? join(envDir, `capture-${label}`) : join(EVIDENCE_ROOT, `${localStamp()}-capture-${label}`));

  const consoleErrors = [];
  const failedRequests = [];
  let navigation = 'ok';
  let screenshot = `${label}.png`;
  let title = '';

  let browser;
  let context;
  let recording = null;
  try {
    browser = await chromium.launch();
    context = await browser.newContext({
      viewport: { width: 1440, height: 732 }, colorScheme: 'dark',
      ...(videoRequested ? { recordVideo: { dir, size: { width: 1440, height: 732 } } } : {}),
    });
    const page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('requestfailed', (req) => failedRequests.push({ url: req.url(), error: req.failure()?.errorText ?? 'failed' }));
    page.on('response', (res) => {
      if (res.status() >= 400) failedRequests.push({ url: res.url(), status: res.status() });
    });
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
      await page.waitForTimeout(waitMs);
    } catch (err) {
      navigation = firstLine(err);
    }
    await page.screenshot({ path: join(dir, screenshot) });
    title = await page.title().catch(() => '');
    const video = page.video();
    await context.close();
    if (videoRequested) {
      if (video === null) throw new Error('recording was not created');
      const videoPath = await video.path();
      const size = statSync(videoPath).size;
      if (size === 0 || size > RECORDING_MAX_BYTES) {
        unlinkSync(videoPath);
        throw new Error('recording must be nonempty and at most 5 MiB; reduce --wait');
      }
      recording = `${label}.webm`;
      renameSync(videoPath, join(dir, recording));
    }
  } catch (err) {

    if (navigation === 'ok') navigation = firstLine(err);
    screenshot = null;
  } finally {
    await context?.close();
    await browser?.close();
  }

  const result = { url, title, navigation, screenshot, ...(videoRequested ? { recording } : {}), consoleErrors, failedRequests };
  writeFileSync(join(dir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`vp: captured ${url}`);
  console.log(`    navigation ${navigation}, ${consoleErrors.length} console error(s), ${failedRequests.length} failed request(s)`);
  console.log(`    evidence ${dir}`);
  return navigation === 'ok' ? 0 : 1;
}

function newestEvidenceDirs(count) {
  if (!existsSync(EVIDENCE_ROOT)) fail(`no evidence yet: ${EVIDENCE_ROOT} does not exist`, 1);

  const runs = [];
  for (const name of readdirSync(EVIDENCE_ROOT)) {
    const path = join(EVIDENCE_ROOT, name);
    try {
      const st = statSync(path);
      if (st.isDirectory()) runs.push({ path, mtime: st.mtimeMs });
    } catch {}
  }
  return runs
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, count)
    .map((run) => run.path);
}

function archiveCommand(argv) {
  const from = takeOption(argv, '--from').map((p) => resolve(p));
  const latestOption = takeOption(argv, '--latest')[0];
  const [ticket, ...stray] = argv;
  const usage = 'usage: vp.mjs archive <ticket> [--from <dir>]... | VERIFY_EVIDENCE_DIR=<dir> | --latest <n>';
  if (ticket === undefined || !TICKET_RE.test(ticket)) fail(usage);
  if (stray.length > 0) fail(`unexpected argument(s) ${stray.join(' ')}: name a source with --from <dir>\n${usage}`);
  if (latestOption !== undefined && !/^[1-9][0-9]*$/.test(latestOption)) fail(`--latest needs a positive integer\n${usage}`);
  const envDir = process.env.VERIFY_EVIDENCE_DIR;
  if (latestOption !== undefined && (from.length > 0 || envDir)) {
    fail(`--latest cannot be combined with --from or VERIFY_EVIDENCE_DIR; name one source\n${usage}`);
  }

  if (from.length === 0 && !envDir && latestOption === undefined) {
    fail(`${usage}\nname the source: --from <dir>, VERIFY_EVIDENCE_DIR, or --latest <n> (other lanes' runs included)`);
  }
  const sources =
    from.length > 0 ? from : envDir ? [envDir] : newestEvidenceDirs(Number(latestOption));
  if (sources.length === 0) fail('nothing to archive', 1);
  const target = join(ROOT, 'docs', 'verify', ticket);
  const plans = sources.map((src) => {
    if (!existsSync(src) || !statSync(src).isDirectory()) fail(`not an evidence directory: ${src}`, 1);
    const pending = [src];
    for (const directory of pending) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) pending.push(path);
        else if (isRecordingPath(entry.name)) {
          const size = statSync(path).size;
          if (size === 0 || size > RECORDING_MAX_BYTES) fail(`recording must be nonempty and at most 5 MiB: ${path}`, 1);
        }
      }
    }
    const dest = join(target, basename(src));
    if (existsSync(dest)) fail(`refusing to overwrite ${dest}: docs/verify is add-only (ADR 0015)`, 1);
    return { src, dest };
  });
  const names = plans.map((p) => basename(p.dest));
  const twice = names.find((n, i) => names.indexOf(n) !== i);
  if (twice !== undefined) fail(`two sources share the directory name ${twice}; archive them in separate runs`, 1);
  for (const { src, dest } of plans) {

    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest, { recursive: true, errorOnExist: true, force: false });
    console.log(`vp: ${src} -> ${dest}`);
  }
  console.log(`next: git add docs/verify/${ticket} && git commit, push, then vp.mjs links ${ticket}`);
  return 0;
}

function git(args) {
  return execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }).trim();
}

function repoSlug() {
  const url = git(['remote', 'get-url', 'origin']);
  const m = url.match(/github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?$/) ?? url.match(/\/git\/([^/]+\/[^/.]+?)(?:\.git)?$/);
  return m ? m[1] : 'xiechimon/cairn';
}

function linksCommand(argv) {
  const shaOption = takeOption(argv, '--sha')[0];
  const ticket = argv[0];
  if (ticket === undefined || !TICKET_RE.test(ticket)) fail('usage: vp.mjs links <ticket> [--sha <sha>]');
  const sha = git(['rev-parse', shaOption ?? 'HEAD']);
  const onRemote = git(['branch', '-r', '--contains', sha]);
  if (onRemote === '') console.warn(`vp: ${sha} is not on any remote branch yet; push before using these links`);

  const files = git(['ls-tree', '-r', '-z', '--name-only', sha, '--', `docs/verify/${ticket}`]).split('\0').filter(Boolean);
  if (files.length === 0) fail(`no files under docs/verify/${ticket} at ${sha}; archive, commit and push first`, 1);
  const slug = repoSlug();
  for (const file of files) {
    const url = `https://raw.githubusercontent.com/${slug}/${sha}/${file.split('/').map(encodeURIComponent).join('/')}`;
    const label = file.slice(`docs/verify/${ticket}/`.length);
    console.log(IMAGE_RE.test(file) ? `![${label}](${url})` : `[${label}](${url})`);
  }
  return 0;
}

const argv = process.argv.slice(2);
const command = argv.shift();
let code;
switch (command) {
  case 'launch':
    code = runNode(join(SCRIPTS_DIR, 'launch.mjs'), argv);
    break;
  case 'doctor':
    code = runNode(join(SCRIPTS_DIR, 'doctor.mjs'), argv);
    break;
  case 'cleanup':

    process.env.VERIFY_EVIDENCE_DIR ??= EVIDENCE_ROOT;
    code = runNode(join(SCRIPTS_DIR, 'cleanup.mjs'), argv);
    break;
  case 'list':
    code = listCommand(argv);
    break;
  case 'drive':
    code = driveCommand(argv);
    break;
  case 'capture':
    code = await captureCommand(argv);
    break;
  case 'archive':
    code = archiveCommand(argv);
    break;
  case 'links':
    code = linksCommand(argv);
    break;
  case undefined:
  case 'help':
  case '--help':
  case '-h':
    console.log(USAGE);
    code = command === undefined ? 2 : 0;
    break;
  default:
    fail(`unknown command: ${command}\n\n${USAGE}`);
}
process.exit(code);
