#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { acquireSlot, leaseEnv, LIVE_STACK_POOL } from '../../../../scripts/heavy-slots.mjs';
import { spawnOwned } from '../../../../scripts/owned-process.mjs';

const SCRIPT_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const ROOT = process.env.VERIFY_REPO_ROOT
  ? resolve(process.env.VERIFY_REPO_ROOT)
  : SCRIPT_ROOT;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(ROOT, '.claude', 'verify-run');
const SERVER_PORT = Number(process.env.VERIFY_PORT ?? 8791);
const WEB_PORT = Number(process.env.VERIFY_WEB_PORT ?? 5273);
const HOME_DIR = join(RUN_DIR, 'home');
const SKILLS_DIR = join(HOME_DIR, 'skills');
const rawIdleMs = Number(process.env.VERIFY_IDLE_TIMEOUT_MS ?? '1200000');
const IDLE_TIMEOUT_MS = Number.isFinite(rawIdleMs) && rawIdleMs >= 0 ? rawIdleMs : 1_200_000;
const rawMaxAgeMs = Number(process.env.VERIFY_MAX_AGE_MS ?? '2700000');
const MAX_AGE_MS = Number.isFinite(rawMaxAgeMs) && rawMaxAgeMs >= 0 ? rawMaxAgeMs : 2_700_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function portFree(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(600) });
    return false;
  } catch (err) {
    return err?.cause?.code === 'ECONNREFUSED';
  }
}

function groupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const portsFile = join(RUN_DIR, 'ports.json');
  if (existsSync(portsFile)) {
    try {
      const prev = JSON.parse(readFileSync(portsFile, 'utf8'));
      const live = [prev.supervisorPid, prev.serverPid].find((pid) => pid != null && groupAlive(pid));
      if (live !== undefined) {
        console.error(`a stack is already running (pid ${live}, ports.json in ${RUN_DIR})`);
        console.error('先 node scripts/cleanup.mjs 回收,或 doctor.mjs 体检');
        process.exit(1);
      }
    } catch {

    }
  }

  const lease = await acquireSlot({ pool: LIVE_STACK_POOL });
  if (lease !== null) Object.assign(process.env, leaseEnv(lease));

  if (!(await portFree(SERVER_PORT))) {
    console.error(`VERIFY_PORT ${SERVER_PORT} 被占——别的 lane?不能杀,换端口重试:`);
    console.error(`  VERIFY_PORT=<别的> VERIFY_WEB_PORT=<别的> node ${process.argv[1]}`);
    console.error(`  查占用:lsof -iTCP:${SERVER_PORT} -sTCP:LISTEN`);
    process.exit(1);
  }
  if (!(await portFree(WEB_PORT))) {
    console.error(`VERIFY_WEB_PORT ${WEB_PORT} 被占——同上,换端口重试`);
    process.exit(1);
  }

  rmSync(RUN_DIR, { recursive: true, force: true });
  mkdirSync(HOME_DIR, { recursive: true });
  mkdirSync(SKILLS_DIR, { recursive: true });

  const serverLog = openSync(join(RUN_DIR, 'server.log'), 'a');
  const server = spawnOwned('pnpm', ['exec', 'tsx', 'src/index.ts'], {
    name: 'verify-server',
    cwd: join(ROOT, 'apps', 'server'),
    env: {
      ...process.env,
      PORT: String(SERVER_PORT),
      CAIRN_HOME: HOME_DIR,
      CAIRN_SKILLS_DIR: SKILLS_DIR,
      CAIRN_AUTH: 'off',
      CAIRN_WEB_ORIGIN: `http://127.0.0.1:${WEB_PORT}`,
    },
    stdio: ['ignore', serverLog, serverLog],
  });
  writeFileSync(join(RUN_DIR, 'server.pid'), `${server.child.pid}\n`);

  const webLog = openSync(join(RUN_DIR, 'web.log'), 'a');
  const web = spawnOwned(
    process.execPath,
    [
      join('node_modules', 'vite', 'bin', 'vite.js'),
      '--port',
      String(WEB_PORT),
      '--strictPort',
      '--host',
      '127.0.0.1',
    ],
    {
      name: 'verify-web',
      cwd: join(ROOT, 'apps', 'web'),
      env: { ...process.env, CAIRN_DEV_SERVER_PORT: String(SERVER_PORT) },
      stdio: ['ignore', webLog, webLog],
    },
  );
  writeFileSync(join(RUN_DIR, 'web.pid'), `${web.child.pid}\n`);

  const stopStack = () => Promise.all([server.stop(), web.stop()]);
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    await stopStack();
    process.exit(0);
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'])
    process.once(signal, () => {
      void shutdown();
    });

  const tailOf = (name, lines = 30) => {
    const p = join(RUN_DIR, name);
    if (!existsSync(p)) return '(无输出)';
    return readFileSync(p, 'utf8').trim().split('\n').slice(-lines).join('\n');
  };

  const bail = async (msg) => {
    console.error(msg);
    console.error(`--- server.log 尾 ---\n${tailOf('server.log')}`);
    console.error(`--- web.log 尾 ---\n${tailOf('web.log')}`);
    await stopStack();
    process.exit(1);
  };

  const waitReady = async (url, label, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
        if (res.ok) return;
      } catch {

      }
      if (Date.now() > deadline) await bail(`${label} 未就绪:${url}`);
      await sleep(300);
    }
  };

  await waitReady(`http://127.0.0.1:${SERVER_PORT}/api/user/me`, 'server', 240_000);
  await waitReady(`http://127.0.0.1:${WEB_PORT}/app`, 'vite dev', 60_000);

  writeFileSync(
    join(RUN_DIR, 'ports.json'),
    JSON.stringify(
      {
        root: ROOT,
        serverPort: SERVER_PORT,
        webPort: WEB_PORT,
        homeDir: HOME_DIR,
        skillsDir: SKILLS_DIR,
        supervisorPid: process.pid,
        serverPid: server.child.pid,
        webPid: web.child.pid,
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  console.log('verify stack ready');
  console.log(`  web(驱动入口)  http://127.0.0.1:${WEB_PORT}/app`);
  console.log(`  api(server)     http://127.0.0.1:${SERVER_PORT}`);
  console.log(`  CAIRN_HOME     ${HOME_DIR}(全新库,seed 用户 Owner)`);
  console.log(`  技能目录        ${SKILLS_DIR}(scratch,空集起步;放技能见 features/skills-page.md)`);
  console.log(`  运行态          ${RUN_DIR}`);
  console.log(`  supervisor     pid ${process.pid}: the stack lives exactly as long as this process and its parent chain`);
  console.log('next:node scripts/doctor.mjs 体检 → node scripts/drive.mjs <probe>; stop with vp.mjs cleanup');
  console.log(
    `  lifetime       idle ${IDLE_TIMEOUT_MS / 60_000} min, max ${MAX_AGE_MS / 60_000} min (VERIFY_IDLE_TIMEOUT_MS, VERIFY_MAX_AGE_MS; 0 disables)`,
  );

  if (MAX_AGE_MS > 0) {
    const maxAge = setTimeout(() => {
      console.error(
        `栈已活 ${Math.round(MAX_AGE_MS / 60_000)} 分钟，到 VERIFY_MAX_AGE_MS 上限，自动停栈把 live-stack slot 让出来（仍在用就重开一次）`,
      );
      void shutdown();
    }, MAX_AGE_MS);
    maxAge.unref();
  }

  if (IDLE_TIMEOUT_MS > 0) {
    let lastActive = Date.now();
    const watcher = setInterval(() => {
      const busy = [SERVER_PORT, WEB_PORT].some((port) => {
        const probe = spawnSync('lsof', ['-nP', `-iTCP:${port}`], { encoding: 'utf8' });
        if (probe.error) return true;
        return (probe.stdout ?? '').split('\n').some((line) => line.includes('->'));
      });
      if (busy) {
        lastActive = Date.now();
        return;
      }
      if (Date.now() - lastActive < IDLE_TIMEOUT_MS) return;
      console.error(`${Math.round(IDLE_TIMEOUT_MS / 60_000)} 分钟无连接,自动停栈(VERIFY_IDLE_TIMEOUT_MS)`);
      void shutdown();
    }, 15_000);
    watcher.unref();
  }

  const ended = await Promise.race([
    server.exited.then(() => 'server'),
    web.exited.then(() => 'vite dev'),
  ]);
  if (stopping) return;
  console.error(`${ended} exited; stopping the whole stack`);
  await stopStack();
  process.exit(1);
}

await main();
