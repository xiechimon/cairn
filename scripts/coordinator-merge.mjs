import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { api, markers, pages, repo } from './autonomy-brake.mjs';
import { mustBeGreenJobs } from './merge-checks.mjs';

const minimumChecks = 4;
const closingLine = /^(?:closes|fixes|resolves) #\d+$/i;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const gh = (...args) =>
  execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 }).trim();

function readHead(number) {
  try {
    const sha = api(`repos/${repo}/pulls/${number}`)?.head?.sha;
    return /^[a-f0-9]{40}$/.test(sha ?? '') ? sha : null;
  } catch {
    return null;
  }
}

export function mergeMessage(number, messages) {
  const [first] = messages;
  const lines = first.split('\n');
  const subject = `${lines[0]} (#${number})`;
  let body = lines.slice(2).join('\n');
  const present = new Set(body.split('\n').map((line) => line.trim().toLowerCase()));
  for (const message of messages)
    for (const line of message.split('\n').map((entry) => entry.trim())) {
      if (!closingLine.test(line) || present.has(line.toLowerCase())) continue;
      present.add(line.toLowerCase());
      body = body ? `${body}\n\n${line}` : line;
    }
  return { subject, body };
}

const isGreen = (check) => check.bucket === 'pass' || check.bucket === 'skipping';

const mustBeGreenStates = ['SUCCESS', 'SKIPPED'];

function readChecks(number, ...extra) {
  return JSON.parse(
    gh('pr', 'checks', String(number), '-R', repo, ...extra, '--json', 'name,bucket,state'),
  );
}

function checksGreen(number) {
  const required = readChecks(number, '--required');
  if (required.length < minimumChecks || !required.every(isGreen)) return false;
  const all = readChecks(number);
  return mustBeGreenJobs.every((name) => {
    const runs = all.filter((check) => check.name === name);
    return runs.length > 0 && runs.every((check) => mustBeGreenStates.includes(check.state));
  });
}

function braked() {
  try {
    return markers().length > 0;
  } catch {
    return true;
  }
}

function merge(number, head) {
  const commits = pages(`repos/${repo}/pulls/${number}/commits?per_page=100`).flat();
  const { subject, body } = mergeMessage(
    number,
    commits.map((entry) => entry.commit.message),
  );
  gh(
    'pr',
    'merge',
    String(number),
    '-R',
    repo,
    '--squash',
    '--subject',
    subject,
    '--body',
    body,
    '--match-head-commit',
    head,
  );
  const state = JSON.parse(
    gh('pr', 'view', String(number), '-R', repo, '--json', 'state,mergeCommit'),
  );
  console.log(`${number} ${state.state} ${state.mergeCommit?.oid ?? ''}`);
}

export async function coordinate(number, { iterations = 90, intervalMs = 60_000 } = {}) {
  for (let i = 0; i < iterations; i++) {
    if (i) await sleep(intervalMs);
    const head = readHead(number);
    if (!head) continue;
    let green;
    try {
      green = checksGreen(number);
    } catch {
      continue;
    }
    if (!green || braked()) continue;
    if (readHead(number) !== head) continue;
    try {
      merge(number, head);
      return true;
    } catch (error) {
      console.error(`${number} merge failed: ${error.message}`);
      return false;
    }
  }
  console.log(`${number} timed out waiting for merge`);
  return false;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href
) {
  const numbers = process.argv.slice(2);
  if (!numbers.length || !numbers.every((value) => /^[1-9]\d*$/.test(value))) {
    console.error('Usage: coordinator-merge.mjs <pr-number>...');
    process.exit(1);
  }
  const options = {
    iterations: Number(process.env.COORDINATOR_MERGE_ITERATIONS ?? 90),
    intervalMs: Number(process.env.COORDINATOR_MERGE_INTERVAL_MS ?? 60_000),
  };
  let failed = false;
  for (const number of numbers) if (!(await coordinate(Number(number), options))) failed = true;
  process.exitCode = failed ? 1 : 0;
}
