import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { lstatSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { isIPv4 } from 'node:net';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { expectedTargets, networkTargets } from './canary-attacker.mjs';
import { runCommand, withCleanup } from './canary-process.mjs';
import { plantSentinels, recoverSentinels, remainingSentinels } from './canary-sentinels.mjs';
import { startStack } from './canary-stack.mjs';

export { withCleanup } from './canary-process.mjs';

export { plantSentinels, recoverSentinels, remainingSentinels } from './canary-sentinels.mjs';

export function publicReport(value, home) {
  const pemLabels = new Map();
  const redact = (item) => {
    if (typeof item === 'string') {
      return item.replaceAll(home, '~').replace(/~\/\.cairn\/[^/"'\n]+?\.pem/g, (path) => {
        if (!pemLabels.has(path)) pemLabels.set(path, `~/.cairn/${pemLabels.size + 1}.pem`);
        return pemLabels.get(path);
      });
    }
    if (Array.isArray(item)) return item.map(redact);
    if (item && typeof item === 'object')
      return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, redact(entry)]));
    return item;
  };
  return redact(value);
}

export function aggregateResult({
  config,
  orb,
  negative,
  pushedObjectsClean,
  negativeObjectsContainMarker,
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
  const hostTargets = networkTargets(config).filter((target) => target !== 'http://127.0.0.1:8787');
  const hostConnections = negative?.routes?.socketAndServer ?? [];
  const listenersLive = hostTargets.every((target) => {
    const rows = hostConnections.filter((row) => row.target === `direct ${target}`);
    return rows.length === 1 && rows[0].blocked === false && rows[0].detail === 'connected';
  });
  const labels = new Map();
  let pemIndex = 0;
  for (const path of [...config.sentinels.map((entry) => entry.path), ...config.realPaths]) {
    labels.set(
      path,
      config.realPaths.includes(path) && path.endsWith('.pem')
        ? `~/.cairn/${++pemIndex}.pem`
        : path.replace(config.hostHome, '~'),
    );
  }
  labels.set(config.hostHome, '~');
  const redact = (value) => {
    if (typeof value === 'string') {
      for (const [path, label] of [...labels].sort((a, b) => b[0].length - a[0].length))
        value = value.replaceAll(path, label);
      return value;
    }
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item)]));
    return value;
  };
  const githubReach = orb?.githubReach ?? { ok: false, ms: 0 };
  return redact({
    routes,
    sentinels: config.sentinels,
    pushedObjectsClean,
    negativeObjectsContainMarker,
    negativeControl: {
      executor: 'host',
      leaked,
      listeners: hostConnections.filter((row) =>
        hostTargets.some((target) => row.target === `direct ${target}`),
      ),
    },
    githubReach,
    orbName,
    durationMs,
    ok:
      complete &&
      orb?.executor === 'orb' &&
      pushedObjectsClean === true &&
      validControl &&
      listenersLive &&
      negativeObjectsContainMarker === true &&
      githubReach.ok === true &&
      Number.isFinite(githubReach.ms) &&
      githubReach.ms >= 0,
  });
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
      const planted = plantSentinels(realpathSync(home), runId);
      defer(planted.cleanup);
      const root = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-orb-canary-')));
      const { dev, ino } = lstatSync(root);
      planted.record({ kind: 'scratch', path: root, dev, ino });
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
      const stack = await stackFactory({ root, config, defer, signal, record: planted.record });
      config.serverPort = stack.port;
      process.stderr.write('Canary: running orb attacker through the scratch daemon\n');
      const orb = await stack.run('orb');
      const pushedObjectsClean = await scanObjects(orb.repo, orb.branch, planted.markers);
      process.stderr.write('Canary: running host negative control through the scratch daemon\n');
      const negative = await stack.run('host');
      const negativeObjectsContainMarker = !(await scanObjects(
        negative.repo,
        negative.branch,
        planted.markers,
      ));
      return aggregateResult({
        config,
        orb: orb.result,
        negative: negative.result,
        pushedObjectsClean,
        negativeObjectsContainMarker,
        orbName: orb.orbName,
        durationMs: Date.now() - started,
      });
    });
    result.durationMs = Date.now() - started;
    result.sentinelsRemaining = remainingSentinels(home);
    if (result.sentinelsRemaining.length) result.ok = false;
    return publicReport(result, home);
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
  result = publicReport(result, options.home ?? homedir());
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
