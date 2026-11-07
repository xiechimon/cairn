import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { keepAlive, seedWorld } from './live-seed.mjs';

const [port, mode] = process.argv.slice(2);
const WEB_ROOT = resolve(import.meta.dirname, '..');
const SERVER_ROOT = resolve(WEB_ROOT, '..', 'server');
const STATE_DIR = join(WEB_ROOT, 'pr-screens-live');
const origin = `http://127.0.0.1:${port}`;

mkdirSync(STATE_DIR, { recursive: true });
rmSync(join(STATE_DIR, `state-${port}.json`), { force: true });

if (!existsSync(join(WEB_ROOT, 'dist', 'index.html'))) {
  const built = spawnSync('pnpm', ['exec', 'vite', 'build', '--mode', 'fixture'], {
    cwd: WEB_ROOT,
    stdio: 'inherit',
  });
  if (built.status !== 0) process.exit(built.status ?? 1);
}

const home = mkdtempSync(join(tmpdir(), 'pr-screens-world-'));
const log = openSync(join(STATE_DIR, `server-${port}.log`), 'a');
const server = spawn('pnpm', ['exec', 'tsx', 'src/index.ts'], {
  cwd: SERVER_ROOT,
  env: {
    ...process.env,
    PORT: port,
    CAIRN_HOME: home,
    CAIRN_SKILLS_DIR: join(home, 'skills'),
    CAIRN_AUTH: 'off',
    NODE_OPTIONS:
      `${process.env.NODE_OPTIONS ?? ''} --require ${join(import.meta.dirname, 'fixed-hostname.cjs')} --import ${new URL('fixed-clock.mjs', import.meta.url).href}`.trim(),
  },
  stdio: ['ignore', log, log],
});

const stop = () => {
  server.kill('SIGTERM');
};
process.on('SIGTERM', () => {
  stop();
  process.exit(0);
});
process.on('SIGINT', () => {
  stop();
  process.exit(0);
});
process.on('exit', stop);

const deadline = Date.now() + 120_000;
for (;;) {
  const ready = await fetch(`${origin}/api/teams`, { signal: AbortSignal.timeout(2000) })
    .then((res) => res.ok)
    .catch(() => false);
  if (ready) break;
  if (Date.now() > deadline) throw new Error(`server not ready at ${origin}`);
  await new Promise((resolve) => setTimeout(resolve, 300));
}

if (mode === 'seed') {
  const state = await seedWorld(origin);
  writeFileSync(join(STATE_DIR, `state-${port}.json`), JSON.stringify(state));
  setInterval(() => {
    keepAlive(origin, state).catch(() => undefined);
  }, 15_000);
}

createServer((_, res) => res.end('ready')).listen(Number(port) + 1, '127.0.0.1');
