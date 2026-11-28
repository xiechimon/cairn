#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { homedir, networkInterfaces, tmpdir, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_TARGETS = new Set(['linux', 'windows', 'all']);
const VALID_SUITES = new Set(['all', 'runner', 'desktop']);
const DEFAULT_ORB_BIN = '/Applications/OrbStack.app/Contents/MacOS/bin/orb';
const DEFAULT_VMRUN_BIN = '/Applications/VMware Fusion.app/Contents/Library/vmrun';
const NODE_VERSION_LINUX = 'v24.14.0';
const PNPM_VERSION = '12.5.1';
const LOCK_WAIT_MS = 30 * 60_000;
const LOCK_POLL_MS = 2_000;
const GUEST_LOG_POLL_MS = 2_000;
const HTTP_CHUNK_BYTES = 1024 * 1024;
const HTTP_MAX_TRIES = 8;

const USAGE = `Usage: node scripts/ops/cross-os-test.mjs --target <linux|windows|all> [--sha <sha>] [options]

Options:
  --target <linux|windows|all>  Target platform(s) to run
  --sha <sha>                   Git commit SHA or ref to test (default: HEAD)
  --suite <all|runner|desktop>  Test suite scope (default: all)
  --ssh <host>                  Run remotely on host over SSH
  --repo-dir <path>             Repo checkout on runner host (default: ~/Code/cairn)
  --state-dir <path>            State/work/lock dir on runner host (default: ~/mt)
  --log-dir <path>              Log output directory (default: <state-dir>/logs)
  --orb-bin <path>              Path to OrbStack CLI
  --orb-machine <name>          OrbStack Linux machine name (default: dev)
  --vmrun-bin <path>            Path to VMware Fusion vmrun CLI
  --vmx <path>                  Path to Windows .vmx file (auto-detected if running)
  --win-guest-user <user>       Windows guest username (default: current OS user)
  --win-password-file <path>    Plaintext file or autounattend.xml with guest password
  --win-host-ip <ip>            Host IP reachable from Windows guest
  --help, -h                    Show help`;

const VALUE_FLAGS = new Map([
  ['--target', 'target'],
  ['--sha', 'sha'],
  ['--suite', 'suite'],
  ['--ssh', 'ssh'],
  ['--repo-dir', 'repoDir'],
  ['--local-repo-dir', 'localRepoDir'],
  ['--state-dir', 'stateDir'],
  ['--log-dir', 'logDir'],
  ['--orb-bin', 'orbBin'],
  ['--orb-machine', 'orbMachine'],
  ['--vmrun-bin', 'vmrunBin'],
  ['--vmx', 'vmx'],
  ['--win-guest-user', 'winGuestUser'],
  ['--win-password-file', 'winPasswordFile'],
  ['--win-host-ip', 'winHostIp'],
]);

