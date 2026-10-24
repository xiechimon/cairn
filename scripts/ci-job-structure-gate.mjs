#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function parseWorkflowJobs(workflow) {
  const jobs = new Map();
  let inJobs = false;
  let currentJob = null;
  for (const line of workflow.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      currentJob = null;
      continue;
    }
    if (!inJobs) continue;
    const jobKey = line.match(/^ {2}([^\s:#][^:]*):\s*$/);
    if (jobKey) {
      currentJob = jobKey[1];
      jobs.set(currentJob, []);
      continue;
    }
    const stepName = line.match(/^ {6}- name: (.+?)\s*$/);
    if (stepName && currentJob) jobs.get(currentJob).push(stepName[1]);
  }
  return jobs;
}

export function structureFailures(workflow, baseline) {
  const failures = [];
  const actual = parseWorkflowJobs(workflow);
  for (const [job, steps] of actual) {
    for (const step of new Set(steps.filter((name, index) => steps.indexOf(name) !== index)))
      failures.push(`job "${job}" lists step "${step}" more than once`);
  }
  for (const job of actual.keys())
    if (!Object.hasOwn(baseline, job)) failures.push(`job "${job}" is not in the baseline`);
  for (const job of Object.keys(baseline))
    if (!actual.has(job)) failures.push(`baseline job "${job}" is gone from the workflow`);
  for (const [job, expectedSteps] of Object.entries(baseline)) {
    const actualSteps = actual.get(job);
    if (!actualSteps) continue;
    for (const step of expectedSteps) {
      if (actualSteps.includes(step)) continue;
      const movedTo = [...actual.entries()].find(([, steps]) => steps.includes(step));
      failures.push(
        movedTo
          ? `step "${step}" is in job "${movedTo[0]}" but the baseline pins it to job "${job}"`
          : `baseline expects step "${step}" in job "${job}" but the job has no such step`,
      );
    }
    for (const step of actualSteps) {
      if (expectedSteps.includes(step)) continue;
      const pinnedJob = Object.entries(baseline).find(
        ([otherJob, otherSteps]) => otherJob !== job && otherSteps.includes(step),
      );
      if (!pinnedJob) failures.push(`step "${step}" in job "${job}" is not in the baseline`);
      else if (actual.get(pinnedJob[0])?.includes(step))
        failures.push(
          `step "${step}" in job "${job}" duplicates the step pinned to job "${pinnedJob[0]}"`,
        );
    }
  }
  return failures;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const workflowPath =
    process.argv[2] ?? resolve(import.meta.dirname, '../.github/workflows/ci.yml');
  const baselinePath =
    process.argv[3] ?? resolve(import.meta.dirname, 'ci-job-structure-baseline.json');
  const failures = structureFailures(
    readFileSync(workflowPath, 'utf8'),
    JSON.parse(readFileSync(baselinePath, 'utf8')),
  );
  if (failures.length > 0) {
    for (const failure of failures) console.log(`FAIL ci-job-structure: ${failure}`);
    console.log('ci-job-structure: RED');
    process.exit(1);
  }
  console.log('ci-job-structure: GREEN (every named step sits in its pinned job)');
}
