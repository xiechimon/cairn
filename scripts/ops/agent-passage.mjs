#!/usr/bin/env node

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { hostname, tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const COMMANDS = [
  'health',
  'coordinator-task',
  'computer-run',
  'chat-result',
  'top-journeys',
  'diagnose',
];

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_LOCAL_RUN_DIR = join(REPO_ROOT, '.claude', 'verify-run');
const DEFAULT_PROD_SSH_HOST = 'macmini';
const DEFAULT_PROD_PORT = 8787;
const DEFAULT_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 1_500;

const SECRET_KEY_RE =
  /^(?:.*?(?:token|secret|password|apikey|api_key|authorization|cookie|cipher|keyhash|tokenhash))$/i;
const SECRET_VALUE_PATTERNS = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED]'],
  [/\bcairn_[A-Za-z0-9_-]{8,}\b/g, 'cairn_[REDACTED]'],
  [/\b(?:sk|ghp|gho|github_pat)_[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_KEY]'],
  [/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_KEY]'],
];

const USAGE = `agent-passage: node scripts/ops/agent-passage.mjs <command> [options]

Commands:
  health            Check server reachability, deploy SHA, runner SHA, Coordinator tools, ownComputer
  coordinator-task  Verify creating a task from Coordinator (--live runs real Coordinator turn)
  computer-run      Verify target machine online+hubConnected, build/step execution, and traceId
  chat-result       Verify completion/report message back in Coordinator chat and transcript
  top-journeys      Run health -> coordinator-task -> computer-run -> chat-result; diagnose on fail
  diagnose          Inspect failed todo/step/build rows, OTel traceId, Langfuse hint, and logs

Options:
  --target <local|prod>   Target stack (default: local)
  --expect-sha <sha>      Require deployed SHA to contain <sha> as an ancestor
  --machine <name|id>     Target runner machine name or id
  --todo <id>             Todo id to inspect or drive
  --build <id>            Build id to inspect or drive
  --step <id>             Step id to diagnose
  --thread <id>           Chief thread id to inspect
  --project <id>          Project id for task creation
  --out <dir>             Output directory for result.json (never inside docs/verify)
  --timeout-ms <ms>       Poll timeout in ms (default: 90000)
  --live                  Send real Coordinator/runner execution requests
  --own-stack             Spawn isolated local stack via launch.mjs and clean up on exit
  --json                  Print redacted JSON report to stdout
  --help, -h              Show help`;

const VALUE_FLAGS = new Set([
  '--target',
  '--expect-sha',
  '--machine',
  '--todo',
  '--step',
  '--build',
  '--thread',
  '--project',
  '--out',
  '--timeout-ms',
]);

const BOOL_FLAGS = new Set(['--live', '--own-stack', '--json', '--help', '-h']);

export function parseArgs(argv) {
  const opts = {
    command: undefined,
    target: 'local',
    expectSha: undefined,
    machine: undefined,
    todoId: undefined,
    stepId: undefined,
    buildId: undefined,
    threadId: undefined,
    projectId: undefined,
    outDir: undefined,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    live: false,
    ownStack: false,
    json: false,
    help: false,
  };

  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (raw === '--') continue;
    if (!raw.startsWith('-')) {
      positionals.push(raw);
      continue;
    }
    const eq = raw.indexOf('=');
    const flag = eq === -1 ? raw : raw.slice(0, eq);
    const inlineValue = eq === -1 ? undefined : raw.slice(eq + 1);

    if (BOOL_FLAGS.has(flag)) {
      if (inlineValue !== undefined) {
        throw new Error(`Flag ${flag} does not take a value`);
      }
      if (flag === '--live') opts.live = true;
      else if (flag === '--own-stack') opts.ownStack = true;
      else if (flag === '--json') opts.json = true;
      else opts.help = true;
      continue;
    }

    if (!VALUE_FLAGS.has(flag)) {
      throw new Error(`Unknown option: ${flag}`);
    }

    let value = inlineValue;
    if (value === undefined) {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
        throw new Error(`Option ${flag} requires a value`);
      }
      value = argv[i + 1];
      i += 1;
    }

    switch (flag) {
      case '--target':
        if (value !== 'local' && value !== 'prod') {
          throw new Error(`Invalid --target ${value}; expected local or prod`);
        }
        opts.target = value;
        break;
      case '--expect-sha':
        opts.expectSha = value;
        break;
      case '--machine':
        opts.machine = value;
        break;
      case '--todo':
        opts.todoId = value;
        break;
      case '--step':
        opts.stepId = value;
        break;
      case '--build':
        opts.buildId = value;
        break;
      case '--thread':
        opts.threadId = value;
        break;
      case '--project':
        opts.projectId = value;
        break;
      case '--out':
        opts.outDir = value;
        break;
      case '--timeout-ms': {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error(`Invalid --timeout-ms ${value}`);
        }
        opts.timeoutMs = Math.trunc(parsed);
        break;
      }
      default:
        break;
    }
  }

  if (positionals.length > 1) {
    throw new Error(`Unexpected arguments: ${positionals.slice(1).join(' ')}`);
  }
  opts.command = positionals[0];
  if (!opts.help) {
    if (!opts.command) {
      throw new Error(`Missing command; expected one of: ${COMMANDS.join(', ')}`);
    }
    if (!COMMANDS.includes(opts.command)) {
      throw new Error(`Unknown command: ${opts.command}; expected one of: ${COMMANDS.join(', ')}`);
    }
  }
  return opts;
}

function deriveOtelId(bytes, ...parts) {
  return createHash('sha256')
    .update(JSON.stringify(parts))
    .digest('hex')
    .slice(0, bytes * 2);
}

export function otlpTraceIdOfBuild(buildId) {
  return deriveOtelId(16, 'trace', buildId);
}

export function otlpTraceIdOfTurn(stepId) {
  return deriveOtelId(16, 'trace', 'turn', stepId);
}

export function otlpTraceIdOfStep(step) {
  return step.kind === 'chief' ? otlpTraceIdOfTurn(step.stepId) : otlpTraceIdOfBuild(step.buildId);
}

export function langfuseObservationsPath(traceId) {
  return `/api/public/v2/observations?traceId=${encodeURIComponent(traceId)}&fields=core,basic,metadata,usage,model`;
}

export function redactString(text) {
  let out = String(text);
  for (const [pattern, replacement] of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

export function redactReport(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => redactReport(item, seen));
    }
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEY_RE.test(key) && item !== null && item !== undefined) {
        out[key] = '[REDACTED]';
      } else {
        out[key] = redactReport(item, seen);
      }
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

function physicalPath(targetPath) {
  const parts = [];
  let head = resolve(targetPath);
  while (!existsSync(head) && dirname(head) !== head) {
    parts.unshift(basename(head));
    head = dirname(head);
  }
  try {
    head = realpathSync(head);
  } catch {}
  return join(head, ...parts);
}

export function assertSafeOutDir(outDir, repoRoot = REPO_ROOT) {
  if (!outDir) return null;
  const resolved = physicalPath(outDir);
  const forbidden = physicalPath(join(repoRoot, 'docs', 'verify'));
  if (resolved === forbidden || resolved.startsWith(`${forbidden}${sep}`)) {
    throw new Error(`Refusing to write evidence inside ${forbidden}; choose another --out dir`);
  }
  return resolved;
}

