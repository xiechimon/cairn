import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function checkSilentReverts({ cwd, base, baseHead, head, pulls, body }) {
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const tip = baseHead ?? pulls.at(-1)?.merge_commit_sha ?? base;
  const interval = new Set(git('rev-list', `${base}..${tip}`).trim().split('\n'));
  const owners = new Map();
  for (const pull of pulls) {
    const sha = pull.merge_commit_sha;
    if (!sha || !interval.has(sha)) continue;
    const reference = new RegExp(`(?:#|/pull/)${pull.number}(?![0-9])`);
    if (reference.test(body)) continue;
    for (const commit of git('rev-list', `${sha}^1..${sha}`).trim().split('\n')) {
      owners.set(commit, pull.number);
    }
  }
  let merged;
  try {
    merged = git('merge-tree', '--write-tree', tip, head).trim().split('\n')[0];
  } catch (error) {
    const text = typeof error.stdout === 'string' ? error.stdout : '';
    merged = text.trim().split('\n')[0];
    if (!/^[a-f0-9]{40,64}$/.test(merged)) throw error;
  }
  const failures = [];
  const renames = new Map();
  const statuses = git('diff', '--name-status', '-z', '--find-renames', tip, merged).split('\0');
  for (let i = 0; i < statuses.length - 1; ) {
    const status = statuses[i++];
    const path = statuses[i++];
    if (status.startsWith('R')) renames.set(path, statuses[i++]);
  }
  const paths = git('diff', '--no-renames', '--name-only', '-z', tip, merged)
    .split('\0')
    .filter(Boolean);
  for (const path of paths) {
    const patch = renames.has(path)
      ? git(
          'diff',
          '--no-ext-diff',
          '--no-textconv',
          '--unified=0',
          `${tip}:${path}`,
          `${merged}:${renames.get(path)}`,
        )
      : git(
          'diff',
          '--no-ext-diff',
          '--no-textconv',
          '--unified=0',
          '--no-renames',
          tip,
          merged,
          '--',
          path,
        );
    const removed = new Set();
    let line = 0;
    for (const text of patch.split('\n')) {
      const hunk = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(text);
      if (hunk) line = Number(hunk[1]);
      else if (line > 0 && text.startsWith('-')) removed.add(line++);
      else if (text.startsWith(' ')) line++;
    }
    if (removed.size === 0) continue;
    let commit;
    let finalLine;
    for (const entry of git('blame', '--line-porcelain', tip, '--', path).split('\n')) {
      const header = /^([a-f0-9]{40,64}) \d+ (\d+)(?: \d+)?$/.exec(entry);
      if (header) {
        commit = header[1];
        finalLine = Number(header[2]);
      } else if (entry.startsWith('\t') && removed.has(finalLine) && owners.has(commit)) {
        failures.push({ number: owners.get(commit), path, line: finalLine, text: entry.slice(1) });
      }
    }
  }
  return failures;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const pull = event.pull_request;
    if (!pull) throw new Error('silent-revert-gate requires a pull_request event');
    const baseHead = pull.base.sha;
    const head = pull.head.sha;
    const base = execFileSync('git', ['merge-base', baseHead, head], { encoding: 'utf8' }).trim();
    const repo = process.env.GITHUB_REPOSITORY;
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '')) throw new Error('invalid GITHUB_REPOSITORY');
    const pages = JSON.parse(
      execFileSync(
        'gh',
        [
          'api',
          '--paginate',
          '--slurp',
          '-X',
          'GET',
          `repos/${repo}/pulls`,
          '-f',
          'state=closed',
          '-f',
          'sort=updated',
          '-f',
          'direction=desc',
          '-f',
          'per_page=100',
        ],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
      ),
    );
    const pulls = pages.flat().filter((item) => item.merged_at && item.number !== pull.number);
    const failures = checkSilentReverts({
      cwd: process.cwd(),
      base,
      baseHead,
      head,
      pulls,
      body: pull.body ?? '',
    });
    for (const failure of failures)
      console.error(
        `silent-revert-gate: PR #${failure.number} ${failure.path}:${failure.line}: ${failure.text}`,
      );
    if (failures.length)
      throw new Error('Name each affected PR in the PR body and explain the removal.');
    console.log('silent-revert-gate: 0 unexplained removals');
  } catch (error) {
    console.error(`silent-revert-gate: ${error.message}`);
    process.exitCode = 1;
  }
}
