#!/usr/bin/env node
// verify-pacman 单一入口(#1402)。每个会话不再各写各的驱动脚本:功能 → case
// → 脚本的对应关系登记在 ../vp-registry.json,drive 按表分发;launch / doctor /
// cleanup 原样转给既有脚本,行为不变。证据交付拆两步:archive 只拷贝(docs/verify
// 只增不改,ADR 0015),links 在提交推送之后打印钉 SHA 的 raw 链。
// 栈坐标、端口、证据目录沿用既有环境变量:VERIFY_REPO_ROOT / VERIFY_RUN_DIR /
// VERIFY_PORT / VERIFY_WEB_PORT / VERIFY_EVIDENCE_DIR。

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const SKILL_DIR = fileURLToPath(new URL('..', import.meta.url));
const SCRIPTS_DIR = join(SKILL_DIR, 'scripts');
const SCRIPT_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
// Paths from the environment are made absolute against the caller's cwd before
// anything runs: tsx cases run from a package directory, where a relative path
// would point somewhere else than it does for doctor and archive. Empty = unset.
for (const key of ['VERIFY_REPO_ROOT', 'VERIFY_RUN_DIR', 'VERIFY_EVIDENCE_DIR']) {
  if (process.env[key]) process.env[key] = resolve(process.env[key]);
  else delete process.env[key];
}
for (const key of ['VERIFY_PORT', 'VERIFY_WEB_PORT']) if (!process.env[key]) delete process.env[key];
const ROOT = process.env.VERIFY_REPO_ROOT ?? SCRIPT_ROOT;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(ROOT, '.claude', 'verify-run');
// Evidence goes to the main checkout, also when this vp.mjs sits in a worktree:
// a worktree's evidence is deleted with it (#345, SKILL.md Evidence).
const EVIDENCE_ROOT = join(mainCheckout(SCRIPT_ROOT), '.claude', 'verify-evidence');
// Needs that make a case run only when asked with --force, and why.
const FORCE_NEEDS = {
  'real-llm': 'spends model tokens',
  github: 'calls GitHub',
  'rewrites-evidence': 'rewrites committed docs/verify evidence in place',
};
const REGISTRY_FILE = join(SKILL_DIR, 'vp-registry.json');
const TICKET_RE = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg)$/i;

const USAGE = `verify-pacman: node .claude/skills/verify-pacman/scripts/vp.mjs <command>

  launch                         start the isolated stack (scripts/launch.mjs)
  doctor                         read-only health check of the stack (scripts/doctor.mjs)
  list [feature]                 registered features and their cases
  drive <feature> [case] [--force] [--dry-run] [-- <args>]
                                 run a registered case; cases that need the stack run doctor first;
                                 stale and host-bound cases, and cases that need real-llm, github or
                                 rewrites-evidence, need --force; a case whose usage names required
                                 arguments needs one; arguments after -- replace the defaults they
                                 name (same option before '=', same probe name), the rest stay; a
                                 case that needs the
                                 stack gets VERIFY_PORT / VERIFY_WEB_PORT from the stack's ports.json;
                                 without VERIFY_EVIDENCE_DIR the case writes to a new
                                 .claude/verify-evidence/<time>-<feature>-<case>/ in the main checkout,
                                 created once doctor passes (a probe with its own output option gets
                                 the directory through it, or uses the one given after --; a probe
                                 that writes fixed evidence is named instead);
                                 --dry-run prints what would run
  capture <path> [--name <label>] [--wait <ms>]
                                 screenshot a live route, record console errors and failed requests
                                 (exit 0 when the page loaded; errors are recorded, not judged;
                                 with VERIFY_EVIDENCE_DIR set it writes into a new capture-<label>/)
  archive <ticket> [--from <dir>]... [--latest <n>]
                                 copy evidence into docs/verify/<ticket>/<dir>/ (never overwrites);
                                 the source is --from, else VERIFY_EVIDENCE_DIR, else --latest <n>
                                 (newest runs in the shared evidence root, other lanes' included);
                                 --latest with either of the others is refused
  links <ticket> [--sha <sha>]   raw.githubusercontent.com links for docs/verify/<ticket>/ at a pushed SHA
  cleanup                        stop the stack (scripts/cleanup.mjs)

Feature recipes: .claude/skills/verify-pacman/features/<feature>.md
Registry: .claude/skills/verify-pacman/vp-registry.json`;

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