export function isGitAncestor(
  ancestorSha,
  descendantSha,
  repoRoot = REPO_ROOT,
  exec = execFileSync,
) {
  if (!ancestorSha || !descendantSha) return false;
  if (descendantSha === ancestorSha || descendantSha.startsWith(ancestorSha)) return true;
  try {
    exec('git', ['-C', repoRoot, 'merge-base', '--is-ancestor', ancestorSha, descendantSha], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

export function evaluateDeployAlignment({
  target,
  expectSha = null,
  deploySha = null,
  deployRecordSha = null,
  versionCommit = null,
  runnerSha = null,
  localHeadSha = null,
  isAncestor = (anc, desc) => isGitAncestor(anc, desc),
}) {
  const checks = [];
  const errors = [];

  const effectiveSha = deploySha ?? deployRecordSha ?? (target === 'local' ? localHeadSha : null);

  if (target === 'prod') {
    const hasDeploySha = typeof deploySha === 'string' && deploySha.length > 0;
    checks.push({
      id: 'prod-deploy-sha',
      ok: hasDeploySha,
      detail: hasDeploySha ? deploySha : 'missing DEPLOYED_SHA',
    });
    if (!hasDeploySha) errors.push('Production DEPLOYED_SHA is missing');

    if (hasDeploySha && typeof deployRecordSha === 'string' && deployRecordSha.length > 0) {
      const recordMatches = deployRecordSha === deploySha;
      checks.push({
        id: 'deploy-record-match',
        ok: recordMatches,
        detail: `${deployRecordSha} vs ${deploySha}`,
      });
      if (!recordMatches) {
        errors.push(`deploy.json sha ${deployRecordSha} does not match DEPLOYED_SHA ${deploySha}`);
      }
    }

    const runnerMatches = Boolean(hasDeploySha && runnerSha && runnerSha === deploySha);
    checks.push({
      id: 'runner-sha-match',
      ok: runnerMatches,
      detail: `runner=${runnerSha ?? 'missing'} deployed=${deploySha ?? 'missing'}`,
    });
    if (!runnerMatches) {
      errors.push(
        `cairn-runner HEAD (${runnerSha ?? 'missing'}) does not match deployed SHA (${deploySha ?? 'missing'})`,
      );
    }
  }

  if (effectiveSha && typeof versionCommit === 'string' && versionCommit.length > 0) {
    const commitMatches =
      effectiveSha.startsWith(versionCommit) || versionCommit.startsWith(effectiveSha);
    checks.push({
      id: 'server-version-commit',
      ok: commitMatches,
      detail: `version.commit=${versionCommit} sha=${effectiveSha.slice(0, 12)}`,
    });
    if (!commitMatches) {
      errors.push(
        `/api/server/version commit ${versionCommit} does not match ${effectiveSha.slice(0, 12)}`,
      );
    }
  }

  if (expectSha) {
    const ancestorOk = Boolean(effectiveSha && isAncestor(expectSha, effectiveSha));
    checks.push({
      id: 'expect-sha-ancestor',
      ok: ancestorOk,
      detail: `${expectSha} <= ${effectiveSha ?? 'missing'}`,
    });
    if (!ancestorOk) {
      errors.push(
        `Expected SHA ${expectSha} is not an ancestor of deployed SHA ${effectiveSha ?? 'missing'}`,
      );
    }
  }

  return {
    ok: errors.length === 0,
    effectiveSha,
    checks,
    errors,
  };
}

export function evaluateHealth({
  target,
  userMe,
  teams,
  diagnostics,
  machines = [],
  deployAlignment,
}) {
  const checks = [];
  const errors = [];

  const userOk = Boolean(
    userMe &&
      userMe.status === 200 &&
      typeof userMe.data?.displayName === 'string' &&
      userMe.data.displayName.trim().length > 0,
  );
  checks.push({
    id: 'server-user-me',
    ok: userOk,
    detail: `status=${userMe?.status ?? 'none'}`,
  });
  if (!userOk) errors.push(`Server /api/user/me failed (status=${userMe?.status ?? 'none'})`);

  const teamList = Array.isArray(teams?.data) ? teams.data : [];
  const teamId = teamList[0]?.id ?? null;
  const teamsOk = teams?.status === 200 && teamId !== null;
  checks.push({
    id: 'teams-present',
    ok: teamsOk,
    detail: `status=${teams?.status ?? 'none'} count=${teamList.length}`,
  });
  if (!teamsOk)
    errors.push(`No team available from /api/teams (status=${teams?.status ?? 'none'})`);

  if (deployAlignment) {
    checks.push(...deployAlignment.checks);
    errors.push(...deployAlignment.errors);
  }

  const diagStatus = diagnostics?.status ?? 'none';
  const diagData = diagnostics?.data ?? null;
  const diagOk = diagStatus === 200 && diagData !== null && typeof diagData === 'object';
  checks.push({
    id: 'chief-diagnostics-endpoint',
    ok: diagOk,
    detail: `status=${diagStatus}`,
  });
  if (!diagOk) {
    errors.push(`GET /api/teams/:id/chief/diagnostics failed (status=${diagStatus})`);
  }

  const coord = diagData?.coordinator ?? null;
  const coreToolsPresent = coord?.coreToolsPresent === true;
  const missingCore = Array.isArray(coord?.missingCoreTools) ? coord.missingCoreTools : [];
  checks.push({
    id: 'coordinator-core-tools',
    ok: coreToolsPresent,
    detail: coreToolsPresent
      ? `offered=${coord?.offeredToolCount ?? 0}`
      : `missing=${missingCore.join(',') || 'unknown'}`,
  });
  if (!coreToolsPresent) {
    errors.push(
      `Coordinator core tools missing: ${missingCore.join(', ') || 'diagnostics did not report coreToolsPresent=true'}`,
    );
  }

  const diagMachines = Array.isArray(diagData?.machines) ? diagData.machines : [];
  const mergedMachines = diagMachines.map((dm) => {
    const apiMachine = machines.find((m) => m.id === dm.id);
    return {
      ...dm,
      online: dm.online ?? apiMachine?.online ?? false,
    };
  });
  const localMachines = mergedMachines.filter(
    (m) =>
      m.kind === 'local' &&
      (m.capabilities?.ownComputer === true ||
        m.capabilities?.ownComputerShell === true ||
        m.latestCliVersion !== null ||
        m.online === true),
  );
  if (localMachines.length > 0) {
    const connectedLocals = localMachines.filter(
      (m) => m.online === true && m.hubConnected === true,
    );
    const hubOk = connectedLocals.length > 0;
    const offersOwnComputer = localMachines.some(
      (m) => m.capabilities?.ownComputer === true || m.capabilities?.ownComputerShell === true,
    );
    const ownReady = coord?.ownComputerReady === true;
    const ownReason = coord?.ownComputerReason ?? null;
    checks.push({
      id: 'local-mac-hub-connected',
      ok: hubOk,
      detail: `${connectedLocals.length}/${localMachines.length} local machine(s) connected`,
    });
    checks.push({
      id: 'own-computer-ready',
      ok: !offersOwnComputer || ownReady,
      detail: !offersOwnComputer
        ? 'not offered on headless local runner'
        : ownReady
          ? 'ready'
          : (ownReason ?? 'ownComputerReady=false'),
    });
    if (!hubOk || (offersOwnComputer && !ownReady)) {
      const disconnected = localMachines
        .filter((m) => !m.online || !m.hubConnected)
        .map((m) => `${m.name}(online=${m.online},hubConnected=${m.hubConnected})`);
      const reason =
        (offersOwnComputer ? ownReason : null) ??
        (disconnected.length > 0
          ? `local runner disconnected: ${disconnected.join(', ')}`
          : 'ownComputerReady=false');
      errors.push(`Own computer not ready: ${reason}`);
    }
  } else {
    checks.push({
      id: 'local-mac-hub-connected',
      ok: true,
      detail: 'no enrolled local Mac machine on team',
    });
  }

  const onlineMachines = mergedMachines.filter((m) => m.online === true && m.hubConnected === true);

  return {
    ok: errors.length === 0,
    target,
    teamId,
    checks,
    errors,
    localMachines,
    onlineMachines,
    coordinator: coord,
  };
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

export function parseAccessTokenContent(content) {
  let bareFallback = null;
  for (const rawLine of String(content ?? '').split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) {
      bareFallback ??= line;
      continue;
    }
    if (line.slice(0, eq).trim() !== 'CAIRN_TOKEN') continue;
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2) {
      const quote = value[0];
      if ((quote === '"' || quote === "'") && value[value.length - 1] === quote) {
        value = value.slice(1, -1);
      }
    }
    return value === '' ? null : value;
  }
  return bareFallback;
}

function buildRemoteHttpScript() {
  return `
import json, os, sys, urllib.error, urllib.request
req = json.load(sys.stdin)
token_file = os.path.expanduser('~/.cairn-server/token')
token = ''
try:
    raw = open(token_file, encoding='utf-8').read()
    bare = None
    for raw_line in raw.splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#') or line.startswith(';'):
            continue
        if '=' not in line:
            if bare is None:
                bare = line
            continue
        k, v = line.split('=', 1)
        if k.strip() != 'CAIRN_TOKEN':
            continue
        val = v.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in ('"', "'"):
            val = val[1:-1]
        token = val
        break
    if not token and bare:
        token = bare
except Exception:
    pass
headers = {}
if token:
    headers['Authorization'] = 'Bearer ' + token
body_bytes = None
if 'body' in req and req['body'] is not None:
    headers['Content-Type'] = 'application/json'
    body_bytes = json.dumps(req['body']).encode('utf-8')
url = 'http://127.0.0.1:' + str(req['port']) + req['path']
timeout_s = max(1.0, float(req.get('timeoutMs') or 15000) / 1000.0)
http_req = urllib.request.Request(url, data=body_bytes, headers=headers, method=req['method'])
try:
    with urllib.request.urlopen(http_req, timeout=timeout_s) as resp:
        text = resp.read().decode('utf-8', errors='replace')
        data = None
        try:
            data = json.loads(text)
        except Exception:
            pass
        print(json.dumps({'status': resp.status, 'data': data, 'text': text}))
except urllib.error.HTTPError as err:
    text = err.read().decode('utf-8', errors='replace')
    data = None
    try:
        data = json.loads(text)
    except Exception:
        pass
    print(json.dumps({'status': err.code, 'data': data, 'text': text}))
except Exception as exc:
    print(json.dumps({'status': 0, 'data': None, 'text': str(exc)}))
`.trim();
}

function buildRemoteDbScript() {
  return `
import json, os, sqlite3, sys
payload = json.load(sys.stdin)
db_path = os.path.expanduser('~/.cairn-server/server/server.db')
if not os.path.exists(db_path):
    print(json.dumps({"ok": False, "error": "server.db missing", "rows": []}))
    sys.exit(0)
conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
conn.row_factory = sqlite3.Row
try:
    cur = conn.execute(payload["sql"], payload.get("params") or [])
    rows = [dict(r) for r in cur.fetchall()]
    print(json.dumps({"ok": True, "rows": rows}))
except Exception as exc:
    print(json.dumps({"ok": False, "error": str(exc), "rows": []}))
finally:
    conn.close()
`.trim();
}

function buildRemoteDeployScript() {
  return `
import json, os, subprocess
home = os.path.expanduser('~')
def read_trim(p):
    try:
        v = open(p, encoding='utf-8').read().strip()
        return v or None
    except Exception:
        return None
def read_json(p):
    try:
        return json.load(open(p, encoding='utf-8'))
    except Exception:
        return None
runner_sha = None
try:
    runner_sha = subprocess.check_output(
        ['git', '-C', os.path.join(home, 'cairn-runner'), 'rev-parse', 'HEAD'],
        text=True,
        stderr=subprocess.DEVNULL,
    ).strip() or None
except Exception:
    pass
print(json.dumps({
    'deployedShaFile': read_trim(os.path.join(home, 'cairn-server', 'DEPLOYED_SHA')),
    'deployJson': read_json(os.path.join(home, '.cairn-server', 'server', 'deploy.json')),
    'runnerSha': runner_sha,
}))
`.trim();
}

function buildRemoteTailScript(lines) {
  return `
import json, os
home = os.path.expanduser('~')
limit = ${Number(lines)}
def tail(p):
    try:
        raw = open(p, encoding='utf-8', errors='replace').read().strip()
        if not raw:
            return ''
        return '\\n'.join(raw.splitlines()[-limit:])
    except Exception:
        return None
print(json.dumps({
    'serverErr': tail(os.path.join(home, '.cairn-server', 'launchd-server.err.log')),
    'serverOut': tail(os.path.join(home, '.cairn-server', 'launchd-server.out.log')),
    'daemonLog': tail(os.path.join(home, '.cairn', 'daemon.log')) or tail(os.path.join(home, 'Library', 'Application Support', '@cairn', 'desktop', 'runner', 'daemon.log')),
}))
`.trim();
}

export function isProdLocalHost(env = process.env, host = hostname()) {
  if (env.AGENT_PASSAGE_PROD_LOCAL === '1') return true;
  const shortHost = host.split('.')[0]?.toLowerCase() ?? '';
  const targetHost = (env.AGENT_PASSAGE_SSH_HOST ?? DEFAULT_PROD_SSH_HOST).toLowerCase();
  return shortHost !== '' && shortHost === targetHost;
}

export function formatRemoteSshCommand(cmd, args) {
  if (cmd === 'node' && args[0] === '-e' && typeof args[1] === 'string') {
    const b64 = Buffer.from(args[1], 'utf8').toString('base64');
    return `node -e "eval(Buffer.from('${b64}','base64').toString('utf8'))"`;
  }
  if (cmd === 'python3' && args[0] === '-c' && typeof args[1] === 'string') {
    const b64 = Buffer.from(args[1], 'utf8').toString('base64');
    return `python3 -c "import base64;exec(base64.b64decode('${b64}').decode('utf-8'))"`;
  }
  const quote = (part) => `'${String(part).replace(/'/g, "'\\''")}'`;
  return [cmd, ...args].map(quote).join(' ');
}

function runProdCommand(cmd, args, stdinJson, { env = process.env, spawnFn = spawnSync } = {}) {
  const local = isProdLocalHost(env);
  const sshHost = env.AGENT_PASSAGE_SSH_HOST ?? DEFAULT_PROD_SSH_HOST;
  const input = stdinJson === undefined ? undefined : JSON.stringify(stdinJson);
  const res = local
    ? spawnFn(cmd, args, { input, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    : spawnFn(
        'ssh',
        [
          '-o',
          'BatchMode=yes',
          '-o',
          'ConnectTimeout=10',
          sshHost,
          formatRemoteSshCommand(cmd, args),
        ],
        {
          input,
          encoding: 'utf8',
          maxBuffer: 16 * 1024 * 1024,
        },
      );
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(
      `Remote command failed (${res.status}): ${(res.stderr || res.stdout || '').trim()}`,
    );
  }
  return res.stdout;
}

async function launchOwnLocalStack(repoRoot, runDir) {
  const portsFile = join(runDir, 'ports.json');
  if (existsSync(portsFile)) {
    throw new Error(`A stack already exists in ${runDir}; run vp.mjs cleanup first`);
  }
  const launchScript = join(repoRoot, '.claude', 'skills', 'verify-cairn', 'scripts', 'launch.mjs');
  const child = spawn(process.execPath, [launchScript], {
    cwd: repoRoot,
    env: { ...process.env, VERIFY_REPO_ROOT: repoRoot, VERIFY_RUN_DIR: runDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout?.on('data', (chunk) => {
    logs += chunk.toString();
  });
  child.stderr?.on('data', (chunk) => {
    logs += chunk.toString();
  });
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`launch.mjs exited early (${child.exitCode}): ${logs.slice(-500)}`);
    }
    if (existsSync(portsFile)) {
      return { child, runDir };
    }
    await sleep(300);
  }
  child.kill('SIGTERM');
  throw new Error(`Timed out waiting for ${portsFile}: ${logs.slice(-500)}`);
}

function queryLocalSqlite(dbPath, sql, params, repoRoot) {
  if (!existsSync(dbPath)) {
    return { ok: false, error: `Database missing at ${dbPath}`, rows: [] };
  }
  try {
    const requireServer = createRequire(join(repoRoot, 'apps', 'server', 'package.json'));
    const Database = requireServer('better-sqlite3');
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const rows = db.prepare(sql).all(...params);
      return { ok: true, rows };
    } finally {
      db.close();
    }
  } catch (err) {
    if (params.length === 0) {
      try {
        const out = execFileSync('sqlite3', ['-readonly', '-json', dbPath, sql], {
          encoding: 'utf8',
        });
        return { ok: true, rows: out.trim() ? JSON.parse(out) : [] };
      } catch {}
    }
    return { ok: false, error: String(err?.message ?? err), rows: [] };
  }
}

function tailLocalFile(filePath, lines) {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, 'utf8').trim();
    if (!raw) return '';
    return raw.split('\n').slice(-lines).join('\n');
  } catch {
    return null;
  }
}

