import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readdirSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { isIPv4 } from 'node:net';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { expectedTargets } from './canary-attacker.mjs';
import { runCommand, withCleanup } from './canary-process.mjs';
import { startStack } from './canary-stack.mjs';

export { withCleanup } from './canary-process.mjs';

export function plantSentinels(home, id = randomBytes(12).toString('hex')) {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('Invalid sentinel suffix');
  const created = [];
  const sentinels = [];
  const markers = [];
  const cleanup = () => {
    const errors = [];
    for (const { path, dev, ino } of created.reverse()) {
      try {
        const current = lstatSync(path, { throwIfNoEntry: false });
        if (!current) continue;
        if (current.dev !== dev || current.ino !== ino || !current.isFile())
          throw new Error(`Sentinel replaced; preserved ${path}`);
        unlinkSync(path);
      } catch (error) {
        errors.push(error.message);
      }
    }
    created.length = 0;
    if (errors.length) throw new Error(errors.join('; '));
  };
  try {
    for (const [directory, extension] of [
      ['.cairn', '.pem'],
      ['.cairn', '.key'],
      ['.ssh', ''],
      ['.codex', '.json'],
      ['.claude', '.json'],
    ]) {
      const parent = join(home, directory);
      if (!lstatSync(parent).isDirectory() || realpathSync(parent) !== parent)
        throw new Error(`Secret directory must exist without symlinks: ${parent}`);
      const path = join(parent, `cairn-canary-${id}${extension}`);
      const fd = openSync(
        path,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        const { dev, ino } = fstatSync(fd);
        created.push({ path, dev, ino });
        const marker = `CAIRN_CANARY_${randomBytes(32).toString('hex')}`;
        writeFileSync(fd, marker);
        markers.push(marker);
        sentinels.push({ path, hash: createHash('sha256').update(marker).digest('hex') });
      } finally {
        closeSync(fd);
      }
    }
  } catch (error) {
    cleanup();
    throw error;
  }
  return { sentinels, markers, cleanup };
}

export function aggregateResult({
  config,
  orb,
  negative,
  pushedObjectsClean,
  orbName,
  durationMs,
}) {
  const targets = expectedTargets(config);
  const routes = Object.fromEntries(
    Object.keys(targets).map((name) => [name, orb?.routes?.[name] ?? []]),
  );
  const complete = Object.entries(targets).every(([name, expected]) => {
    const rows = routes[name];
    return (
      Array.isArray(rows) &&
      rows.length === expected.length &&
      expected.every(
        (target) =>
          rows.filter(
            (row) =>
              row.target === target && row.blocked === true && typeof row.detail === 'string',
          ).length === 1,
      )
    );
  });
  const leaked = negative?.leaked ?? [];
  const validControl =
    negative?.executor === 'host' &&
    Array.isArray(leaked) &&
    leaked.length > 0 &&
    leaked.every((path) => config.sentinels.some((entry) => entry.path === path));
  const githubReach = orb?.githubReach ?? { ok: false, ms: 0 };
  return {
    routes,
    sentinels: config.sentinels,
    pushedObjectsClean,
    negativeControl: { executor: 'host', leaked },
    githubReach,
    orbName,
    durationMs,
    ok:
      complete &&
      orb?.executor === 'orb' &&
      pushedObjectsClean === true &&
      validControl &&
      githubReach.ok === true &&
      Number.isFinite(githubReach.ms) &&
      githubReach.ms >= 0,
  };
}

export async function scanObjects(repo, branch, markers) {
  if (!markers.length || markers.some((marker) => !marker))
    throw new Error('Missing marker inventory');
  let clean = true;
  for (const args of [
    ['log', '-p', '--binary', branch, '--'],
    ['cat-file', '--batch-all-objects', '--batch'],
  ]) {
    await new Promise((resolveScan, reject) => {
      const child = spawn('git', ['-C', repo, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
      const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
      let tail = Buffer.alloc(0);
      const overlap = Math.max(...markers.map((marker) => Buffer.byteLength(marker))) - 1;
      child.stdout.on('data', (chunk) => {
        const buffer = Buffer.concat([tail, chunk]);
        if (markers.some((marker) => buffer.includes(Buffer.from(marker)))) clean = false;
        tail = buffer.subarray(Math.max(0, buffer.length - overlap));
      });
      child.stderr.resume();
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolveScan();
        else reject(new Error('Git object scan failed'));
      });
    });
  }
  return clean;
}

