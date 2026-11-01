import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function runGh(args, command = 'gh') {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function readList(path) {
  try {
    return readFileSync(path).toString('latin1');
  } catch (err) {
    if (err.code === 'ENOENT') return '';
    throw err;
  }
}

function transferList(name, before, issue) {
  const lines = before.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  return name === 'never'
    ? lines.some((line) => line.trim() === String(issue))
      ? before
      : `${before}${before && !before.endsWith('\n') ? '\n' : ''}${issue}\n`
    : lines.filter((line) => line.trim() !== String(issue)).join('');
}

function atomicWrite(path, before, after, beforeRename = () => {}) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, Buffer.from(after, 'latin1'), { flag: 'wx', mode: 0o600 });
    beforeRename(path);
    if (readList(path) !== before) return false;
    renameSync(temp, path);
    return true;
  } finally {
    rmSync(temp, { force: true });
  }
}

function restoreTransferLists(plan) {
  for (const [name, list] of Object.entries(plan.lists).reverse()) {
    if (!list.changed) continue;
    const path = join(plan.stateDir, name);
    for (let attempt = 0; ; attempt += 1) {
      const current = readList(path);
      if (!current.startsWith(list.after)) throw new Error(`list-rollback-conflict: ${name}`);
      const appended = current.slice(list.after.length);
      const restored = `${list.before}${appended && list.before && !list.before.endsWith('\n') ? '\n' : ''}${appended}`;
      if (atomicWrite(path, current, restored)) {
        if (!list.existed && restored === '') rmSync(path);
        break;
      }
      if (attempt === 3) throw new Error(`list-rollback-cas-exhausted: ${name}`);
    }
  }
}

export function applyTransferLists(plan, { beforeRename } = {}) {
  plan.lists = {};
  try {
    for (const name of ['never', 'pending', 'mine', 'hold']) {
      const path = join(plan.stateDir, name);
      for (let attempt = 0; ; attempt += 1) {
        const existed = existsSync(path);
        const before = readList(path);
        const after = transferList(name, before, plan.issue);
        if (before === after || atomicWrite(path, before, after, beforeRename)) {
          plan.lists[name] = { before, after, existed, changed: before !== after };
          break;
        }
        if (attempt === 3) throw new Error(`list-cas-exhausted: ${name}`);
      }
    }
  } catch (err) {
    restoreTransferLists(plan);
    throw err;
  }
}

const LOCK_HOLDER = `import fcntl, sys, time
with open(sys.argv[1], 'a') as lock:
    until = time.monotonic() + float(sys.argv[2])
    while True:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            break
        except BlockingIOError:
            if time.monotonic() >= until:
                sys.exit(73)
            time.sleep(0.05)
    print('locked', flush=True)
    sys.stdin.read()
`;