export async function createTargetClient(
  opts,
  {
    repoRoot = REPO_ROOT,
    env = process.env,
    fetchImpl = fetch,
    spawnFn = spawnSync,
    execFileSyncFn = execFileSync,
  } = {},
) {
  if (opts.target === 'prod') {
    const port = Number(env.AGENT_PASSAGE_PROD_PORT ?? DEFAULT_PROD_PORT);
    return {
      target: 'prod',
      baseUrl: `http://127.0.0.1:${port}`,
      repoRoot,
      async requestJson(method, path, body) {
        const raw = runProdCommand(
          'python3',
          ['-c', buildRemoteHttpScript()],
          { method, path, body, port, timeoutMs: 15_000 },
          { env, spawnFn },
        );
        return JSON.parse(raw);
      },
      queryDb(sql, params = []) {
        const raw = runProdCommand(
          'python3',
          ['-c', buildRemoteDbScript()],
          { sql, params },
          { env, spawnFn },
        );
        return JSON.parse(raw);
      },
      readDeployArtifacts() {
        const raw = runProdCommand('python3', ['-c', buildRemoteDeployScript()], undefined, {
          env,
          spawnFn,
        });
        return JSON.parse(raw);
      },
      tailLogs(lines = 40) {
        const raw = runProdCommand('python3', ['-c', buildRemoteTailScript(lines)], undefined, {
          env,
          spawnFn,
        });
        return JSON.parse(raw);
      },
      isAncestor(ancestorSha, descendantSha) {
        if (!ancestorSha || !descendantSha) return false;
        if (descendantSha === ancestorSha || descendantSha.startsWith(ancestorSha)) return true;
        try {
          runProdCommand(
            'git',
            ['-C', 'cairn-runner', 'merge-base', '--is-ancestor', ancestorSha, descendantSha],
            undefined,
            { env, spawnFn },
          );
          return true;
        } catch {
          return isGitAncestor(ancestorSha, descendantSha, repoRoot, execFileSyncFn);
        }
      },
      async cleanup() {},
    };
  }

  let runDir = env.VERIFY_RUN_DIR ? resolve(env.VERIFY_RUN_DIR) : DEFAULT_LOCAL_RUN_DIR;
  let ownedStack = null;
  if (opts.ownStack) {
    if (!env.VERIFY_RUN_DIR) {
      runDir = join(tmpdir(), `cairn-passage-run-${randomUUID().slice(0, 8)}`);
    }
    ownedStack = await launchOwnLocalStack(repoRoot, runDir);
  }

  const portsFile = join(runDir, 'ports.json');
  if (!existsSync(portsFile)) {
    throw new Error(
      `No local stack found (${portsFile} missing); run vp.mjs launch or pass --own-stack`,
    );
  }
  const stack = JSON.parse(readFileSync(portsFile, 'utf8'));
  const baseUrl = `http://127.0.0.1:${stack.serverPort}`;
  const dbPath = join(stack.homeDir ?? join(runDir, 'home'), 'server', 'server.db');

  return {
    target: 'local',
    baseUrl,
    repoRoot,
    runDir,
    async requestJson(method, path, body) {
      const res = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      const text = await res.text();
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {}
      return { status: res.status, data, text };
    },
    queryDb(sql, params = []) {
      return queryLocalSqlite(dbPath, sql, params, repoRoot);
    },
    readDeployArtifacts() {
      let localHeadSha = null;
      try {
        localHeadSha = execFileSyncFn('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], {
          encoding: 'utf8',
        }).trim();
      } catch {}
      return { deployedShaFile: null, deployJson: null, runnerSha: null, localHeadSha };
    },
    tailLogs(lines = 40) {
      return {
        serverErr: tailLocalFile(join(runDir, 'server.log'), lines),
        serverOut: tailLocalFile(join(runDir, 'web.log'), lines),
        daemonLog: tailLocalFile(join(stack.homeDir ?? join(runDir, 'home'), 'daemon.log'), lines),
      };
    },
    isAncestor(ancestorSha, descendantSha) {
      return isGitAncestor(ancestorSha, descendantSha, repoRoot, execFileSyncFn);
    },
    async cleanup() {
      if (!ownedStack) return;
      const cleanupScript = join(
        repoRoot,
        '.claude',
        'skills',
        'verify-cairn',
        'scripts',
        'cleanup.mjs',
      );
      spawnFn(process.execPath, [cleanupScript], {
        cwd: repoRoot,
        env: { ...env, VERIFY_REPO_ROOT: repoRoot, VERIFY_RUN_DIR: ownedStack.runDir },
        encoding: 'utf8',
      });
      if (!env.VERIFY_RUN_DIR) {
        rmSync(ownedStack.runDir, { recursive: true, force: true });
      }
    },
  };
}

