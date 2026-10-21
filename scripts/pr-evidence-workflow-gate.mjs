#!/usr/bin/env node
// PR evidence workflow shape gate (2026-10-21, after #1435): pr-evidence is a
// required status check on main and carries the needs-decision guard, so its
// shape has load-bearing parts that a routine edit can silently defeat:
//
//   - a job-level `if:` (or a `paths:` filter on the trigger) makes GitHub
//     report the skipped job as a passing check, which supersedes an earlier
//     red run and lets auto-merge through;
//   - a job-level `name:` renames the check, and branch protection then waits
//     forever for a context nobody reports;
//   - dropping `labeled` / `unlabeled` / `auto_merge_enabled` from the trigger
//     list leaves a labelled PR green until the next push or body edit.
//
// Zero-dependency on purpose (runs pre-install in the check job, like
// lane-file-gate.mjs): the file is read line by line against the two-space
// indentation the workflow uses, not parsed as YAML.
import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? '.github/workflows/pr-evidence.yml';
const lines = readFileSync(file, 'utf8').split('\n');
const failures = [];

const indexOf = (re, from = 0) => lines.findIndex((line, i) => i >= from && re.test(line));
const block = (start, indent) => {
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    if (line.search(/\S/) <= indent) break;
    out.push(line);
  }
  return out;
};

const prEvent = indexOf(/^ {2}pull_request:\s*$/);
if (prEvent === -1) failures.push('on.pull_request trigger missing');
else {
  const body = block(prEvent, 2);
  const types = body.find((line) => /^ {4}types:/.test(line)) ?? '';
  for (const type of ['edited', 'labeled', 'unlabeled', 'auto_merge_enabled']) {
    if (!new RegExp(`[\\[,]\\s*${type}\\s*[,\\]]`).test(types))
      failures.push(
        `on.pull_request.types lacks ${type}: a labelled PR would stay green until the next push`,
      );
  }
  if (body.some((line) => /^ {4}paths(-ignore)?:/.test(line)))
    failures.push(
      'on.pull_request has a paths filter: a skipped run counts as a passing required check',
    );
}

const job = indexOf(/^ {2}pr-evidence:\s*$/);
if (job === -1)
  failures.push('job key must be exactly `pr-evidence` (the branch-protection context)');
else {
  const body = block(job, 2);
  if (body.some((line) => /^ {4}if:/.test(line)))
    failures.push(
      'jobs.pr-evidence has a job-level if: a skipped job reports success and supersedes a red run',
    );
  if (body.some((line) => /^ {4}name:/.test(line)))
    failures.push(
      'jobs.pr-evidence overrides name: branch protection waits on a context nobody reports',
    );
  const steps = body.filter((line) => /^ {6}- /.test(line));
  const labelStep = steps.findIndex((line) => /needs-decision/.test(line));
  if (labelStep === -1)
    failures.push('no step mentions needs-decision: the decision guard is gone');
}

if (failures.length) {
  for (const f of failures) console.log(`FAIL workflow-shape: ${f}`);
  console.log('pr-evidence-workflow: RED');
  process.exit(1);
}
console.log('pr-evidence-workflow: GREEN (required-check shape intact)');