async function withTransferLock(lock, action) {
  const holder = spawn(
    'python3',
    ['-u', '-c', LOCK_HOLDER, lock.path, String(lock.timeoutSeconds)],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  let stderr = '';
  holder.stderr.on('data', (data) => {
    stderr += data;
  });
  holder.stdin.on('error', () => {});
  const exited = new Promise((resolve, reject) => {
    holder.once('error', reject);
    holder.once('exit', resolve);
  });
  try {
    await Promise.race([
      new Promise((resolve) => holder.stdout.once('data', resolve)),
      exited.then((code) => {
        throw new Error(
          code === 73
            ? `overnight-lock-timeout: ${lock.path}`
            : `overnight-lock-failed: ${stderr.trim() || code}`,
        );
      }),
    ]);
    return await action();
  } finally {
    holder.stdin.end();
    await exited;
  }
}

async function planTransfer(options, runner) {
  const { issue, agent = null, dryRun = false, repo = 'xiechimon/cairn' } = options;
  if (!Number.isSafeInteger(issue) || issue < 1) throw new Error('invalid-issue');
  if (!/^[\w-]+\/[\w.-]+$/.test(repo)) throw new Error('invalid-repo');
  if (agent !== null && (typeof agent !== 'string' || !agent.trim()))
    throw new Error('invalid-agent');
  const stateDir = resolve(options.stateDir ?? join(homedir(), '.local/state/overnight'));
  const lanesDir = resolve(options.lanesDir ?? join(homedir(), 'lanes'));
  const lane = join(lanesDir, `cairn-${issue}`);
  if ((await runner(['-c', 'if [ -e "$1" ]; then printf present; fi', 'sh', lane], 'sh')).trim())
    throw new Error(`lane-directory: ${lane}`);
  const processes = await runner(['-axo', 'command='], 'ps');
  const escapedLane = lane.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const runningLane = new RegExp(
    `\\bai-route\\s+run\\b.*?\\s-C\\s+['"]?${escapedLane}(?:['"]?(?:\\s|$))`,
  );
  if (processes.split('\n').some((line) => runningLane.test(line)))
    throw new Error(`lane-process: ${lane}`);
  const data = JSON.parse(await runner(['api', `repos/${repo}/issues/${issue}`]));
  if (data.state !== 'open') throw new Error('issue-closed');
  const pulls = JSON.parse(
    await runner(['api', `repos/${repo}/pulls?state=open&per_page=100`, '--paginate', '--slurp']),
  ).flat();
  const branches = JSON.parse(
    await runner(['api', `repos/${repo}/git/matching-refs/heads/lane/${issue}`]),
  );
  const escapedRepo = repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const closing = new RegExp(
    `\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s*:?\\s+(?:#${issue}|${escapedRepo}#${issue}|https://github\\.com/${escapedRepo}/issues/${issue})(?![\\d\\w])`,
    'i',
  );
  const lanePr = pulls.find((p) => p.head.ref === `lane/${issue}`);
  const closingPr = pulls.find((p) => closing.test(`${p.title ?? ''}\n${p.body ?? ''}`));
  if (lanePr) throw new Error(`lane-pr: #${lanePr.number}`);
  if (closingPr) throw new Error(`closing-pr: #${closingPr.number}`);
  if (branches.some((b) => b.ref === `refs/heads/lane/${issue}`))
    throw new Error(`lane-branch: lane/${issue}`);
  const labelsBefore = data.labels.map((label) => label.name);
  const labelsAfter = labelsBefore.filter((name) => {
    const lower = name.toLowerCase();
    return (
      !(lower.startsWith('by:') && lower !== 'by:cairn') &&
      !/^batch:b\d/i.test(name) &&
      !['batch:now', 'batch:next', 'batch:later'].includes(lower)
    );
  });
  for (const label of [
    'by:cairn',
    'ready-for-agent',
    ...(agent === null ? [] : [`agent:${agent}`]),
  ]) {
    if (!labelsAfter.some((name) => name.toLowerCase() === label.toLowerCase()))
      labelsAfter.push(label);
  }
  const lists = {};
  for (const name of ['never', 'pending', 'mine', 'hold']) {
    const before = readList(join(stateDir, name));
    const after = transferList(name, before, issue);
    lists[name] = { before, after, changed: before !== after };
  }
  const removed = labelsBefore.filter((name) => !labelsAfter.includes(name));
  const added = labelsAfter.filter((name) => !labelsBefore.includes(name));
  const changes =
    removed.length + added.length + Object.values(lists).filter((list) => list.changed).length;

  const plan = {
    stateDir,
    lanesDir,
    lock: {
      path: join(stateDir, 'lock2'),
      timeoutSeconds: options.lockTimeoutSeconds ?? 900,
      macOSFallback: 'python3 fcntl.flock holds lock2 through list edits and label PATCH',
    },
    issue,
    labelsBefore,
    labelsAfter,
    lists,
    lanes: { branch: false, openPulls: [] },
    agent,
    changes,
    dryRun,
  };
  if (!Number.isFinite(plan.lock.timeoutSeconds) || plan.lock.timeoutSeconds < 0)
    throw new Error('invalid-lock-timeout');
  return plan;
}

export async function transferToCairn(options, runner = runGh) {
  const plan = await planTransfer(options, runner);
  (options.printPlan ?? ((value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)))(
    plan,
  );
  if (plan.dryRun) return plan;
  mkdirSync(plan.stateDir, { recursive: true });
  await withTransferLock(plan.lock, async () => {
    Object.assign(plan, await planTransfer(options, runner));
    applyTransferLists(plan);
    try {
      if (JSON.stringify(plan.labelsBefore) !== JSON.stringify(plan.labelsAfter)) {
        await runner([
          'api',
          `repos/${options.repo ?? 'xiechimon/cairn'}/issues/${plan.issue}`,
          '--method',
          'PATCH',
          ...plan.labelsAfter.flatMap((label) => ['-f', `labels[]=${label}`]),
        ]);
      }
    } catch (err) {
      restoreTransferLists(plan);
      throw err;
    }
  });
  return plan;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    const options = { issue: Number(args.shift()) };
    while (args.length) {
      const arg = args.shift();
      if (arg === '--dry-run') options.dryRun = true;
      else if (
        ['--state-dir', '--lanes-dir', '--repo', '--agent', '--lock-timeout'].includes(arg) &&
        args[0] &&
        !args[0].startsWith('--')
      ) {
        const key = {
          '--state-dir': 'stateDir',
          '--lanes-dir': 'lanesDir',
          '--repo': 'repo',
          '--agent': 'agent',
          '--lock-timeout': 'lockTimeoutSeconds',
        }[arg];
        options[key] = arg === '--lock-timeout' ? Number(args.shift()) : args.shift();
      } else throw new Error(`invalid-option: ${arg}`);
    }
    await transferToCairn(options);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  }
}
