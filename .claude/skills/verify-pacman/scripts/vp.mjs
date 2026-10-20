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
import { basename, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const SKILL_DIR = fileURLToPath(new URL('..', import.meta.url));
const SCRIPTS_DIR = join(SKILL_DIR, 'scripts');
const SCRIPT_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const ROOT = process.env.VERIFY_REPO_ROOT ? resolve(process.env.VERIFY_REPO_ROOT) : SCRIPT_ROOT;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(ROOT, '.claude', 'verify-run');
const EVIDENCE_ROOT = join(SCRIPT_ROOT, '.claude', 'verify-evidence');
// Cases that spend model tokens or call GitHub run only when asked with --force.
const COSTLY_NEEDS = ['real-llm', 'github'];
const REGISTRY_FILE = join(SKILL_DIR, 'vp-registry.json');
const TICKET_RE = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg)$/i;

const USAGE = `verify-pacman: node .claude/skills/verify-pacman/scripts/vp.mjs <command>

  launch                         start the isolated stack (scripts/launch.mjs)
  doctor                         read-only health check of the stack (scripts/doctor.mjs)
  list [feature]                 registered features and their cases
  drive <feature> [case] [--force] [-- <args>]
                                 run a registered case; cases that need the stack run doctor first;
                                 stale and host-bound cases, and cases that need real-llm or github,
                                 need --force; script arguments go after --
  capture <path> [--name <label>] [--wait <ms>]
                                 screenshot a live route, record console errors and failed requests
                                 (exit 0 when the page loaded; errors are recorded, not judged)
  archive <ticket> [--from <dir>]... [--latest <n>]
                                 copy evidence into docs/verify/<ticket>/<dir>/ (never overwrites);
                                 without --from: VERIFY_EVIDENCE_DIR if set, else the newest run
  links <ticket> [--sha <sha>]   raw.githubusercontent.com links for docs/verify/<ticket>/ at a pushed SHA
  cleanup                        stop the stack (scripts/cleanup.mjs)

Feature recipes: .claude/skills/verify-pacman/features/<feature>.md
Registry: .claude/skills/verify-pacman/vp-registry.json`;

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
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

