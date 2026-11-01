import { execFileSync, spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
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
  for (const pull of pulls) {
    const ownership = JSON.parse(
      await runner([
        'pr',
        'view',
        String(pull.number),
        '--repo',
        repo,
        '--json',
        'closingIssuesReferences,commits',
      ]),
    );
    if (
      ownership.closingIssuesReferences.some(
        (reference) => reference.url === `https://github.com/${repo}/issues/${issue}`,
      )
    )
      throw new Error(`closing-pr-reference: #${pull.number}`);
    if (
      ownership.commits.some((commit) =>
        closing.test(`${commit.messageHeadline ?? ''}\n${commit.messageBody ?? ''}`),
      )
    )
      throw new Error(`closing-pr-commit: #${pull.number}`);
  }
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
    const content = readList(join(stateDir, name));
    const present = content.split('\n').some((line) => line.trim() === String(issue));
    if (name === 'never') {
      if (!present && content && !content.endsWith('\n')) throw new Error('never-missing-newline');
      lists.never = present ? 'already' : 'appended';
    } else lists[name] = present;
  }
  const removed = labelsBefore.filter((name) => !labelsAfter.includes(name));
  const added = labelsAfter.filter((name) => !labelsBefore.includes(name));
  const changes = removed.length + added.length + Number(lists.never === 'appended');

  const plan = {
    stateDir,
    lanesDir,
    lock: {
      path: join(stateDir, 'lock2'),
      timeoutSeconds: options.lockTimeoutSeconds ?? 900,
      macOSFallback: 'python3 fcntl.flock holds lock2 through never append and label PATCH',
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
    if (plan.lists.never === 'appended') {
      const entry = Buffer.from(`${plan.issue}\n`, 'ascii');
      const fd = openSync(join(plan.stateDir, 'never'), 'a', 0o600);
      try {
        if (writeSync(fd, entry) !== entry.length) throw new Error('never-append-incomplete');
      } finally {
        closeSync(fd);
      }
    }
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
      throw new Error(
        `label-patch-failed: ${err.message}; never: ${plan.lists.never} (retained); rerun the transfer to retry labels`,
        { cause: err },
      );
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
