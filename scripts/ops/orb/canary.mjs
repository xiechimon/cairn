import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { lstatSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { isIPv4 } from 'node:net';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { expectedTargets } from './canary-attacker.mjs';
import { runCommand, withCleanup } from './canary-process.mjs';
import { plantSentinels, recoverSentinels, remainingSentinels } from './canary-sentinels.mjs';
import { startStack } from './canary-stack.mjs';

export { withCleanup } from './canary-process.mjs';

export { plantSentinels, recoverSentinels, remainingSentinels } from './canary-sentinels.mjs';

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
  runId = process.env.CAIRN_CANARY_RUN_ID ?? randomBytes(12).toString('hex'),
  timeout = 1800000,
} = {}) {
  const started = Date.now();
  signal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeout)]);
  try {
    recoverSentinels(realpathSync(home));
    const prerequisites = await preflight();
    signal?.throwIfAborted();
    const result = await withCleanup(async (defer) => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-orb-canary-')));
      defer(() => rmSync(root, { recursive: true, force: true }));
      const planted = plantSentinels(realpathSync(home), runId);
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
    result.sentinelsRemaining = remainingSentinels(home);
    if (result.sentinelsRemaining.length) result.ok = false;
    return result;
  } catch (error) {
    if (signal.aborted) error.message = `${signal.reason.message}; ${error.message}`;
    error.sentinelsRemaining = remainingSentinels(home);
    throw error;
  }
}

export async function canaryMain(args = process.argv.slice(2), options = {}) {
  const controller = new AbortController();
  const handlers = new Map();
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    const handler = () => controller.abort(new Error(`Interrupted by ${signal}`));
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  let result;
  let out;
  try {
    if (args[0] === '--cleanup' && args.length === 2) {
      recoverSentinels(realpathSync(options.home ?? homedir()), args[1]);
      result = { ok: true };
    } else {
      if (
        args[0] !== '--json' ||
        ![1, 3].includes(args.length) ||
        (args.length === 3 && (args[1] !== '--out' || !args[2]))
      )
        throw new Error('Usage: canary.sh --json [--out PATH] | --cleanup RUN_ID');
      out = args[2];
      result = await runCanary({ ...options, signal: controller.signal });
    }
  } catch (error) {
    result = { ok: false, errors: [error.message] };
  } finally {
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
  }
  try {
    result.sentinelsRemaining = remainingSentinels(options.home ?? homedir());
    if (result.sentinelsRemaining.length) result.ok = false;
  } catch (error) {
    result.ok = false;
    result.errors = [...(result.errors ?? []), error.message];
  }
  if (out) {
    try {
      writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    } catch (error) {
      result.ok = false;
      result.errors = [...(result.errors ?? []), `Cannot create output (${error.code ?? 'error'})`];
    }
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 1;
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) await canaryMain();