function resolveMachine(machines, selector) {
  if (!selector) {
    return (
      machines.find((m) => m.online === true && m.hubConnected === true) ?? machines[0] ?? null
    );
  }
  return machines.find((m) => m.id === selector || m.name === selector) ?? null;
}

export async function runHealth(client, opts) {
  const [userMe, deployRes, versionRes, teamsRes] = await Promise.all([
    client.requestJson('GET', '/api/user/me'),
    client.requestJson('GET', '/api/server/deploy'),
    client.requestJson('GET', '/api/server/version'),
    client.requestJson('GET', '/api/teams'),
  ]);
  const teamId = Array.isArray(teamsRes.data) ? teamsRes.data[0]?.id : null;
  const [machinesRes, diagRes] = teamId
    ? await Promise.all([
        client.requestJson('GET', `/api/teams/${teamId}/machines`),
        client.requestJson('GET', `/api/teams/${teamId}/chief/diagnostics`),
      ])
    : [
        { status: 0, data: [] },
        { status: 0, data: null },
      ];

  const artifacts = client.readDeployArtifacts();
  const deployApiSha = deployRes.data?.deployed?.sha ?? null;
  const deployAlignment = evaluateDeployAlignment({
    target: client.target,
    expectSha: opts.expectSha ?? null,
    deploySha: artifacts.deployedShaFile ?? deployApiSha,
    deployRecordSha: artifacts.deployJson?.sha ?? deployApiSha,
    versionCommit: versionRes.data?.commit ?? null,
    runnerSha: artifacts.runnerSha ?? null,
    localHeadSha: artifacts.localHeadSha ?? null,
    isAncestor: (anc, desc) => client.isAncestor(anc, desc),
  });

  const machines = Array.isArray(machinesRes.data) ? machinesRes.data : [];
  const health = evaluateHealth({
    target: client.target,
    userMe,
    teams: teamsRes,
    diagnostics: diagRes,
    machines,
    deployAlignment,
  });

  return {
    command: 'health',
    ...health,
    deploy: deployRes.data?.deployed ?? artifacts.deployJson ?? null,
    serverVersion: versionRes.data ?? null,
    runnerSha: artifacts.runnerSha ?? null,
    diagnostics: diagRes.data ?? null,
    machines,
  };
}