function firstLine(err) {
  return String(err.message ?? err).split('\n')[0];
}

// The stack doctor checks: ports.json in VERIFY_RUN_DIR; undefined before launch.
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

function pad(n) {
  return String(n).padStart(2, '0');
}

// Local time, the stamp drive.mjs and the other probes use for their directories.
function localStamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// A directory nobody wrote to yet: base, else base-2, base-3, ... Two runs in
// one second (or two lanes in the shared root) never share one.
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
  // Registry mistakes fail before doctor and before any directory exists.
  const script = resolve(SCRIPT_ROOT, c.script);
  if (!existsSync(script)) fail(`registered script is missing: ${c.script}`, 1);
  if (c.runner === 'tsx' && c.cwd === undefined) fail(`${feature}/${name} has runner tsx but no cwd in the registry`, 1);
  if (c.status !== 'current' && !force) {
    const note = c.note ? `: ${c.note.replace(/\.+$/, '')}` : '';
    fail(`${feature}/${name} is ${c.status}${note}. Re-run with --force to drive it anyway.`);
  }
  const forced = c.needs.filter((n) => n in FORCE_NEEDS);
  if (forced.length > 0 && !force) {
    const why = forced.map((n) => FORCE_NEEDS[n]).join('; ');
    fail(`${feature}/${name} needs ${forced.join(' and ')} (${why}). Re-run with --force to drive it.`);
  }
  // Options alone do not satisfy a case whose usage names a required argument.
  if (c.needsArgs && !extra.some((a) => !a.startsWith('-'))) {
    fail(`${feature}/${name} needs arguments: ${c.usage}. Pass them after --.`);
  }
  if (c.usage && extra.length === 0) console.log(`vp: ${feature}/${name} usage: ${c.usage}`);
  // Arguments after -- replace the default arguments they name (the same option
  // before '=', or the same probe or journey name); the other defaults stay, so a
  // post-fix --expect flag survives an unrelated option (/code-review on #1411).
  const keyOf = (a) => a.split('=')[0];
  const replaced = new Set(extra.map(keyOf));
  const args = [...c.args.filter((a) => !replaced.has(keyOf(a))), ...extra];
  const cwd = resolve(SCRIPT_ROOT, c.cwd ?? '.');
  const doctorFirst = c.needs.includes('stack');
  // The probe reads the run directory doctor checks, also when its own default
  // (its script's checkout) differs from VERIFY_REPO_ROOT's.
  process.env.VERIFY_RUN_DIR = RUN_DIR;
  // The probe drives the stack doctor checks, not the 8791 / 5273 defaults
  // the probes fall back to.
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
  // Every drive writes somewhere new unless told otherwise: several probes
  // default their evidence into docs/verify/<their ticket>/ or into scripts/,
  // which would rewrite committed evidence (pr-gate run 3 on #1411). A probe
  // that writes fixed evidence by design gets no directory; one that takes an
  // output option gets the directory through it, or uses the one given after --;
  // one that reads another variable gets it there (pr-gate run 4, /code-review).
  const evidence = c.evidence ?? {};
  const flagAt = args.indexOf(evidence.flag);
  // A path given after -- is the caller's: made absolute against their cwd, not
  // the probe's (node cases run from the repo root, tsx cases from a package).
  if (flagAt !== -1 && args[flagAt + 1] !== undefined) args[flagAt + 1] = resolve(args[flagAt + 1]);
  const given = flagAt === -1 ? undefined : args[flagAt + 1];
  const envName = evidence.env ?? 'VERIFY_EVIDENCE_DIR';
  const named = process.env.VERIFY_EVIDENCE_DIR;
  const planned =
    given !== undefined || evidence.writes !== undefined
      ? undefined
      : (named ?? join(EVIDENCE_ROOT, `${localStamp()}-${feature}-${name}`));
  // The probe's own output option carries the directory, in a dry run and a real one alike.
  const withEvidence = (dir) => (evidence.flag === undefined || dir === undefined ? args : [...args, evidence.flag, dir]);
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
  }
  // After doctor: a failed doctor leaves no empty directory for --latest to pick.
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
  // tsx is a dependency of apps/server, apps/daemon and integration, not of the
  // repo root, so a tsx case runs from the package its registry entry names.
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
  const label = takeOption(argv, '--name')[0] ?? 'page';
  const waitText = takeOption(argv, '--wait')[0] ?? '1500';
  if (!/^[0-9]+$/.test(waitText)) fail('--wait needs a whole number of milliseconds');
  const waitMs = Number(waitText);
  const path = argv[0];
  if (path === undefined || !path.startsWith('/')) fail('usage: vp.mjs capture </app/route> [--name <label>] [--wait <ms>]');
  if (!/^[A-Za-z0-9-]+$/.test(label)) fail('--name must be letters, digits and dashes');
  const stack = readStack();
  if (stack === undefined) fail('vp: no stack coordinates, run `vp.mjs launch` first', 1);
  const { webPort } = stack;
  const url = `http://127.0.0.1:${webPort}${path}`;
  // Inside a drive's VERIFY_EVIDENCE_DIR, a subdirectory: the drive's result.json
  // stays, and a second capture with the same label gets capture-<label>-2.
  const envDir = process.env.VERIFY_EVIDENCE_DIR;
  const dir = freshDir(envDir ? join(envDir, `capture-${label}`) : join(EVIDENCE_ROOT, `${localStamp()}-capture-${label}`));

  const consoleErrors = [];
  const failedRequests = [];
  let navigation = 'ok';
  let screenshot = `${label}.png`;
  let title = '';
  // Whatever fails (no browser, no page, no screenshot of an error page) is
  // recorded in result.json, not thrown past it.
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 732 }, colorScheme: 'dark' });
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
  } catch (err) {
    // The first failure is the one to read: a navigation error stays as it was.
    if (navigation === 'ok') navigation = firstLine(err);
    screenshot = null;
  } finally {
    await browser?.close();
  }

  const result = { url, title, navigation, screenshot, consoleErrors, failedRequests };
  writeFileSync(join(dir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`vp: captured ${url}`);
  console.log(`    navigation ${navigation}, ${consoleErrors.length} console error(s), ${failedRequests.length} failed request(s)`);
  console.log(`    evidence ${dir}`);
  return navigation === 'ok' ? 0 : 1;
}