export function parseArgs(argv, env = process.env) {
  const opts = {
    target: env.CROSS_OS_TARGET ?? '',
    sha: env.CROSS_OS_SHA ?? 'HEAD',
    suite: env.CROSS_OS_SUITE ?? 'all',
    ssh: env.CROSS_OS_SSH_HOST ?? '',
    repoDir: env.CROSS_OS_REPO_DIR ?? '',
    localRepoDir: '',
    stateDir: env.CROSS_OS_STATE_DIR ?? '',
    logDir: env.CROSS_OS_LOG_DIR ?? '',
    orbBin: env.CROSS_OS_ORB_BIN ?? DEFAULT_ORB_BIN,
    orbMachine: env.CROSS_OS_ORB_MACHINE ?? 'dev',
    vmrunBin: env.CROSS_OS_VMRUN_BIN ?? DEFAULT_VMRUN_BIN,
    vmx: env.CROSS_OS_WIN_VMX ?? '',
    winGuestUser: env.CROSS_OS_WIN_GUEST_USER ?? '',
    winPasswordFile: env.CROSS_OS_WIN_PASSWORD_FILE ?? '',
    winHostIp: env.CROSS_OS_WIN_HOST_IP ?? '',
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
      return opts;
    }
    const key = VALUE_FLAGS.get(arg);
    if (!key) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`);
    }
    opts[key] = value;
    i += 1;
  }

  if (!opts.target) {
    throw new Error('Missing required --target <linux|windows|all>');
  }
  if (!VALID_TARGETS.has(opts.target)) {
    throw new Error(
      `Invalid --target ${JSON.stringify(opts.target)}; expected linux, windows, or all`,
    );
  }
  if (!VALID_SUITES.has(opts.suite)) {
    throw new Error(
      `Invalid --suite ${JSON.stringify(opts.suite)}; expected all, runner, or desktop`,
    );
  }
  return opts;
}

export function parseUnattendPassword(content, username) {
  const text = String(content ?? '');
  if (!text.includes('<')) {
    const line = text
      .split(/\r?\n/u)
      .map((entry) => entry.trim())
      .find(Boolean);
    if (!line) throw new Error(`Cannot read Windows guest password for user ${username}`);
    return line;
  }
  const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `<Username>\\s*${escaped}\\s*</Username>\\s*<Password>\\s*<Value>([^<]+)</Value>`,
    'is',
  );
  const match = pattern.exec(text);
  if (!match?.[1]) {
    throw new Error(`Cannot read Windows guest password for user ${username} from unattend XML`);
  }
  return match[1];
}

export function buildLinuxSuiteCommands(suite) {
  const cmds = ['pnpm install --frozen-lockfile --ignore-scripts --store-dir /mtwork/pnpm-store'];
  if (suite === 'runner' || suite === 'all') {
    cmds.push('CAIRN_MINI_TEST=1 pnpm --filter @xiechimon/cairn-cli test');
  }
  if (suite === 'desktop' || suite === 'all') {
    cmds.push('CAIRN_MINI_TEST=1 pnpm exec vitest run --project @cairn/desktop');
  }
  return cmds;
}

export function buildWindowsSuiteCommands(suite) {
  const cmds = [
    'set "CAIRN_HEAVY_GATE_BYPASS=mini-test"',
    'set "CAIRN_MINI_TEST=1"',
    'call pnpm install --frozen-lockfile --ignore-scripts',
  ];
  if (suite === 'runner' || suite === 'all') {
    cmds.push('call pnpm --filter @xiechimon/cairn-cli test');
  }
  if (suite === 'desktop' || suite === 'all') {
    cmds.push('call pnpm exec vitest run --project @cairn/desktop');
  }
  return cmds;
}

export function resolveWindowsVmx(explicitVmx, vmrunListOutput) {
  if (explicitVmx?.trim()) return explicitVmx.trim();
  const lines = String(vmrunListOutput ?? '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.vmx'));
  const found = lines.find((line) => /windows/i.test(line));
  if (!found) {
    throw new Error(
      'No running Windows VMware Fusion VM found; start the Windows ARM64 VM or pass --vmx <path>',
    );
  }
  return found;
}

function defaultExec(cmd, args, opts = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      opts.onStdout?.(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      opts.onStderr?.(chunk);
    });
    child.once('error', (error) => {
      resolvePromise({ status: 1, stdout, stderr: `${stderr}\n${error.message}`.trim() });
    });
    child.once('close', (code) => {
      resolvePromise({ status: code ?? 1, stdout, stderr });
    });
    if (opts.input !== undefined) {
      child.stdin.end(opts.input);
    } else {
      child.stdin.end();
    }
  });
}

function defaultIsPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

function sleep(ms) {
  return new Promise((wake) => setTimeout(wake, ms));
}

async function acquireTargetLock(
  stateDir,
  target,
  { isPidAlive = defaultIsPidAlive, now = Date.now } = {},
) {
  const lockRoot = join(stateDir, 'locks');
  mkdirSync(lockRoot, { recursive: true });
  const lockDir = join(lockRoot, `cross-os-${target}.lock`);
  const deadline = now() + LOCK_WAIT_MS;
  while (true) {
    try {
      mkdirSync(lockDir);
      writeFileSync(join(lockDir, 'owner'), `${process.pid} ${now()}\n`);
      return () => {
        rmSync(lockDir, { recursive: true, force: true });
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let ownerPid = 0;
      try {
        const text = readFileSync(join(lockDir, 'owner'), 'utf8');
        ownerPid = Number(text.trim().split(/\s+/)[0]) || 0;
      } catch {}
      if (ownerPid > 0 && !isPidAlive(ownerPid)) {
        rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      if (now() >= deadline) {
        throw new Error(`Timed out waiting for lock ${lockDir} (owner pid ${ownerPid})`);
      }
      await sleep(LOCK_POLL_MS);
    }
  }
}

function stampString(nowMs) {
  const d = new Date(nowMs);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

function shellQuote(arg) {
  return `'${String(arg).replaceAll("'", `'\\''`)}'`;
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function materializeSymlinks(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const st = lstatSync(full);
    if (st.isSymbolicLink()) {
      const target = readlinkSync(full);
      rmSync(full, { force: true });
      writeFileSync(full, target, 'utf8');
    } else if (st.isDirectory()) {
      materializeSymlinks(full);
    }
  }
}

function ipToInt(ip) {
  return ip.split('.').reduce((acc, oct) => ((acc << 8) | Number(oct)) >>> 0, 0);
}

function detectHostIpForGuest(guestIp, explicitIp) {
  if (explicitIp) return explicitIp;
  const ifaces = networkInterfaces();
  const candidates = [];
  for (const [name, entries] of Object.entries(ifaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        candidates.push({ name, address: entry.address, netmask: entry.netmask });
      }
    }
  }
  if (guestIp) {
    const guestInt = ipToInt(guestIp);
    const match = candidates.find((c) => {
      const maskInt = ipToInt(c.netmask);
      return (ipToInt(c.address) & maskInt) === (guestInt & maskInt);
    });
    if (match) return match.address;
  }
  const bridge = candidates.find((c) => /^(?:bridge|vmnet)/i.test(c.name));
  if (bridge) return bridge.address;
  if (candidates.length > 0) return candidates[0].address;
  throw new Error('Cannot determine host IPv4 address for Windows VM; pass --win-host-ip <ip>');
}

function resolvePasswordFile(explicitPath, homeDir) {
  if (explicitPath) return explicitPath;
  const passFile = join(homeDir, '.config', 'cairn', 'cross-os-win.pass');
  if (existsSync(passFile)) return passFile;
  return join(homeDir, 'ISOs', 'unattend_src', 'autounattend.xml');
}