function runNode(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit', env: process.env });
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
  if (wanted !== undefined && !(wanted in features)) fail(`unknown feature: ${wanted}\nfeatures: ${Object.keys(features).join(', ')}`);
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
  const [feature, caseName, ...stray] = argv;
  if (stray.length > 0) fail(`unexpected argument(s) ${stray.join(' ')}: script arguments go after --`);
  const { features } = loadRegistry();
  if (feature === undefined) fail(`usage: vp.mjs drive <feature> [case]\nfeatures: ${Object.keys(features).join(', ')}`);
  const entry = features[feature];
  if (entry === undefined) fail(`unknown feature: ${feature}\nfeatures: ${Object.keys(features).join(', ')}`);
  const names = Object.keys(entry.cases);
  let name = caseName;
  if (name === undefined) {
    if (names.length !== 1) fail(`feature ${feature} has ${names.length} cases, name one: ${names.join(', ')}`);
    name = names[0];
  }
  const c = entry.cases[name];
  if (c === undefined) fail(`unknown case ${feature}/${name}; cases: ${names.join(', ')}`);
  if (c.status !== 'current' && !force) {
    const note = c.note ? `: ${c.note.replace(/\.+$/, '')}` : '';
    fail(`${feature}/${name} is ${c.status}${note}. Re-run with --force to drive it anyway.`);
  }
  const costly = c.needs.filter((n) => COSTLY_NEEDS.includes(n));
  if (costly.length > 0 && !force) {
    fail(`${feature}/${name} needs ${costly.join(' and ')} (model tokens or GitHub calls). Re-run with --force to drive it.`);
  }
  if (c.usage && extra.length === 0) console.log(`vp: ${feature}/${name} usage: ${c.usage}`);
  if (c.needs.includes('stack')) {
    console.log(`vp: ${feature}/${name} needs the stack, running doctor first`);
    if (runNode(join(SCRIPTS_DIR, 'doctor.mjs'), []) !== 0) {
      fail('vp: doctor failed. Start the stack with `vp.mjs launch` (or fix what doctor reported) and retry.', 1);
    }
  }
  const script = resolve(SCRIPT_ROOT, c.script);
  if (!existsSync(script)) fail(`registered script is missing: ${c.script}`, 1);
  // tsx is a dependency of apps/server, apps/daemon and integration, not of the
  // repo root, so a tsx case runs from the package its registry entry names.
  const cwd = resolve(SCRIPT_ROOT, c.cwd ?? '.');
  const runner = c.runner === 'tsx' ? `(cd ${c.cwd ?? '.'} && pnpm exec tsx)` : 'node';
  console.log(`vp: ${feature}/${name} -> ${runner} ${c.script} ${[...c.args, ...extra].join(' ')}`.trimEnd());
  if (c.runner !== 'tsx') return runNode(script, [...c.args, ...extra]);
  if (c.cwd === undefined) fail(`${feature}/${name} has runner tsx but no cwd in the registry`, 1);
  const result = spawnSync('pnpm', ['exec', 'tsx', script, ...c.args, ...extra], {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) fail(`could not run ${c.script}: ${result.error.message}`, 1);
  return result.status ?? 1;
}

async function captureCommand(argv) {
  const label = takeOption(argv, '--name')[0] ?? 'page';
  const waitMs = Number(takeOption(argv, '--wait')[0] ?? 1500);
  const path = argv[0];
  if (path === undefined || !path.startsWith('/')) fail('usage: vp.mjs capture </app/route> [--name <label>] [--wait <ms>]');
  if (!/^[A-Za-z0-9-]+$/.test(label)) fail('--name must be letters, digits and dashes');
  const portsFile = join(RUN_DIR, 'ports.json');
  if (!existsSync(portsFile)) fail('vp: no stack coordinates, run `vp.mjs launch` first', 1);
  const { webPort } = JSON.parse(readFileSync(portsFile, 'utf8'));
  const url = `http://127.0.0.1:${webPort}${path}`;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = process.env.VERIFY_EVIDENCE_DIR ?? join(EVIDENCE_ROOT, `${stamp}-capture-${label}`);
  mkdirSync(dir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 732 }, colorScheme: 'dark' });
  const consoleErrors = [];
  const failedRequests = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('requestfailed', (req) => failedRequests.push({ url: req.url(), error: req.failure()?.errorText ?? 'failed' }));
  page.on('response', (res) => {
    if (res.status() >= 400) failedRequests.push({ url: res.url(), status: res.status() });
  });
  let navigation = 'ok';
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForTimeout(waitMs);
  } catch (err) {
    navigation = String(err.message ?? err).split('\n')[0];
  }
  const screenshot = `${label}.png`;
  await page.screenshot({ path: join(dir, screenshot) });
  const title = await page.title().catch(() => '');
  await browser.close();

  const result = { url, title, navigation, screenshot, consoleErrors, failedRequests };
  writeFileSync(join(dir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`vp: captured ${url}`);
  console.log(`    navigation ${navigation}, ${consoleErrors.length} console error(s), ${failedRequests.length} failed request(s)`);
  console.log(`    evidence ${dir}`);
  return navigation === 'ok' ? 0 : 1;
}

function newestEvidenceDirs(count) {
  if (!existsSync(EVIDENCE_ROOT)) fail(`no evidence yet: ${EVIDENCE_ROOT} does not exist`, 1);
  return readdirSync(EVIDENCE_ROOT)
    .map((name) => join(EVIDENCE_ROOT, name))
    .filter((p) => statSync(p).isDirectory())
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    .slice(0, count);
}

function archiveCommand(argv) {
  const from = takeOption(argv, '--from').map((p) => resolve(p));
  const latest = Number(takeOption(argv, '--latest')[0] ?? 1);
  const ticket = argv[0];
  if (ticket === undefined || !TICKET_RE.test(ticket)) fail('usage: vp.mjs archive <ticket> [--from <dir>]... [--latest <n>]');
  const envDir = process.env.VERIFY_EVIDENCE_DIR;
  const sources = from.length > 0 ? from : envDir ? [resolve(envDir)] : newestEvidenceDirs(latest);
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
    mkdirSync(dest, { recursive: true });
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
  const files = git(['ls-tree', '-r', '--name-only', sha, '--', `docs/verify/${ticket}`]).split('\n').filter(Boolean);
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