function newestEvidenceDirs(count) {
  if (!existsSync(EVIDENCE_ROOT)) fail(`no evidence yet: ${EVIDENCE_ROOT} does not exist`, 1);
  // One stat per entry; an entry another lane removes meanwhile is skipped.
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
  // No implicit "newest run": the evidence root is shared by every lane on this
  // machine, so the newest directory can be someone else's.
  if (from.length === 0 && !envDir && latestOption === undefined) {
    fail(`${usage}\nname the source: --from <dir>, VERIFY_EVIDENCE_DIR, or --latest <n> (other lanes' runs included)`);
  }
  const sources =
    from.length > 0 ? from : envDir ? [envDir] : newestEvidenceDirs(Number(latestOption));
  if (sources.length === 0) fail('nothing to archive', 1);
  const target = join(ROOT, 'docs', 'verify', ticket);
  const plans = sources.map((src) => {
    if (!existsSync(src) || !statSync(src).isDirectory()) fail(`not an evidence directory: ${src}`, 1);
    const dest = join(target, basename(src));
    if (existsSync(dest)) fail(`refusing to overwrite ${dest}: docs/verify is add-only (ADR 0015)`, 1);
    return { src, dest };
  });
  const names = plans.map((p) => basename(p.dest));
  const twice = names.find((n, i) => names.indexOf(n) !== i);
  if (twice !== undefined) fail(`two sources share the directory name ${twice}; archive them in separate runs`, 1);
  for (const { src, dest } of plans) {
    // Only the parent: Node 24's cpSync with errorOnExist throws EEXIST when the
    // target directory itself already exists, even empty.
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
  return m ? m[1] : 'xiechimon/pacman';
}

function linksCommand(argv) {
  const shaOption = takeOption(argv, '--sha')[0];
  const ticket = argv[0];
  if (ticket === undefined || !TICKET_RE.test(ticket)) fail('usage: vp.mjs links <ticket> [--sha <sha>]');
  const sha = git(['rev-parse', shaOption ?? 'HEAD']);
  const onRemote = git(['branch', '-r', '--contains', sha]);
  if (onRemote === '') console.warn(`vp: ${sha} is not on any remote branch yet; push before using these links`);
  // -z: names come back verbatim (without it git quotes and escapes non-ASCII names).
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
    // cleanup lists the newest runs under the evidence root drive writes to.
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