async function resolveProjectForProbe(client, teamId, opts, allowCreate) {
  if (opts.projectId) {
    return { projectId: opts.projectId, createdProjectId: null };
  }
  if (!(opts.live && client.target === 'prod')) {
    const projectsRes = await client.requestJson('GET', '/api/projects');
    if (projectsRes.status === 200 && Array.isArray(projectsRes.data)) {
      const active = projectsRes.data.find((p) => !p.archivedAt);
      if (active) return { projectId: active.id, createdProjectId: null };
    }
  }
  if (!allowCreate) {
    throw new Error('No active project found; pass --project <id>');
  }
  const createRes = await client.requestJson('POST', '/api/projects', {
    name: `passage-probe-${Date.now() % 100_000}`,
    repoKind: 'hosted',
    teamId,
  });
  if (createRes.status !== 201 || !createRes.data?.id) {
    throw new Error(`Failed to create probe project (${createRes.status}): ${createRes.text}`);
  }
  return { projectId: createRes.data.id, createdProjectId: createRes.data.id };
}

async function cleanupProbeArtifacts(client, { createdTodoId, createdProjectId, cleanup = true }) {
  if (!cleanup) return;
  if (createdTodoId) {
    await client.requestJson('DELETE', `/api/todos/${createdTodoId}`).catch(() => {});
  }
  if (createdProjectId) {
    await client.requestJson('DELETE', `/api/projects/${createdProjectId}`).catch(() => {});
  }
}

export async function runCoordinatorTask(client, opts, { cleanup = true } = {}) {
  const teamsRes = await client.requestJson('GET', '/api/teams');
  const teamId = Array.isArray(teamsRes.data) ? teamsRes.data[0]?.id : null;
  if (!teamId) throw new Error('No team found via /api/teams');

  const [chiefRes, threadsRes, diagRes] = await Promise.all([
    client.requestJson('GET', `/api/teams/${teamId}/chief`),
    client.requestJson('GET', `/api/teams/${teamId}/chief/threads`),
    client.requestJson('GET', `/api/teams/${teamId}/chief/diagnostics`),
  ]);

  if (chiefRes.status !== 200) {
    throw new Error(`GET /api/teams/${teamId}/chief failed (${chiefRes.status})`);
  }
  if (threadsRes.status !== 200) {
    throw new Error(`GET /api/teams/${teamId}/chief/threads failed (${threadsRes.status})`);
  }

  let createdTodoId = null;
  let createdProjectId = null;
  let threadId = opts.threadId ?? diagRes.data?.threadId ?? threadsRes.data?.[0]?.id ?? null;
  let chiefMessageId = null;
  const marker = `passage-${Date.now() % 1_000_000}`;

  try {
    if (opts.live) {
      const projectInfo = await resolveProjectForProbe(client, teamId, opts, true);
      createdProjectId = projectInfo.createdProjectId;
      const clientMessageId = `${marker}-${randomUUID().slice(0, 8)}`;
      const machineHint = opts.machine ? ` Pin it to machine ${opts.machine}.` : '';
      const prompt = `[passage-probe] ${marker}: create one tiny read-only todo titled "[passage-probe] ${marker}" with spec "Read-only probe ${marker}; reply with PASSAGE_OK and do not edit any files.${machineHint}" and report back in this chat when done.`;
      const postRes = await client.requestJson('POST', `/api/teams/${teamId}/chief/threads`, {
        content: prompt,
        projectId: projectInfo.projectId,
        clientMessageId,
      });
      if (postRes.status !== 201 || !postRes.data?.thread?.id || !postRes.data?.message?.id) {
        throw new Error(
          `POST /api/teams/${teamId}/chief/threads failed (${postRes.status}): ${postRes.text}`,
        );
      }
      threadId = postRes.data.thread.id;
      chiefMessageId = postRes.data.message.id;

      const msgRow = client.queryDb(
        'SELECT id, threadId, role, createdAt FROM chief_message WHERE id = ?',
        [chiefMessageId],
      );
      if (!msgRow.ok || msgRow.rows.length === 0) {
        throw new Error(`SQLite chief_message missing row for ${chiefMessageId}`);
      }

      const deadline = Date.now() + opts.timeoutMs;
      let foundTodo = null;
      while (Date.now() < deadline) {
        const todosRes = await client.requestJson('GET', `/api/todos?teamId=${teamId}`);
        if (todosRes.status === 200 && Array.isArray(todosRes.data)) {
          foundTodo = todosRes.data.find(
            (t) =>
              (typeof t.title === 'string' && t.title.includes(marker)) ||
              (typeof t.spec === 'string' && t.spec.includes(marker)),
          );
          if (foundTodo) break;
        }
        await sleep(POLL_INTERVAL_MS);
      }
      if (!foundTodo) {
        throw new Error(`Timed out waiting for Coordinator to create probe todo ${marker}`);
      }
      createdTodoId = foundTodo.id;

      const todoDb = client.queryDb('SELECT id, title, phase, seqNum FROM todo WHERE id = ?', [
        createdTodoId,
      ]);
      if (!todoDb.ok || todoDb.rows.length === 0) {
        throw new Error(`SQLite todo row missing for ${createdTodoId}`);
      }

      const chiefSteps = client.queryDb(
        "SELECT id, buildId, kind, status, createdAt FROM step WHERE buildId = ? AND kind = 'chief' ORDER BY createdAt DESC LIMIT 1",
        [threadId],
      );
      const chiefStepId = chiefSteps.rows?.[0]?.id ?? null;

      return {
        command: 'coordinator-task',
        ok: true,
        mode: 'live',
        teamId,
        threadId,
        chiefMessageId,
        chiefMessageCreatedAt: postRes.data.message.createdAt ?? 0,
        todoId: createdTodoId,
        projectId: foundTodo.projectId ?? projectInfo.projectId,
        createdProjectId,
        buildId: foundTodo.latestBuildId ?? null,
        traceId: chiefStepId ? otlpTraceIdOfTurn(chiefStepId) : null,
        todo: foundTodo,
        dbTodo: todoDb.rows[0],
        cleanedUp: cleanup,
      };
    }

    if (client.target === 'local') {
      const projectInfo = await resolveProjectForProbe(client, teamId, opts, true);
      createdProjectId = projectInfo.createdProjectId;
      const title = `[passage-probe] ${marker}`;
      const createRes = await client.requestJson(
        'POST',
        `/api/projects/${projectInfo.projectId}/todos`,
        {
          title,
          spec: `Deterministic probe ${marker}`,
          ...(opts.machine ? { machineId: opts.machine } : {}),
        },
      );
      if (createRes.status !== 201 || !createRes.data?.id) {
        throw new Error(
          `POST /api/projects/:id/todos failed (${createRes.status}): ${createRes.text}`,
        );
      }
      createdTodoId = createRes.data.id;
      const todosRes = await client.requestJson('GET', `/api/todos?teamId=${teamId}`);
      const listed = Array.isArray(todosRes.data)
        ? todosRes.data.find((t) => t.id === createdTodoId)
        : null;
      if (!listed)
        throw new Error(`Created probe todo ${createdTodoId} missing from GET /api/todos`);
      const todoDb = client.queryDb('SELECT id, title, phase, seqNum FROM todo WHERE id = ?', [
        createdTodoId,
      ]);
      if (!todoDb.ok || todoDb.rows.length === 0) {
        throw new Error(`SQLite todo row missing for ${createdTodoId}`);
      }
      return {
        command: 'coordinator-task',
        ok: true,
        mode: 'deterministic',
        teamId,
        threadId,
        todoId: createdTodoId,
        projectId: projectInfo.projectId,
        createdProjectId,
        buildId: null,
        todo: listed,
        dbTodo: todoDb.rows[0],
        cleanedUp: cleanup,
      };
    }

    const todosRes = await client.requestJson('GET', `/api/todos?teamId=${teamId}`);
    const dbCheck = client.queryDb(
      'SELECT count(*) AS count FROM chief_thread WHERE teamId = ? AND archivedAt IS NULL',
      [teamId],
    );
    if (!dbCheck.ok) throw new Error(`SQLite read failed: ${dbCheck.error}`);
    return {
      command: 'coordinator-task',
      ok: true,
      mode: 'readonly',
      teamId,
      threadId,
      todoCount: Array.isArray(todosRes.data) ? todosRes.data.length : 0,
      chiefThreadCount: dbCheck.rows[0]?.count ?? 0,
      cleanedUp: true,
    };
  } finally {
    await cleanupProbeArtifacts(client, { createdTodoId, createdProjectId, cleanup });
  }
}