async function resolveShaInRepo(repoDir, shaInput, exec) {
  const res = await exec('git', ['-C', repoDir, 'rev-parse', '--verify', `${shaInput}^{commit}`]);
  if (res.status !== 0) {
    throw new Error(`Commit ${shaInput} not found in ${repoDir}: ${res.stderr.trim()}`);
  }
  return res.stdout.trim();
}

async function ensureShaInHostRepo(repoDir, shaInput, exec, logLine) {
  const check = await exec('git', ['-C', repoDir, 'rev-parse', '--verify', `${shaInput}^{commit}`]);
  if (check.status === 0) return check.stdout.trim();
  logLine(`[cross-os] fetching ${shaInput} in ${repoDir}`);
  await exec('git', ['-C', repoDir, 'fetch', '--quiet', 'origin']);
  await exec('git', ['-C', repoDir, 'fetch', '--quiet', 'origin', shaInput]);
  return resolveShaInRepo(repoDir, shaInput, exec);
}

async function runViaSsh(opts, deps) {
  const exec = deps.exec ?? defaultExec;
  const stdout = deps.stdout ?? ((line) => console.log(line));
  const localRepo = opts.localRepoDir || resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const remoteRepo = opts.repoDir || '$HOME/Code/cairn';
  const remoteState = opts.stateDir || '$HOME/mt';

  let resolvedSha = opts.sha;
  let localHasSha = false;
  if (existsSync(join(localRepo, '.git'))) {
    const rev = await exec('git', [
      '-C',
      localRepo,
      'rev-parse',
      '--verify',
      `${opts.sha}^{commit}`,
    ]);
    if (rev.status === 0) {
      resolvedSha = rev.stdout.trim();
      localHasSha = true;
    }
  }

  const remotePathExpr = (raw) =>
    raw.startsWith('$HOME/') ? `"$HOME"/${shellQuote(raw.slice(6))}` : shellQuote(raw);

  const hasRemoteSha = await exec('ssh', [
    '-o',
    'BatchMode=yes',
    '-o',
    'ServerAliveInterval=15',
    opts.ssh,
    `REPO=${remotePathExpr(remoteRepo)}; git -C "$REPO" cat-file -e ${shellQuote(`${resolvedSha}^{commit}`)} 2>/dev/null && echo OK || true`,
  ]);

  if (!hasRemoteSha.stdout.includes('OK')) {
    const fetchOrigin = await exec('ssh', [
      '-o',
      'BatchMode=yes',
      '-o',
      'ServerAliveInterval=15',
      opts.ssh,
      `REPO=${remotePathExpr(remoteRepo)}; git -C "$REPO" fetch --quiet origin && git -C "$REPO" fetch --quiet origin ${shellQuote(resolvedSha)} 2>/dev/null; git -C "$REPO" cat-file -e ${shellQuote(`${resolvedSha}^{commit}`)} 2>/dev/null && echo OK || true`,
    ]);
    if (!fetchOrigin.stdout.includes('OK')) {
      if (!localHasSha) {
        throw new Error(`Commit ${resolvedSha} is missing on ${opts.ssh} and in ${localRepo}`);
      }
      const bundleTmp = join(tmpdir(), `cross-os-bundle-${process.pid}`);
      mkdirSync(bundleTmp, { recursive: true });
      const bundlePath = join(bundleTmp, 'in.bundle');
      try {
        const baseRes = await exec('git', [
          '-C',
          localRepo,
          'merge-base',
          resolvedSha,
          'origin/main',
        ]);
        const base = baseRes.status === 0 ? baseRes.stdout.trim() : '';
        const bundleArgs =
          base && base !== resolvedSha
            ? ['-C', localRepo, 'bundle', 'create', bundlePath, resolvedSha, '--not', base]
            : ['-C', localRepo, 'bundle', 'create', bundlePath, resolvedSha];
        const bRes = await exec('git', bundleArgs);
        if (bRes.status !== 0) {
          throw new Error(`git bundle failed: ${bRes.stderr.trim()}`);
        }
        const remoteBundle = `cross-os-${resolvedSha.slice(0, 9)}-${process.pid}.bundle`;
        await exec('ssh', [
          '-o',
          'BatchMode=yes',
          opts.ssh,
          `STATE=${remotePathExpr(remoteState)}; mkdir -p "$STATE/in"`,
        ]);
        const scpRes = await exec('scp', [
          '-o',
          'BatchMode=yes',
          bundlePath,
          `${opts.ssh}:${remoteState.replace(/^\$HOME/, '~')}/in/${remoteBundle}`,
        ]);
        if (scpRes.status !== 0) {
          throw new Error(`scp bundle failed: ${scpRes.stderr.trim()}`);
        }
        const fetchRes = await exec('ssh', [
          '-o',
          'BatchMode=yes',
          opts.ssh,
          `REPO=${remotePathExpr(remoteRepo)}; STATE=${remotePathExpr(remoteState)}; git -C "$REPO" fetch --quiet "$STATE/in/${remoteBundle}" ${shellQuote(`${resolvedSha}:refs/cross-os/${resolvedSha}`)}; rm -f "$STATE/in/${remoteBundle}"`,
        ]);
        if (fetchRes.status !== 0) {
          throw new Error(`remote bundle fetch failed: ${fetchRes.stderr.trim()}`);
        }
      } finally {
        rmSync(bundleTmp, { recursive: true, force: true });
      }
    }
  }

  const forwarded = ['--target', opts.target, '--sha', resolvedSha, '--suite', opts.suite];
  if (opts.repoDir) forwarded.push('--repo-dir', opts.repoDir);
  if (opts.stateDir) forwarded.push('--state-dir', opts.stateDir);
  if (opts.logDir) forwarded.push('--log-dir', opts.logDir);
  if (opts.orbBin !== DEFAULT_ORB_BIN) forwarded.push('--orb-bin', opts.orbBin);
  if (opts.orbMachine !== 'dev') forwarded.push('--orb-machine', opts.orbMachine);
  if (opts.vmrunBin !== DEFAULT_VMRUN_BIN) forwarded.push('--vmrun-bin', opts.vmrunBin);
  if (opts.vmx) forwarded.push('--vmx', opts.vmx);
  if (opts.winGuestUser) forwarded.push('--win-guest-user', opts.winGuestUser);
  if (opts.winPasswordFile) forwarded.push('--win-password-file', opts.winPasswordFile);
  if (opts.winHostIp) forwarded.push('--win-host-ip', opts.winHostIp);

  const localScript = fileURLToPath(import.meta.url);
  const stageName = `cross-os-test-${process.pid}.mjs`;
  const remoteFlags = forwarded.map(shellQuote).join(' ');
  const remoteRunner = [
    `REPO=${remotePathExpr(remoteRepo)}`,
    `STATE=${remotePathExpr(remoteState)}`,
    'mkdir -p "$STATE/bin"',
    `if git -C "$REPO" cat-file -e ${shellQuote(`${resolvedSha}:scripts/ops/cross-os-test.mjs`)} 2>/dev/null; then`,
    `  git -C "$REPO" show ${shellQuote(`${resolvedSha}:scripts/ops/cross-os-test.mjs`)} > "$STATE/bin/${stageName}"`,
    `elif [ -f "$REPO/scripts/ops/cross-os-test.mjs" ]; then`,
    `  cp "$REPO/scripts/ops/cross-os-test.mjs" "$STATE/bin/${stageName}"`,
    'fi',
    'export PATH="$HOME/.local/bin:$PATH"',
    'command -v fnm >/dev/null 2>&1 && eval "$(fnm env --shell bash)"',
    `node "$STATE/bin/${stageName}" ${remoteFlags}`,
    'RC=$?',
    `rm -f "$STATE/bin/${stageName}"`,
    'exit $RC',
  ].join('\n');

  if (existsSync(localScript)) {
    await exec('ssh', [
      '-o',
      'BatchMode=yes',
      opts.ssh,
      `STATE=${remotePathExpr(remoteState)}; mkdir -p "$STATE/bin"`,
    ]);
    await exec('scp', [
      '-o',
      'BatchMode=yes',
      localScript,
      `${opts.ssh}:${remoteState.replace(/^\$HOME/, '~')}/bin/${stageName}`,
    ]);
  }

  const res = await exec(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ServerAliveInterval=15', opts.ssh, 'bash -s'],
    {
      input: remoteRunner,
      onStdout: (chunk) => process.stdout.write(chunk),
      onStderr: (chunk) => process.stderr.write(chunk),
    },
  );
  if (!deps.onStream && res.stdout && res.stdout.trim() && !res.stdout.includes('target=')) {
    stdout(res.stdout.trim());
  }
  return { exitCode: res.status, results: [], remoteStdout: res.stdout };
}

