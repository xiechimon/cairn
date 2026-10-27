import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { METRICS } from './baseline-ledger.mjs';

export const PROTECTED_FILES = [
  'scripts/prepush-known-red.json',
  ...new Set(METRICS.map((metric) => metric.file)),
];

export function closingIssues(body) {
  const issues = new Set();
  for (const line of (body ?? '').split(/\r?\n/)) {
    if (!/^[ \t]*closes[ \t]+#[1-9]\d*(?:[ \t]*,[ \t]*closes[ \t]+#[1-9]\d*)*[ \t]*$/i.test(line))
      continue;
    for (const match of line.matchAll(/closes[ \t]+#([1-9]\d*)/gi)) issues.add(Number(match[1]));
  }
  return [...issues];
}

export function baselineOwnerFailures(files, issues, labels) {
  const protectedFiles = new Set(PROTECTED_FILES);
  if (issues.length > 0 && issues.every((issue) => labels[issue]?.includes('main-red'))) return [];
  return files.filter((file) => protectedFiles.has(file));
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const pr = event.pull_request;
    if (!pr) throw new Error('PR event is required');
    const files = execFileSync(
      'git',
      ['diff', '--name-only', '--no-renames', '-z', `${pr.base.sha}...${pr.head.sha}`, '--'],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    )
      .split('\0')
      .filter(Boolean);
    const issues = closingIssues(pr.body);
    const labels = {};
    if (baselineOwnerFailures(files, [], {}).length > 0) {
      for (const issue of issues) {
        labels[issue] = JSON.parse(
          execFileSync(
            'gh',
            [
              'api',
              `repos/${event.repository.full_name}/issues/${issue}/labels`,
              '--paginate',
              '--slurp',
            ],
            { encoding: 'utf8' },
          ),
        )
          .flat()
          .map((label) => label.name);
      }
    }
    const failures = baselineOwnerFailures(files, issues, labels);
    if (failures.length > 0) {
      console.error(`baseline-owner-gate: protected files:\n${failures.join('\n')}`);
      console.error(
        'Only main-health fix PRs may change these files. Declare Closes #N lines in the PR body; every declared issue must carry the main-red label.',
      );
      process.exitCode = 1;
    } else {
      console.log('baseline-owner-gate: PASS');
    }
  } catch (error) {
    console.error(`baseline-owner-gate: ${error.message}`);
    process.exitCode = 2;
  }
}
