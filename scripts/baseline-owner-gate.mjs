import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const STRUCTURE_PIN = 'scripts/ci-job-structure-baseline.json';

export function isProtectedPath(file) {
  if (file === STRUCTURE_PIN) return false;
  if (file === 'scripts/prepush-known-red.json') return true;
  return /^scripts\/[^/]+-(?:allowlist|baseline)\.json$/.test(file);
}

export function closingIssues(body) {
  const issues = new Set();
  for (const line of (body ?? '').split(/\r?\n/)) {
    if (!/^[ \t]*closes[ \t]+#[1-9]\d*(?:[ \t]*,[ \t]*closes[ \t]+#[1-9]\d*)*[ \t]*$/i.test(line))
      continue;
    for (const match of line.matchAll(/closes[ \t]+#([1-9]\d*)/gi)) issues.add(Number(match[1]));
  }
  return [...issues];
}

export function isCuratedMainRed(meta) {
  const labels = meta?.labels ?? [];
  const title = meta?.title ?? '';
  if (!labels.includes('main-red')) return false;
  if (/^main\s+red:/i.test(title.trim())) return false;
  return true;
}

export function baselineOwnerFailures(files, issues, metaByIssue) {
  const protectedFiles = files.filter(isProtectedPath);
  if (protectedFiles.length === 0) return [];
  if (
    issues.length > 0 &&
    issues.every((issue) => isCuratedMainRed(metaByIssue[issue] ?? { labels: [], title: '' }))
  )
    return [];
  return protectedFiles;
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
    const metaByIssue = {};
    if (baselineOwnerFailures(files, [], {}).length > 0) {
      for (const issue of issues) {
        const payload = JSON.parse(
          execFileSync('gh', ['api', `repos/${event.repository.full_name}/issues/${issue}`], {
            encoding: 'utf8',
          }),
        );
        metaByIssue[issue] = {
          labels: (payload.labels ?? []).map((label) => label.name),
          title: payload.title ?? '',
        };
      }
    }
    const failures = baselineOwnerFailures(files, issues, metaByIssue);
    if (failures.length > 0) {
      console.error(`baseline-owner-gate: protected files:\n${failures.join('\n')}`);
      console.error(
        'Only main-health fix PRs may change these files. Declare Closes #N lines in the PR body; every declared issue must carry the main-red label and must not be a main-watch alert titled "main red: …".',
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