async function execLogged(exec, cmd, args, opts, logLine) {
  let streamed = false;
  const res = await exec(cmd, args, {
    ...opts,
    onStdout: (chunk) => {
      streamed = true;
      logLine(chunk, true);
    },
    onStderr: (chunk) => {
      streamed = true;
      logLine(chunk, true);
    },
  });
  if (!streamed) {
    if (res.stdout) logLine(res.stdout, true);
    if (res.stderr) logLine(res.stderr, true);
  }
  return res;
}

async function runLinuxTarget(opts, sha, ctx) {
  const { exec, logLine, now } = ctx;
  const startMs = now();
  const repoDir = opts.repoDir;
  const orbBin = opts.orbBin;
  const machine = opts.orbMachine;
  const runName = `cross-os-${sha.slice(0, 9)}-${process.pid}`;
  const vrun = `/mtwork/runs/${runName}`;
  const vrepo = '/mtwork/cairn';

  if (!existsSync(orbBin)) {
    throw new Error(`OrbStack CLI not found at ${orbBin}`);
  }
  const listRes = await exec(orbBin, ['list']);
  if (listRes.status !== 0) {
    throw new Error(`orb list failed: ${listRes.stderr.trim()}`);
  }
  const machineLine = listRes.stdout
    .split(/\r?\n/u)
    .find((line) => line.trim().split(/\s+/)[0] === machine);
  if (!machineLine) {
    throw new Error(`OrbStack machine ${JSON.stringify(machine)} not found`);
  }
  if (!/\brunning\b/.test(machineLine)) {
    logLine(`[cross-os] starting OrbStack machine ${machine}`);
    const startRes = await exec(orbBin, ['start', machine]);
    if (startRes.status !== 0) {
      throw new Error(`Failed to start OrbStack machine ${machine}: ${startRes.stderr.trim()}`);
    }
  }

  const seedScript = [
    'set -e',
    'sudo -n mkdir -p /mtwork/runs /mtwork/pnpm-store',
    'sudo -n chown -R "$(id -un):$(id -gn)" /mtwork',
    'if ! command -v git >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1 || ! command -v fish >/dev/null 2>&1 || ! command -v zsh >/dev/null 2>&1 || ! command -v bwrap >/dev/null 2>&1 || ! command -v zip >/dev/null 2>&1 || ! command -v unzip >/dev/null 2>&1 || ! command -v sqlite3 >/dev/null 2>&1 || ! command -v gh >/dev/null 2>&1; then',
    '  sudo -n apt-get update -qq',
    '  sudo -n apt-get install -y -qq --no-install-recommends git curl fish zsh bubblewrap zip unzip sqlite3 gh',
    'fi',
    `[ -d ${vrepo}/.git ] || git clone --quiet ${shellQuote(repoDir)} ${vrepo}`,
    `if [ "$("$HOME/mt/node/bin/node" -v 2>/dev/null || true)" != ${shellQuote(NODE_VERSION_LINUX)} ]; then`,
    '  mkdir -p "$HOME/mt"',
    '  NODE_TMP=$(mktemp -d "$HOME/mt/node-dl.XXXXXX")',
    `  curl -fsSL -o "$NODE_TMP/node.tar.gz" --max-time 300 https://nodejs.org/dist/${NODE_VERSION_LINUX}/node-${NODE_VERSION_LINUX}-linux-arm64.tar.gz`,
    '  tar -xzf "$NODE_TMP/node.tar.gz" -C "$NODE_TMP"',
    '  rm -rf "$HOME/mt/node.old"',
    '  [ -e "$HOME/mt/node" ] && mv "$HOME/mt/node" "$HOME/mt/node.old"',
    `  mv "$NODE_TMP/node-${NODE_VERSION_LINUX}-linux-arm64" "$HOME/mt/node"`,
    '  rm -rf "$HOME/mt/node.old" "$NODE_TMP"',
    'fi',
    'mkdir -p "$HOME/mt/bin"',
    'export PATH="$HOME/mt/bin:$HOME/mt/node/bin:$PATH"',
    'if ! command -v pnpm >/dev/null 2>&1; then',
    '  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0',
    `  npm install -g --silent pnpm@${PNPM_VERSION} || { corepack enable --install-directory "$HOME/mt/bin" && corepack prepare pnpm@${PNPM_VERSION} --activate; }`,
    'fi',
  ].join('\n');

  logLine(`[cross-os] ensuring Linux toolchain in OrbStack ${machine}`);
  const seedRes = await execLogged(
    exec,
    orbBin,
    ['-m', machine, 'bash', '-s'],
    { input: seedScript },
    logLine,
  );
  if (seedRes.status !== 0) {
    throw new Error(`Linux VM bootstrap failed (exit ${seedRes.status})`);
  }

  const fetchScript = [
    'set -e',
    `git -C ${vrepo} fetch --quiet ${shellQuote(repoDir)} ${shellQuote(`${sha}:refs/cross-os/${sha}`)} 2>/dev/null || git -C ${vrepo} fetch --quiet ${shellQuote(repoDir)}`,
    `rm -rf ${shellQuote(vrun)}`,
    `git -C ${vrepo} worktree add --detach --force ${shellQuote(vrun)} ${shellQuote(sha)}`,
  ].join('\n');

  logLine(`[cross-os] preparing Linux worktree ${vrun} at ${sha}`);
  const fetchRes = await execLogged(
    exec,
    orbBin,
    ['-m', machine, 'bash', '-s'],
    { input: fetchScript },
    logLine,
  );
  if (fetchRes.status !== 0) {
    throw new Error(`Linux VM worktree setup failed (exit ${fetchRes.status})`);
  }

  let runStatus = 1;
  try {
    const suiteCommands = buildLinuxSuiteCommands(opts.suite);
    const runScript = [
      'set -e',
      'export PATH="$HOME/mt/bin:$HOME/mt/node/bin:$PATH"',
      'export COREPACK_ENABLE_DOWNLOAD_PROMPT=0',
      'export PNPM_STORE_DIR=/mtwork/pnpm-store',
      `cd ${shellQuote(vrun)}`,
      ...suiteCommands,
    ].join('\n');
    logLine(`[cross-os] running Linux suite=${opts.suite} sha=${sha}`);
    const runRes = await execLogged(
      exec,
      orbBin,
      ['-m', machine, 'bash', '-s'],
      { input: runScript },
      logLine,
    );
    runStatus = runRes.status;
  } finally {
    const cleanupScript = [
      `for proc in /proc/[0-9]*; do`,
      `  cwd=$(readlink "$proc/cwd" 2>/dev/null) || continue`,
      `  case "\${cwd% (deleted)}" in ${shellQuote(vrun)}|${shellQuote(`${vrun}/`)}*) kill -KILL "\${proc#/proc/}" 2>/dev/null ;; esac`,
      `done`,
      `git -C ${vrepo} worktree remove --force ${shellQuote(vrun)} 2>/dev/null || rm -rf ${shellQuote(vrun)} 2>/dev/null || true`,
      `git -C ${vrepo} worktree prune 2>/dev/null || true`,
    ].join('\n');
    await exec(orbBin, ['-m', machine, 'bash', '-s'], { input: cleanupScript });
  }

  return {
    exitCode: runStatus,
    durationSec: Math.max(0, Math.round((now() - startMs) / 1000)),
  };
}

