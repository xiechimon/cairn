import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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

function atomicWrite(path, content) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, Buffer.from(content, 'latin1'), { flag: 'wx', mode: 0o600 });
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}

export function applyTransferLists(plan) {
  for (const [name, list] of Object.entries(plan.lists)) {
    if (readList(join(plan.stateDir, name)) !== list.before)
      throw new Error(`lists-changed: ${name}`);
  }
  for (const [name, list] of Object.entries(plan.lists)) {
    if (list.changed) atomicWrite(join(plan.stateDir, name), list.after);
  }
}

const MACOS_FLOCK_FALLBACK = `import fcntl, subprocess, sys, time
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
    sys.exit(subprocess.call(sys.argv[3:]))
`;

export async function transferToCairn(options, runner = runGh) {
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
    const lines = before.match(/[^\n]*\n|[^\n]+$/g) ?? [];
    const contains = lines.some((line) => line.trim() === String(issue));
    const after =
      name === 'never'
        ? contains
          ? before
          : `${before}${before && !before.endsWith('\n') ? '\n' : ''}${issue}\n`
        : lines.filter((line) => line.trim() !== String(issue)).join('');
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
      timeoutSeconds: options.lockTimeoutSeconds ?? 10,
      macOSFallback: 'python3 fcntl.flock holds the same lock2 while applying lists',
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
  (options.printPlan ?? ((value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)))(
    plan,
  );
  if (dryRun) return plan;
  if (removed.length || added.length) {
    await runner([
      'api',
      `repos/${repo}/issues/${issue}`,
      '--method',
      'PATCH',
      ...labelsAfter.flatMap((label) => ['-f', `labels[]=${label}`]),
    ]);
  }
  if (Object.values(lists).some((list) => list.changed)) {
    try {
      mkdirSync(stateDir, { recursive: true });
      const args = [
        process.execPath,
        new URL(import.meta.url).pathname,
        '--apply-lists',
        JSON.stringify(plan),
      ];
      const flock = (await runner(['-c', 'command -v flock || true'], 'sh')).trim();
      if (flock) {
        await runner(
          [
            '--exclusive',
            '--timeout',
            String(plan.lock.timeoutSeconds),
            '--conflict-exit-code',
            '73',
            plan.lock.path,
            ...args,
          ],
          'flock',
        );
      } else {
        await runner(
          ['-c', MACOS_FLOCK_FALLBACK, plan.lock.path, String(plan.lock.timeoutSeconds), ...args],
          'python3',
        );
      }
    } catch (err) {
      const redo = Object.entries(lists)
        .filter(([name, list]) => readList(join(stateDir, name)) !== list.after)
        .map(([name, list]) => ({ path: join(stateDir, name), after: list.after }));
      const reason =
        err.status === 73
          ? `overnight-lock-timeout: ${plan.lock.path}`
          : `list-edit-failed: ${err.stderr?.toString().trim() || err.message}`;
      throw new Error(
        `${reason}; labels already applied; redo list edits after re-planning under lock2: ${JSON.stringify(redo)}`,
      );
    }
  }
  return plan;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv[2] === '--apply-lists') {
      applyTransferLists(JSON.parse(process.argv[3]));
      process.exit(0);
    }
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