export async function runComputerRun(client, opts, { cleanup = true } = {}) {
  const teamsRes = await client.requestJson('GET', '/api/teams');
  const teamId = Array.isArray(teamsRes.data) ? teamsRes.data[0]?.id : null;
  if (!teamId) throw new Error('No team found via /api/teams');

  const [machinesRes, diagRes] = await Promise.all([
    client.requestJson('GET', `/api/teams/${teamId}/machines`),
    client.requestJson('GET', `/api/teams/${teamId}/chief/diagnostics`),
  ]);

  const apiMachines = Array.isArray(machinesRes.data) ? machinesRes.data : [];
  const diagMachines = Array.isArray(diagRes.data?.machines) ? diagRes.data.machines : [];
  const mergedMachines = apiMachines.map((m) => {
    const dm = diagMachines.find((d) => d.id === m.id);
    return { ...m, hubConnected: dm?.hubConnected ?? false };
  });

  const targetMachine = resolveMachine(mergedMachines, opts.machine);

  if (opts.live || opts.todoId || opts.buildId || opts.machine) {
    if (!targetMachine) {
      throw new Error(
        opts.machine
          ? `Machine ${opts.machine} not found on team ${teamId}`
          : `No enrolled machine available on team ${teamId}`,
      );
    }
    if (!targetMachine.online || !targetMachine.hubConnected) {
      throw new Error(
        `Target machine ${targetMachine.name} (${targetMachine.id}) is not ready (online=${targetMachine.online}, hubConnected=${targetMachine.hubConnected})`,
      );
    }
  }

  if (!opts.live && !opts.todoId && !opts.buildId) {
    const recentSteps = client.queryDb(
      `SELECT s.id, s.buildId, s.kind, s.status, s.machineId, b.todoId, b.failureCode, b.errorMessage
       FROM step s LEFT JOIN build b ON b.id = s.buildId
       WHERE s.machineId IS NOT NULL
       ORDER BY COALESCE(s.finishedAt, s.createdAt) DESC LIMIT 3`,
    );
    const latestStep = recentSteps.rows?.[0] ?? null;
    return {
      command: 'computer-run',
      ok: true,
      mode: 'readonly',
      teamId,
      machine: targetMachine
        ? {
            id: targetMachine.id,
            name: targetMachine.name,
            online: targetMachine.online,
            hubConnected: targetMachine.hubConnected,
          }
        : null,
      latestStep,
      traceId: latestStep
        ? otlpTraceIdOfStep({
            kind: latestStep.kind,
            buildId: latestStep.buildId,
            stepId: latestStep.id,
          })
        : null,
      cleanedUp: true,
    };
  }

  let createdTodoId = null;
  let createdProjectId = null;
  let todoId = opts.todoId ?? null;
  let buildId = opts.buildId ?? null;

  try {
    if (!buildId && !todoId) {
      const projectInfo = await resolveProjectForProbe(client, teamId, opts, true);
      createdProjectId = projectInfo.createdProjectId;
      const marker = `passage-run-${Date.now() % 1_000_000}`;
      const createRes = await client.requestJson(
        'POST',
        `/api/projects/${projectInfo.projectId}/todos`,
        {
          title: `[passage-probe] ${marker}`,
          spec: `Read-only computer-run probe ${marker}; reply with PASSAGE_RUN_OK and make no edits.`,
          machineId: targetMachine.id,
        },
      );
      if (createRes.status !== 201 || !createRes.data?.id) {
        throw new Error(
          `POST /api/projects/:id/todos failed (${createRes.status}): ${createRes.text}`,
        );
      }
      createdTodoId = createRes.data.id;
      todoId = createdTodoId;
    }

    if (!buildId && todoId) {
      const todoRes = await client.requestJson('GET', `/api/todos/${todoId}`);
      if (todoRes.status !== 200 || !todoRes.data) {
        throw new Error(`GET /api/todos/${todoId} failed (${todoRes.status})`);
      }
      if (todoRes.data.latestBuildId) {
        buildId = todoRes.data.latestBuildId;
      } else {
        const startRes = await client.requestJson(
          'POST',
          `/api/projects/${todoRes.data.projectId}/builds`,
          {
            todoIds: [todoId],
            routeOverride: { machineId: targetMachine.id },
          },
        );
        if (startRes.status !== 201 || !startRes.data?.builds?.[0]?.id) {
          throw new Error(
            `POST /api/projects/:id/builds failed (${startRes.status}): ${startRes.text}`,
          );
        }
        buildId = startRes.data.builds[0].id;
      }
    }

    const deadline = Date.now() + opts.timeoutMs;
    let finishedStep = null;
    while (Date.now() < deadline) {
      const stepsRes = await client.requestJson('GET', `/api/builds/${buildId}/steps`);
      if (stepsRes.status === 200 && Array.isArray(stepsRes.data)) {
        const runnerSteps = stepsRes.data.filter((s) => s.kind !== 'chief');
        const settled = runnerSteps.find((s) => s.status === 'done' || s.status === 'failed');
        if (settled) {
          finishedStep = settled;
          break;
        }
      }
      await sleep(POLL_INTERVAL_MS);
    }

    if (!finishedStep) {
      throw new Error(`Timed out waiting for build ${buildId} step to finish`);
    }

    const buildDb = client.queryDb(
      'SELECT id, todoId, failureCode, errorMessage, createdAt FROM build WHERE id = ?',
      [buildId],
    );
    const stepDb = client.queryDb(
      'SELECT id, buildId, kind, machineId, status, failureCode, createdAt, finishedAt FROM step WHERE id = ?',
      [finishedStep.id],
    );
    const traceId = otlpTraceIdOfBuild(buildId);

    if (finishedStep.status !== 'done') {
      throw new Error(
        `Build ${buildId} step ${finishedStep.id} failed (${finishedStep.failureCode ?? buildDb.rows?.[0]?.failureCode ?? 'unknown'}) traceId=${traceId}`,
      );
    }
    if (opts.machine && targetMachine && finishedStep.machineId !== targetMachine.id) {
      throw new Error(
        `Expected step.machineId=${targetMachine.id}, got ${finishedStep.machineId ?? 'null'}`,
      );
    }
    if (!buildDb.ok || buildDb.rows.length === 0 || !stepDb.ok || stepDb.rows.length === 0) {
      throw new Error(`SQLite build/step row missing for build=${buildId} step=${finishedStep.id}`);
    }

    return {
      command: 'computer-run',
      ok: true,
      mode: 'live',
      teamId,
      todoId,
      buildId,
      stepId: finishedStep.id,
      machineId: finishedStep.machineId,
      stepFinishedAt: finishedStep.finishedAt ?? Date.now(),
      traceId,
      langfusePath: langfuseObservationsPath(traceId),
      dbBuild: buildDb.rows[0],
      dbStep: stepDb.rows[0],
      cleanedUp: cleanup,
    };
  } finally {
    await cleanupProbeArtifacts(client, { createdTodoId, createdProjectId, cleanup });
  }
}