function buildFetchHelperSource() {
  return [
    "const http = require('http'), fs = require('fs'), c = require('crypto');",
    'const [url, dest, want] = process.argv.slice(2);',
    `const CHUNK = ${HTTP_CHUNK_BYTES}, MAX_TRIES = ${HTTP_MAX_TRIES};`,
    'const get = (pos) => new Promise((resolve, reject) => {',
    "  const req = http.get(url, { headers: { Range: 'bytes=' + pos + '-' + (pos + CHUNK - 1) } }, (r) => {",
    "    r.setTimeout(15000, () => req.destroy(new Error('stalled')));",
    '    const chunks = [];',
    "    r.on('data', (d) => chunks.push(d));",
    "    r.on('end', () => resolve({ status: r.statusCode, total: Number((r.headers['content-range'] || '/0').split('/')[1]), body: Buffer.concat(chunks) }));",
    "    r.on('error', reject);",
    "    r.on('aborted', () => reject(new Error('aborted')));",
    '  });',
    "  req.on('error', reject);",
    "  req.setTimeout(30000, () => req.destroy(new Error('timeout')));",
    '});',
    '(async () => {',
    '  let pos = 0, total = Infinity, tries = 0;',
    "  const h = c.createHash('sha256'), w = fs.createWriteStream(dest);",
    '  while (pos < total) {',
    '    try {',
    '      const r = await get(pos);',
    "      if (r.status !== 206 && !(r.status === 200 && pos === 0)) throw new Error('status ' + r.status);",
    "      if (r.body.length === 0) throw new Error('empty body');",
    '      h.update(r.body); w.write(r.body);',
    '      pos += r.body.length; total = r.total || r.body.length; tries = 0;',
    '    } catch (e) {',
    '      if (++tries > MAX_TRIES) { w.destroy(); process.exit(3); }',
    '      await new Promise((s) => setTimeout(s, 1000));',
    '    }',
    '  }',
    '  w.end(() => {',
    "    const digest = h.digest('hex');",
    "    console.error('fetch pos=' + pos + ' total=' + total + ' digest=' + digest);",
    '    process.exit(pos === total && digest === want ? 0 : 1);',
    '  });',
    '})();',
  ].join('\n');
}

