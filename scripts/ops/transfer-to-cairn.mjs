import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function runGh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
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

export async function transferToCairn(options, runner = runGh) {
  const { issue, agent = null, dryRun = false, repo = 'xiechimon/cairn' } = options;
  if (!Number.isSafeInteger(issue) || issue < 1) throw new Error('invalid-issue');
  if (!/^[\w-]+\/[\w.-]+$/.test(repo)) throw new Error('invalid-repo');
  if (agent !== null && (typeof agent !== 'string' || !agent.trim()))
    throw new Error('invalid-agent');
  const stateDir = resolve(options.stateDir ?? join(homedir(), '.local/state/overnight'));
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
  if (!dryRun) {
    if (Object.values(lists).some((list) => list.changed)) mkdirSync(stateDir, { recursive: true });
    for (const [name, list] of Object.entries(lists)) {
      if (list.changed) atomicWrite(join(stateDir, name), list.after);
    }
    if (removed.length || added.length) {
      await runner([
        'api',
        `repos/${repo}/issues/${issue}`,
        '--method',
        'PATCH',
        ...labelsAfter.flatMap((label) => ['-f', `labels[]=${label}`]),
      ]);
    }
  }
  return {
    issue,
    labelsBefore,
    labelsAfter,
    lists,
    lanes: { branch: false, openPulls: [] },
    agent,
    changes,
    dryRun,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    const options = { issue: Number(args.shift()) };
    while (args.length) {
      const arg = args.shift();
      if (arg === '--dry-run') options.dryRun = true;
      else if (
        ['--state-dir', '--repo', '--agent'].includes(arg) &&
        args[0] &&
        !args[0].startsWith('--')
      ) {
        options[{ '--state-dir': 'stateDir', '--repo': 'repo', '--agent': 'agent' }[arg]] =
          args.shift();
      } else throw new Error(`invalid-option: ${arg}`);
    }
    process.stdout.write(`${JSON.stringify(await transferToCairn(options), null, 2)}\n`);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  }
}
