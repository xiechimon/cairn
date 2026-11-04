#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const SCRIPT_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const ROOT = process.env.VERIFY_REPO_ROOT
  ? resolve(process.env.VERIFY_REPO_ROOT)
  : SCRIPT_ROOT;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(ROOT, '.claude', 'verify-run');
const SERVER_PORT = Number(process.env.VERIFY_PORT ?? 8791);
const WEB_PORT = Number(process.env.VERIFY_WEB_PORT ?? 5273);
const HOME_DIR = join(RUN_DIR, 'home');
const SKILLS_DIR = join(HOME_DIR, 'skills');

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

function killGroup(pid) {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {

  }
}

async function main() {
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

  const portsFile = join(RUN_DIR, 'ports.json');
  if (existsSync(portsFile)) {
    try {
      const prev = JSON.parse(readFileSync(portsFile, 'utf8'));
      if (prev.serverPid != null && groupAlive(prev.serverPid)) {
        console.error(`栈已在跑(server pid ${prev.serverPid},ports.json 在 ${RUN_DIR})`);
        console.error('先 node scripts/cleanup.mjs 回收,或 doctor.mjs 体检');
        process.exit(1);
      }
    } catch {

    }
  }

  rmSync(RUN_DIR, { recursive: true, force: true });
  mkdirSync(HOME_DIR, { recursive: true });
  mkdirSync(SKILLS_DIR, { recursive: true });

  const serverLog = openSync(join(RUN_DIR, 'server.log'), 'a');
  const server = spawn('pnpm', ['exec', 'tsx', 'src/index.ts'], {
    cwd: join(ROOT, 'apps', 'server'),
    env: {
      ...process.env,
      PORT: String(SERVER_PORT),
      CAIRN_HOME: HOME_DIR,
      CAIRN_SKILLS_DIR: SKILLS_DIR,
    },
    detached: true,
    stdio: ['ignore', serverLog, serverLog],
  });
  writeFileSync(join(RUN_DIR, 'server.pid'), `${server.pid}\n`);

  server.unref();

  const webLog = openSync(join(RUN_DIR, 'web.log'), 'a');
  const web = spawn(
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
      cwd: join(ROOT, 'apps', 'web'),
      env: { ...process.env, CAIRN_DEV_SERVER_PORT: String(SERVER_PORT) },
      detached: true,
      stdio: ['ignore', webLog, webLog],
    },
  );
  writeFileSync(join(RUN_DIR, 'web.pid'), `${web.pid}\n`);
  web.unref();

  const tailOf = (name, lines = 30) => {
    const p = join(RUN_DIR, name);
    if (!existsSync(p)) return '(无输出)';
    return readFileSync(p, 'utf8').trim().split('\n').slice(-lines).join('\n');
  };

  const bail = (msg) => {
    console.error(msg);
    console.error(`--- server.log 尾 ---\n${tailOf('server.log')}`);
    console.error(`--- web.log 尾 ---\n${tailOf('web.log')}`);
    killGroup(server.pid);
    killGroup(web.pid);
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
      if (Date.now() > deadline) bail(`${label} 未就绪:${url}`);
      await sleep(300);
    }
  };

  await waitReady(`http://127.0.0.1:${SERVER_PORT}/api/auth/session`, 'server', 45_000);
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
        serverPid: server.pid,
        webPid: web.pid,
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
  console.log('next:node scripts/doctor.mjs 体检 → node scripts/drive.mjs <probe>');
}

await main();
