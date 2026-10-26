import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { rmSync } from 'node:fs';
import { createServer } from 'node:net';

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ENV_VARS } from '@cairn/shared';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';

const SERVER_DIR = resolve(import.meta.dirname, '..', '..', 'server');
const TETHER = pathToFileURL(resolve(import.meta.dirname, 'live-server-tether.mjs')).href;

export interface LiveServer {
  base: string;
  home: string;
  dispose: () => Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address !== null && typeof address === 'object') {
        const { port } = address;
        probe.close(() => resolvePort(port));
      } else {
        probe.close(() => reject(new Error('freePort: no address')));
      }
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function signalGroup(pgid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-pgid, signal);
    return true;
  } catch {
    return false;
  }
}

async function reapGroup(pgid: number): Promise<void> {
  for (const [signal, graceMs] of [
    ['SIGTERM', 5_000],
    ['SIGKILL', 2_000],
  ] as const) {
    if (!signalGroup(pgid, signal)) return;
    const deadline = Date.now() + graceMs;
    while (Date.now() < deadline) {
      await sleep(50);
      if (!signalGroup(pgid, 0)) return;
    }
  }
  throw new Error(`live server process group ${pgid} survived SIGKILL`);
}

/** Real apps/server on a free port with a scratch CAIRN_HOME, serving this
 *  worktree's dist. Ready = /api/teams answers 401 (token set) or 200.
 *
 *  Runs as `node --import tsx` in its own process group: `pnpm exec` puts
 *  corepack's shim in front, and the shim exits on SIGTERM without
 *  forwarding it, which orphaned the whole server tree. dispose() reaps
 *  the group; the tether reaps it when the spawner dies without disposing. */
export async function bootLiveServer(
  token: string | null,
  tailscaleUsers?: string,
): Promise<LiveServer> {
  const home = makeTestTempDir('cairn-e2e-home-');
  const port = await freePort();
  const child = spawn(process.execPath, ['--import', 'tsx', '--import', TETHER, 'src/index.ts'], {
    cwd: SERVER_DIR,
    detached: true,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      LOG_LEVEL: 'warn',
      [ENV_VARS.home]: home,
      [ENV_VARS.webDir]: process.env.E2E_DIST_DIR ?? resolve(import.meta.dirname, '..', 'dist'),
      [ENV_VARS.token]: token ?? '',
      CAIRN_TAILSCALE_USERS: tailscaleUsers ?? '',
    },
    stdio: ['pipe', 'ignore', 'inherit'],
  });
  const pgid = child.pid;
  if (pgid === undefined) {
    const [err] = await once(child, 'error');
    throw err;
  }
  let disposal: Promise<void> | undefined;
  const dispose = () => {
    disposal ??= (async () => {
      if (child.exitCode === null && child.signalCode === null) await reapGroup(pgid);
      rmSync(home, { recursive: true, force: true });
    })();
    return disposal;
  };

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const res = await fetch(`${base}/api/teams`, { signal: AbortSignal.timeout(2_000) });
      if (res.status === (token !== null ? 401 : 200)) break;
    } catch {}
    const exited = child.exitCode ?? child.signalCode;
    if (exited !== null || Date.now() > deadline) {
      await dispose();
      throw new Error(`live server not ready on ${base} (exited: ${exited})`);
    }
    await sleep(250);
  }
  return { base, home, dispose };
}