function startRangePayloadServer(files, hostIp) {
  const server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    const filePath = files[path];
    if (!filePath || !existsSync(filePath)) {
      res.writeHead(404).end();
      return;
    }
    const stat = statSync(filePath);
    const match = /^bytes=(\d+)-(\d+)?$/i.exec(req.headers.range ?? '');
    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
      res.writeHead(206, {
        'content-length': end - start + 1,
        'content-range': `bytes ${start}-${end}/${stat.size}`,
      });
      createReadStream(filePath, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { 'content-length': stat.size });
    createReadStream(filePath).pipe(res);
  });
  return new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(0, hostIp, () => {
      const addr = server.address();
      resolvePromise({
        port: typeof addr === 'object' && addr ? addr.port : 0,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

async function runWindowsTarget(opts, sha, ctx) {
  const { exec, homeDir, logLine, now } = ctx;
  const startMs = now();
  const vmrunBin = opts.vmrunBin;
  const guestUser = opts.winGuestUser || userInfo().username;
  if (!existsSync(vmrunBin)) {
    throw new Error(`VMware Fusion vmrun not found at ${vmrunBin}`);
  }
  const listRes = await exec(vmrunBin, ['list']);
  if (listRes.status !== 0) {
    throw new Error(`vmrun list failed: ${listRes.stderr.trim()}`);
  }
  const vmx = resolveWindowsVmx(opts.vmx, listRes.stdout);
  const pwFile = resolvePasswordFile(opts.winPasswordFile, homeDir);
  if (!existsSync(pwFile)) {
    throw new Error(`Windows guest password file not found at ${pwFile}`);
  }
  const password = parseUnattendPassword(readFileSync(pwFile, 'utf8'), guestUser);
  const gop = (...args) =>
    exec(vmrunBin, [
      '-T',
      'fusion',
      '-gu',
      guestUser,
      '-gp',
      password,
      args[0],
      vmx,
      ...args.slice(1),
    ]);

  const gmt = `C:\\Users\\${guestUser}\\mt`;
  const toolRes = await gop(
    'runProgramInGuest',
    'C:\\Windows\\System32\\cmd.exe',
    `/c if not exist ${gmt}\\node\\node.exe (exit /b 3) else if not exist ${gmt}\\node\\pnpm.cmd (exit /b 4) else exit /b 0`,
  );
  if (toolRes.status !== 0) {
    throw new Error(`Windows guest toolchain missing under ${gmt}\\node (exit ${toolRes.status})`);
  }

  let guestIp = '';
  const ipRes = await gop('getGuestIPAddress');
  if (ipRes.status === 0) {
    guestIp = ipRes.stdout.trim();
  }
  const hostIp = detectHostIpForGuest(guestIp, opts.winHostIp);

  const jid = `j${process.pid}${Math.floor(Math.random() * 10000)}`;
  const gwork = `${gmt}\\cross-os-work\\${sha.slice(0, 9)}-${jid}`;
  const gjob = `${gmt}\\jobs\\cross-os-${jid}.cmd`;
  const glog = `${gmt}\\logs\\cross-os-${jid}.log`;
  const gouter = `${gmt}\\logs\\cross-os-${jid}-outer.log`;
  const gsrc = `${gmt}\\in\\src-${sha.slice(0, 9)}-${jid}.tgz`;

  const jobDir = join(tmpdir(), `cross-os-win-${process.pid}-${jid}`);
  mkdirSync(join(jobDir, 'tree'), { recursive: true });
  let payloadServer = null;
  let runStatus = 1;
  try {
    const tarArchive = join(jobDir, 'src.tar');
    const arcRes = await exec('git', [
      '-C',
      opts.repoDir,
      'archive',
      '--format=tar',
      '-o',
      tarArchive,
      sha,
    ]);
    if (arcRes.status !== 0) {
      throw new Error(`git archive failed: ${arcRes.stderr.trim()}`);
    }
    const untarRes = await exec('tar', ['-xf', tarArchive, '-C', join(jobDir, 'tree')]);
    if (untarRes.status !== 0) {
      throw new Error(`tar extract failed: ${untarRes.stderr.trim()}`);
    }
    materializeSymlinks(join(jobDir, 'tree'));
    const srcTgz = join(jobDir, 'src.tgz');
    const packRes = await exec('tar', ['-czf', srcTgz, '-C', join(jobDir, 'tree'), '.']);
    if (packRes.status !== 0) {
      throw new Error(`tar pack failed: ${packRes.stderr.trim()}`);
    }

    const cmdLines = buildWindowsSuiteCommands(opts.suite);
    const gatedLines = [];
    let gateCode = 10;
    for (const line of cmdLines) {
      gatedLines.push(`${line} >> "%MTLOG%" 2>&1`);
      gatedLines.push(`if errorlevel 1 exit /b ${gateCode}`);
      gateCode += 1;
    }

    const jobScript = [
      '@echo off',
      `set "PATH=${gmt}\\node;${gmt}\\bin;C:\\Windows\\System32;C:\\Windows"`,
      'set "COREPACK_ENABLE_DOWNLOAD_PROMPT=0"',
      `set "MTLOG=${glog}"`,
      `if not exist "${gmt}\\cross-os-work" mkdir "${gmt}\\cross-os-work"`,
      `if not exist "${gwork}" mkdir "${gwork}"`,
      `cd /d "${gwork}"`,
      `tar.exe -xzf "${gsrc}" > "%MTLOG%" 2>&1`,
      'if errorlevel 1 exit /b 2',
      ...gatedLines,
      'exit /b 0',
      '',
    ].join('\r\n');
    const jobFile = join(jobDir, 'job.cmd');
    writeFileSync(jobFile, jobScript, 'utf8');

    const fetchFile = join(jobDir, 'fetch.js');
    writeFileSync(fetchFile, buildFetchHelperSource(), 'utf8');
    let helperReady = false;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await gop('copyFileFromHostToGuest', fetchFile, `${gmt}\\in\\fetch.js`);
      const verify = await gop(
        'runProgramInGuest',
        'C:\\Windows\\System32\\cmd.exe',
        `/c if exist ${gmt}\\in\\fetch.js (exit /b 0) else exit /b 1`,
      );
      if (verify.status === 0) {
        helperReady = true;
        break;
      }
      await sleep(2_000);
    }
    if (!helperReady) {
      throw new Error('Failed to copy fetch.js helper to Windows guest');
    }

    payloadServer = await startRangePayloadServer({ '/src': srcTgz, '/job': jobFile }, hostIp);
    const srcSha = sha256File(srcTgz);
    const jobSha = sha256Text(jobScript);
    const fetchUrlBase = `http://${hostIp}:${payloadServer.port}`;

    logLine(`[cross-os] transferring Windows payload sha=${sha} via ${fetchUrlBase}`);
    for (const [route, dest, want] of [
      ['/src', gsrc.replaceAll('\\', '/'), srcSha],
      ['/job', gjob.replaceAll('\\', '/'), jobSha],
    ]) {
      let ok = false;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const res = await gop(
          'runProgramInGuest',
          'C:\\Windows\\System32\\cmd.exe',
          `/c ${gmt}\\node\\node.exe ${gmt}\\in\\fetch.js ${fetchUrlBase}${route} ${dest} ${want} > ${gmt}\\in\\fetch.log 2>&1`,
        );
        if (res.status === 0) {
          ok = true;
          break;
        }
        await sleep(2_000);
      }
      if (!ok) {
        const flog = join(jobDir, 'fetch.log');
        await gop('copyFileFromGuestToHost', `${gmt}\\in\\fetch.log`, flog);
        const detail = existsSync(flog) ? readFileSync(flog, 'utf8') : '';
        throw new Error(`Windows guest fetch failed for ${route}: ${detail.trim()}`);
      }
    }
    await payloadServer.close();
    payloadServer = null;

    logLine(`[cross-os] running Windows suite=${opts.suite} sha=${sha} vmx=${vmx}`);
    let seenBytes = 0;
    const localGuestLog = join(jobDir, 'guest.log');
    const syncGuestLog = async () => {
      const cpRes = await gop('copyFileFromGuestToHost', glog, localGuestLog);
      if (cpRes.status !== 0 || !existsSync(localGuestLog)) return;
      const buf = readFileSync(localGuestLog);
      if (buf.length > seenBytes) {
        logLine(buf.subarray(seenBytes).toString('utf8'), true);
        seenBytes = buf.length;
      }
    };

    let finished = false;
    const guestPromise = gop(
      'runProgramInGuest',
      'C:\\Windows\\System32\\cmd.exe',
      `/c call ${gjob} > ${gouter} 2>&1`,
    ).then((res) => {
      finished = true;
      return res;
    });

    while (!finished) {
      await sleep(GUEST_LOG_POLL_MS);
      await syncGuestLog();
    }
    const guestRes = await guestPromise;
    await syncGuestLog();

    const localOuter = join(jobDir, 'outer.log');
    const outerRes = await gop('copyFileFromGuestToHost', gouter, localOuter);
    if (outerRes.status === 0 && existsSync(localOuter)) {
      const outerText = readFileSync(localOuter, 'utf8').trim();
      if (outerText) logLine(outerText);
    }
    runStatus = guestRes.status;
  } finally {
    if (payloadServer) await payloadServer.close().catch(() => {});
    await gop(
      'runProgramInGuest',
      'C:\\Windows\\System32\\cmd.exe',
      `/c rmdir /s /q "${gwork}" >nul 2>&1 & del /q "${gsrc}" "${gjob}" "${glog}" "${gouter}" >nul 2>&1`,
    ).catch(() => {});
    rmSync(jobDir, { recursive: true, force: true });
  }

  return {
    exitCode: runStatus,
    durationSec: Math.max(0, Math.round((now() - startMs) / 1000)),
  };
}

export async function runCrossOs(rawOpts, deps = {}) {
  const exec = deps.exec ?? defaultExec;
  const now = deps.now ?? Date.now;
  const isPidAlive = deps.isPidAlive ?? defaultIsPidAlive;
  const stdout = deps.stdout ?? ((line) => console.log(line));

  if (rawOpts.ssh) {
    return runViaSsh(rawOpts, deps);
  }

  const homeDir = deps.homeDir ?? homedir();
  const repoDir = rawOpts.repoDir || join(homeDir, 'Code', 'cairn');
  const stateDir = rawOpts.stateDir || join(homeDir, 'mt');
  const logDir = rawOpts.logDir || join(stateDir, 'logs');
  mkdirSync(logDir, { recursive: true });

  const resolvedOpts = { ...rawOpts, repoDir, stateDir, logDir };
  const sha = await ensureShaInHostRepo(repoDir, rawOpts.sha, exec, () => {});
  const targets = rawOpts.target === 'all' ? ['linux', 'windows'] : [rawOpts.target];
  const results = [];
  let overallExit = 0;

  for (const target of targets) {
    const stamp = stampString(now());
    const logPath = join(logDir, `cross-os-${target}-${sha.slice(0, 9)}-${stamp}.log`);
    writeFileSync(
      logPath,
      `[cross-os] target=${target} sha=${sha} suite=${resolvedOpts.suite} started=${new Date(now()).toISOString()}\n`,
      'utf8',
    );
    const logLine = (text, raw = false) => {
      const out = raw ? text : `${text}\n`;
      appendFileSync(logPath, out, 'utf8');
    };

    const startMs = now();
    let releaseLock = null;
    let outcome = { exitCode: 1, durationSec: 0 };
    try {
      releaseLock = await acquireTargetLock(stateDir, target, { isPidAlive, now });
      const ctx = { exec, homeDir, logLine, now };
      outcome =
        target === 'linux'
          ? await runLinuxTarget(resolvedOpts, sha, ctx)
          : await runWindowsTarget(resolvedOpts, sha, ctx);
    } catch (error) {
      logLine(`[cross-os] ERROR: ${error instanceof Error ? error.message : String(error)}`);
      outcome = {
        exitCode: 1,
        durationSec: Math.max(0, Math.round((now() - startMs) / 1000)),
      };
    } finally {
      releaseLock?.();
    }

    const ok = outcome.exitCode === 0;
    if (!ok && overallExit === 0) overallExit = outcome.exitCode || 1;
    const summary = ok
      ? `PASS target=${target} sha=${sha} suite=${resolvedOpts.suite} duration=${outcome.durationSec}s log=${logPath}`
      : `FAIL target=${target} sha=${sha} suite=${resolvedOpts.suite} exit=${outcome.exitCode} duration=${outcome.durationSec}s log=${logPath}`;
    logLine(summary);
    stdout(summary);
    results.push({ target, sha, suite: resolvedOpts.suite, ok, ...outcome, logPath });
  }

  return { exitCode: overallExit, results };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`cross-os-test: ${error.message}`);
    console.error(USAGE);
    process.exit(2);
  }
  if (opts.help) {
    console.log(USAGE);
    process.exit(0);
  }
  try {
    const result = await runCrossOs(opts);
    process.exit(result.exitCode);
  } catch (error) {
    console.error(`cross-os-test: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