export async function runChatResult(client, opts) {
  const teamsRes = await client.requestJson('GET', '/api/teams');
  const teamId = Array.isArray(teamsRes.data) ? teamsRes.data[0]?.id : null;
  if (!teamId) throw new Error('No team found via /api/teams');

  const [chiefRes, threadsRes, diagRes] = await Promise.all([
    client.requestJson(
      'GET',
      `/api/teams/${teamId}/chief${opts.threadId ? `?threadId=${encodeURIComponent(opts.threadId)}` : ''}`,
    ),
    client.requestJson('GET', `/api/teams/${teamId}/chief/threads`),
    client.requestJson('GET', `/api/teams/${teamId}/chief/diagnostics`),
  ]);

  if (chiefRes.status !== 200) {
    throw new Error(`GET /api/teams/${teamId}/chief failed (${chiefRes.status})`);
  }

  const threadId = opts.threadId ?? diagRes.data?.threadId ?? threadsRes.data?.[0]?.id ?? null;
  if (!threadId) {
    return {
      command: 'chat-result',
      ok: true,
      mode: 'empty',
      teamId,
      threadId: null,
      messageCount: 0,
      traceId: null,
    };
  }

  if (opts.live && (opts.todoId || opts.buildId || opts.chiefMessageId)) {
    const deadline = Date.now() + opts.timeoutMs;
    let matchedMessage = null;
    while (Date.now() < deadline) {
      const msgRes = await client.requestJson('GET', `/api/conversations/${threadId}/messages`);
      if (msgRes.status === 200 && Array.isArray(msgRes.data?.messages)) {
        const candidates = msgRes.data.messages.filter((m) => m.role === 'assistant');
        matchedMessage =
          candidates.find((m) => {
            const raw = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
            return (
              (opts.todoId && raw.includes(opts.todoId)) ||
              (opts.buildId && raw.includes(opts.buildId)) ||
              (opts.stepFinishedAt && m.createdAt >= opts.stepFinishedAt) ||
              (!opts.todoId &&
                !opts.buildId &&
                opts.chiefMessageId &&
                m.createdAt >= (opts.sinceCreatedAt ?? 0))
            );
          }) ?? null;
        if (matchedMessage) break;
      }
      await sleep(POLL_INTERVAL_MS);
    }
    if (!matchedMessage) {
      throw new Error(`Timed out waiting for Coordinator reply in thread ${threadId}`);
    }
  }

  const transcriptRes = await client.requestJson('GET', `/api/conversations/${threadId}/messages`);
  if (transcriptRes.status !== 200) {
    throw new Error(`GET /api/conversations/${threadId}/messages failed (${transcriptRes.status})`);
  }

  const dbMessages = client.queryDb(
    'SELECT id, threadId, role, createdAt FROM chief_message WHERE threadId = ? ORDER BY createdAt DESC LIMIT 5',
    [threadId],
  );
  const dbSteps = client.queryDb(
    "SELECT id, buildId, kind, status, createdAt, finishedAt FROM step WHERE buildId = ? AND kind = 'chief' ORDER BY createdAt DESC LIMIT 1",
    [threadId],
  );
  const latestChiefStep = dbSteps.rows?.[0] ?? null;
  const traceId = latestChiefStep ? otlpTraceIdOfTurn(latestChiefStep.id) : null;

  return {
    command: 'chat-result',
    ok: true,
    mode: opts.live ? 'live' : 'readonly',
    teamId,
    threadId,
    messageCount: Array.isArray(transcriptRes.data?.messages)
      ? transcriptRes.data.messages.length
      : 0,
    dbRecentMessages: dbMessages.rows ?? [],
    traceId,
    langfusePath: traceId ? langfuseObservationsPath(traceId) : null,
  };
}