export async function runCanary({
  signal,
  preflight = async () => {
    if (process.platform !== 'linux' || userInfo().username !== 'ian' || process.getuid() === 0)
      throw new Error('Run on the provisioned Linux host as ian without sudo');
    const result = JSON.parse(
      await runCommand(
        process.execPath,
        [join(import.meta.dirname, 'orb-host-check.mjs'), '--json'],
        { timeout: null, detached: true },
      ),
    );
    if (!result.ok) throw new Error(`Orb host prerequisites failed: ${result.errors.join('; ')}`);
    const tailnetAddress = (await runCommand('tailscale', ['ip', '-4'])).trim();
    if (!isIPv4(tailnetAddress)) throw new Error('Cannot determine the host tailnet IPv4 address');
    return { tailnetAddress };
  },
  home = homedir(),
  stackFactory = startStack,
} = {}) {
  const started = Date.now();
  const prerequisites = await preflight();
  signal?.throwIfAborted();
  const result = await withCleanup(async (defer) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-orb-canary-')));
    defer(() => rmSync(root, { recursive: true, force: true }));
    const planted = plantSentinels(realpathSync(home));
    defer(planted.cleanup);
    const realPaths = [
      join(home, '.cairn/machine.json'),
      ...readdirSync(join(home, '.cairn'))
        .filter(
          (name) =>
            name.endsWith('.pem') &&
            !planted.sentinels.some((entry) => entry.path === join(home, '.cairn', name)),
        )
        .map((name) => join(home, '.cairn', name)),
      join(home, '.ssh'),
      join(home, '.codex/auth.json'),
      join(home, '.claude'),
    ];
    const secretbox = join(home, '.cairn/secretbox.key');
    if (lstatSync(secretbox, { throwIfNoEntry: false })) realPaths.push(secretbox);
    const config = {
      hostHome: home,
      sentinels: planted.sentinels,
      realPaths,
      tailnetAddress: prerequisites?.tailnetAddress,
    };
    const stack = await stackFactory({ root, config, defer, signal });
    config.serverPort = stack.port;
    process.stderr.write('Canary: running orb attacker through the scratch daemon\n');
    const orb = await stack.run('orb');
    const pushedObjectsClean = await scanObjects(orb.repo, orb.branch, planted.markers);
    process.stderr.write('Canary: running host negative control through the scratch daemon\n');
    const negative = await stack.run('host');
    return aggregateResult({
      config,
      orb: orb.result,
      negative: negative.result,
      pushedObjectsClean,
      orbName: orb.orbName,
      durationMs: Date.now() - started,
    });
  });
  result.durationMs = Date.now() - started;
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const controller = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => controller.abort(new Error(`Interrupted by ${signal}`)));
  let result;
  let out;
  try {
    const args = process.argv.slice(2);
    if (
      args[0] !== '--json' ||
      ![1, 3].includes(args.length) ||
      (args.length === 3 && (args[1] !== '--out' || !args[2]))
    )
      throw new Error('Usage: canary.sh --json [--out docs/verify/2277/canary.json]');
    out = args[2];
    result = await runCanary({ signal: controller.signal });
  } catch (error) {
    result = { ok: false, errors: [error.message] };
  }
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (out) {
    try {
      writeFileSync(out, json, { mode: 0o600, flag: 'wx' });
    } catch (error) {
      result.ok = false;
      result.errors = [...(result.errors ?? []), `Cannot create output (${error.code ?? 'error'})`];
    }
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}
