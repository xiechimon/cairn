#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { constants as osConstants, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const DEFAULT_SLOTS = 2;
const POLL_MS = 250;
const PARTIAL_WRITE_GRACE_MS = 2_000;
const DEFAULT_E2E_PORT = 8398;
const PORT_STRIDE = 10;

export function slotCount(env) {
  const raw = env.CAIRN_HEAVY_SLOTS;
  if (raw === undefined || raw === '') return { count: DEFAULT_SLOTS };
  if (/^[1-9]\d*$/.test(raw.trim())) return { count: Number(raw) };
  return { count: 1, warning: `CAIRN_HEAVY_SLOTS=${raw} 不是正整数，按 1 处理` };
}

export function skipsQueue(env) {
  return env.CI !== undefined && env.CI !== '' && env.CI !== 'false' && env.CI !== '0';
}

export function slotResources(slot, env) {
  const base = Number(env.E2E_PORT || env.E2E_AFFECTED_PORT) || DEFAULT_E2E_PORT;
  return {
    port: base + (slot - 1) * PORT_STRIDE,
    distDir: join(tmpdir(), `cairn-heavy-slot-${slot}`, 'web-dist'),
  };
}

export function writeSlotPlaywrightConfig({ slot, env, webDir }) {
  const { port, distDir } = slotResources(slot, env);
  const slotDir = join(tmpdir(), `cairn-heavy-slot-${slot}`);
  mkdirSync(slotDir, { recursive: true });
  const path = join(slotDir, 'playwright.slot.config.ts');
  const buildFlags = `--outDir ${distDir}`;
  writeFileSync(
    path,
    `import base from ${JSON.stringify(join(webDir, 'playwright.config.ts'))};

const webServer = base.webServer;
const command = webServer.command
  .replace('vite build --mode fixture', 'vite build --mode fixture ${buildFlags} --emptyOutDir')
  .replace('vite preview', 'vite preview ${buildFlags}')
  .replace(/--port \\d+/, '--port ${port}');
if (!command.includes('${buildFlags} --emptyOutDir') || !command.includes('preview ${buildFlags}'))
  throw new Error('playwright.config.ts webServer command no longer matches the slot rewrite');

export default {
  ...base,
  testDir: ${JSON.stringify(join(webDir, 'e2e'))},
  outputDir: ${JSON.stringify(join(slotDir, 'test-results'))},
  use: { ...base.use, baseURL: 'http://127.0.0.1:${port}' },
  webServer: { ...webServer, command, cwd: ${JSON.stringify(webDir)}, url: 'http://127.0.0.1:${port}/app', reuseExistingServer: false },
};
`,
  );
  return { path, port, distDir };
}

export function leaseEnv(lease, env = process.env) {
  if (lease === null) return env;
  return {
    ...env,
    CAIRN_HEAVY_SLOT: String(lease.slot),
    CAIRN_HEAVY_SLOT_OWNER: String(lease.owner),
  };
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function holderState(path) {
  let text;
  let modified;
  try {
    text = readFileSync(path, 'utf8');
    modified = statSync(path).mtimeMs;
  } catch (error) {
    if (error.code === 'ENOENT') return { state: 'free' };
    throw error;
  }
  let pid;
  try {
    pid = JSON.parse(text).pid;
  } catch {}
  if (Number.isInteger(pid)) return { state: isAlive(pid) ? 'held' : 'stale', pid };
  return { state: Date.now() - modified < PARTIAL_WRITE_GRACE_MS ? 'held' : 'stale' };
}

function createExclusive(path) {
  try {
    writeFileSync(path, JSON.stringify({ pid: process.pid }), { flag: 'wx' });
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}

export async function acquireSlot({ env = process.env, wait = true, log = console.error } = {}) {
  if (skipsQueue(env)) return null;
  const { count, warning } = slotCount(env);
  if (warning) log(`[heavy-slots] ${warning}`);
  const dir = env.CAIRN_HEAVY_SLOTS_DIR || join(tmpdir(), 'cairn-heavy-slots');
  const slotPath = (slot) => join(dir, `slot-${slot}.lock`);
  mkdirSync(dir, { recursive: true });

  const inherited = Number(env.CAIRN_HEAVY_SLOT);
  const owner = Number(env.CAIRN_HEAVY_SLOT_OWNER);
  if (Number.isInteger(inherited) && inherited >= 1 && inherited <= count) {
    const holder = holderState(slotPath(inherited));
    if (holder.state === 'held' && holder.pid === owner)
      return { slot: inherited, owner, release() {} };
  }

  const claim = () => {
    for (let slot = 1; slot <= count; slot++) {
      const path = slotPath(slot);
      if (!createExclusive(path)) {
        if (holderState(path).state !== 'stale') continue;
        const reclaiming = `${path}.reclaiming`;
        if (!createExclusive(reclaiming)) {
          if (holderState(reclaiming).state === 'stale') unlinkSync(reclaiming);
          continue;
        }
        try {
          if (holderState(path).state === 'stale') unlinkSync(path);
          if (!createExclusive(path)) continue;
        } finally {
          unlinkSync(reclaiming);
        }
      }
      const release = () => {
        if (holderState(path).pid === process.pid) unlinkSync(path);
      };
      process.once('exit', release);
      log(`[heavy-slots] 拿到名额 ${slot}/${count}`);
      return { slot, owner: process.pid, release };
    }
    return null;
  };
  if (!wait) return claim();

  const ticket = `queue-${String(Date.now()).padStart(15, '0')}-${String(process.pid).padStart(10, '0')}`;
  const dropTicket = () => {
    try {
      unlinkSync(join(dir, ticket));
    } catch {}
  };
  writeFileSync(join(dir, ticket), '');
  process.once('exit', dropTicket);
  let announced = 0;
  try {
    for (;;) {
      const waiting = [];
      for (const name of readdirSync(dir)) {
        const ticketOwner = /^queue-\d+-(\d+)$/.exec(name);
        if (!ticketOwner) continue;
        if (isAlive(Number(ticketOwner[1]))) waiting.push(name);
        else
          try {
            unlinkSync(join(dir, name));
          } catch {}
      }
      const position = waiting.sort().indexOf(ticket) + 1;
      let freeSlots = 0;
      for (let slot = 1; slot <= count; slot++)
        if (holderState(slotPath(slot)).state !== 'held') freeSlots++;
      if (position <= freeSlots) {
        const lease = claim();
        if (lease) return lease;
      }
      if (position !== announced) {
        log(`[heavy-slots] 排队中，第 ${position} 位（${count} 个名额都被占用）`);
        announced = position;
      }
      await sleep(POLL_MS);
    }
  } finally {
    dropTicket();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const argv = process.argv.slice(2);
  const command = argv[0] === 'run' && argv[1] === '--' ? argv.slice(2) : [];
  if (command.length === 0) {
    console.error('Usage: node scripts/heavy-slots.mjs run -- <command> [args...]');
    process.exit(2);
  }
  const lease = await acquireSlot();
  const child = spawn(command[0], command.slice(1), { stdio: 'inherit', env: leaseEnv(lease) });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'])
    process.on(signal, () => child.kill(signal));
  child.on('error', (error) => {
    console.error(`[heavy-slots] ${command[0]}: ${error.message}`);
    process.exit(127);
  });
  child.on('exit', (code, signal) =>
    process.exit(code ?? 128 + (osConstants.signals[signal] ?? 0)),
  );
}