export async function runDiagnose(client, opts) {
  const teamsRes = await client
    .requestJson('GET', '/api/teams')
    .catch(() => ({ status: 0, data: [] }));
  const teamId = Array.isArray(teamsRes.data) ? teamsRes.data[0]?.id : null;
  const diagRes = teamId
    ? await client
        .requestJson('GET', `/api/teams/${teamId}/chief/diagnostics`)
        .catch(() => ({ status: 0, data: null }))
    : { status: 0, data: null };

  let failedSteps = [];
  let failedBuilds = [];
  let todoRow = null;

  if (opts.stepId) {
    failedSteps = client.queryDb(
      `SELECT s.id AS stepId, s.buildId, s.kind, s.status, s.machineId, s.failureCode, s.createdAt, s.finishedAt,
              b.todoId, b.failureCode AS buildFailureCode, b.errorMessage
       FROM step s LEFT JOIN build b ON b.id = s.buildId WHERE s.id = ?`,
      [opts.stepId],
    ).rows;
  } else if (opts.buildId) {
    failedBuilds = client.queryDb(
      'SELECT id, todoId, failureCode, errorMessage, createdAt FROM build WHERE id = ?',
      [opts.buildId],
    ).rows;
    failedSteps = client.queryDb(
      'SELECT id AS stepId, buildId, kind, status, machineId, failureCode, createdAt, finishedAt FROM step WHERE buildId = ? ORDER BY createdAt DESC LIMIT 5',
      [opts.buildId],
    ).rows;
  } else if (opts.todoId) {
    todoRow =
      client.queryDb('SELECT id, title, phase, latestBuildId FROM todo WHERE id = ?', [opts.todoId])
        .rows?.[0] ?? null;
    failedBuilds = client.queryDb(
      'SELECT id, todoId, failureCode, errorMessage, createdAt FROM build WHERE todoId = ? ORDER BY createdAt DESC LIMIT 5',
      [opts.todoId],
    ).rows;
    failedSteps = client.queryDb(
      `SELECT s.id AS stepId, s.buildId, s.kind, s.status, s.machineId, s.failureCode, s.createdAt, s.finishedAt
       FROM step s INNER JOIN build b ON b.id = s.buildId WHERE b.todoId = ? ORDER BY s.createdAt DESC LIMIT 5`,
      [opts.todoId],
    ).rows;
  } else {
    failedSteps = client.queryDb(
      `SELECT s.id AS stepId, s.buildId, s.kind, s.status, s.machineId, s.failureCode, s.createdAt, s.finishedAt,
              b.todoId, b.failureCode AS buildFailureCode, b.errorMessage
       FROM step s LEFT JOIN build b ON b.id = s.buildId
       WHERE s.status = 'failed'
       ORDER BY COALESCE(s.finishedAt, s.createdAt) DESC LIMIT 5`,
    ).rows;
    failedBuilds = client.queryDb(
      `SELECT id, todoId, failureCode, errorMessage, createdAt
       FROM build WHERE failureCode IS NOT NULL OR errorMessage IS NOT NULL
       ORDER BY createdAt DESC LIMIT 5`,
    ).rows;
  }

  const annotatedSteps = (failedSteps ?? []).map((row) => {
    const traceId = otlpTraceIdOfStep({
      kind: row.kind ?? 'build',
      buildId: row.buildId ?? '',
      stepId: row.stepId,
    });
    return {
      ...row,
      traceId,
      langfusePath: langfuseObservationsPath(traceId),
    };
  });

  const primaryTraceId =
    annotatedSteps[0]?.traceId ??
    (failedBuilds[0]?.id ? otlpTraceIdOfBuild(failedBuilds[0].id) : null) ??
    diagRes.data?.recentFailures?.[0]?.traceId ??
    null;

  const logs = client.tailLogs(40);

  return {
    command: 'diagnose',
    ok: true,
    teamId,
    ownComputerReady: diagRes.data?.coordinator?.ownComputerReady ?? null,
    ownComputerReason: diagRes.data?.coordinator?.ownComputerReason ?? null,
    coreToolsPresent: diagRes.data?.coordinator?.coreToolsPresent ?? null,
    missingCoreTools: diagRes.data?.coordinator?.missingCoreTools ?? [],
    recentFailures: diagRes.data?.recentFailures ?? [],
    todo: todoRow,
    failedBuilds: failedBuilds ?? [],
    failedSteps: annotatedSteps,
    traceId: primaryTraceId,
    langfusePath: primaryTraceId ? langfuseObservationsPath(primaryTraceId) : null,
    logs,
  };
}

export async function runTopJourneys(client, opts) {
  const stages = [];
  const context = {
    todoId: opts.todoId ?? null,
    projectId: opts.projectId ?? null,
    createdProjectId: null,
    buildId: opts.buildId ?? null,
    threadId: opts.threadId ?? null,
    chiefMessageId: null,
    sinceCreatedAt: 0,
  };

  let overallOk = true;
  let failureError = null;
  let diagnosis = null;

  try {
    const health = await runHealth(client, opts);
    stages.push({ stage: 'health', ok: health.ok, result: health });
    if (!health.ok) {
      throw new Error(health.errors.join('; '));
    }

    const coord = await runCoordinatorTask(client, { ...opts, ...context }, { cleanup: false });
    stages.push({ stage: 'coordinator-task', ok: coord.ok, result: coord });
    context.todoId = coord.todoId ?? context.todoId;
    context.projectId = coord.projectId ?? context.projectId;
    context.createdProjectId = coord.createdProjectId ?? context.createdProjectId;
    context.buildId = coord.buildId ?? context.buildId;
    context.threadId = coord.threadId ?? context.threadId;
    context.chiefMessageId = coord.chiefMessageId ?? context.chiefMessageId;
    context.sinceCreatedAt = coord.chiefMessageCreatedAt ?? context.sinceCreatedAt;

    const comp = await runComputerRun(
      client,
      {
        ...opts,
        todoId: opts.live ? context.todoId : null,
        buildId: opts.live ? context.buildId : null,
      },
      { cleanup: false },
    );
    stages.push({ stage: 'computer-run', ok: comp.ok, result: comp });
    context.buildId = comp.buildId ?? context.buildId;
    context.stepFinishedAt = comp.stepFinishedAt ?? null;

    const chat = await runChatResult(client, {
      ...opts,
      todoId: context.todoId,
      buildId: context.buildId,
      threadId: context.threadId,
      chiefMessageId: context.chiefMessageId,
      sinceCreatedAt: context.sinceCreatedAt,
      stepFinishedAt: context.stepFinishedAt,
    });
    stages.push({ stage: 'chat-result', ok: chat.ok, result: chat });
  } catch (err) {
    overallOk = false;
    failureError = String(err?.message ?? err);
    diagnosis = await runDiagnose(client, {
      ...opts,
      todoId: context.todoId,
      buildId: context.buildId,
    }).catch((diagErr) => ({ error: String(diagErr?.message ?? diagErr) }));
  } finally {
    await cleanupProbeArtifacts(client, {
      createdTodoId: opts.todoId ? null : context.todoId,
      createdProjectId: context.createdProjectId,
      cleanup: true,
    });
  }

  return {
    command: 'top-journeys',
    ok: overallOk,
    target: client.target,
    error: failureError,
    stages,
    diagnosis,
  };
}

function printHumanSummary(report) {
  if (report.command === 'health') {
    for (const c of report.checks ?? []) {
      console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.id}  ${c.detail}`);
    }
    if (!report.ok) {
      for (const err of report.errors ?? []) console.error(`ERROR ${err}`);
    }
    return;
  }
  if (report.command === 'top-journeys') {
    for (const s of report.stages ?? []) {
      console.log(`${s.ok ? 'PASS' : 'FAIL'}  stage:${s.stage}`);
    }
    if (!report.ok) {
      console.error(`FAIL  top-journeys: ${report.error}`);
      if (report.diagnosis) {
        console.error(JSON.stringify(report.diagnosis, null, 2));
      }
    }
    return;
  }
  console.log(JSON.stringify(report, null, 2));
}

export async function runCli(argv, deps = {}) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(USAGE);
    return { exitCode: 0, report: null };
  }

  const repoRoot = deps.repoRoot ?? REPO_ROOT;
  const env = deps.env ?? process.env;
  const outDirRaw = opts.outDir ?? env.VERIFY_EVIDENCE_DIR ?? null;
  const outDir = assertSafeOutDir(outDirRaw, repoRoot);

  const clientFactory = deps.createClient ?? createTargetClient;
  const client = await clientFactory(opts, { repoRoot, env });

  let rawReport;
  try {
    switch (opts.command) {
      case 'health':
        rawReport = await runHealth(client, opts);
        break;
      case 'coordinator-task':
        rawReport = await runCoordinatorTask(client, opts);
        break;
      case 'computer-run':
        rawReport = await runComputerRun(client, opts);
        break;
      case 'chat-result':
        rawReport = await runChatResult(client, opts);
        break;
      case 'top-journeys':
        rawReport = await runTopJourneys(client, opts);
        break;
      case 'diagnose':
        rawReport = await runDiagnose(client, opts);
        break;
      default:
        throw new Error(`Unsupported command: ${opts.command}`);
    }
  } finally {
    await client.cleanup();
  }

  const report = redactReport(rawReport);

  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
  }

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHumanSummary(report);
  }

  return { exitCode: report.ok === false ? 1 : 0, report };
}

const isEntrypoint =
  process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isEntrypoint) {
  runCli(process.argv.slice(2))
    .then(({ exitCode }) => {
      process.exit(exitCode);
    })
    .catch((err) => {
      console.error(redactString(err?.message ?? err));
      process.exit(1);
    });
}
