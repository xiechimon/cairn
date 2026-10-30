const exitCodes = { unknown: 2, complete: 0, paused: 20, failed: 30, incomplete: 10 };
const humanLabels = new Set(['needs-decision', 'waits-ian', 'ready-for-human']);
export const shaPattern = /^[a-f0-9]{40}$/;
export const isoPattern = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/;
export function requireFact(condition, message) {
  if (!condition) throw new Error(message);
}
export function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0 && !value.includes('\0');
}
function exactKeys(value, required, optional = []) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
  );
}
export function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}
export function unique(values, valid) {
  return Array.isArray(values) && values.every(valid) && new Set(values).size === values.length;
}
export function validateManifest(manifest, epic) {
  requireFact(
    exactKeys(manifest, ['epic', 'issues', 'requiredChecks', 'checks', 'maxHours']) ||
      exactKeys(manifest, ['epic', 'items', 'requiredChecks', 'checks', 'maxHours']),
    'Invalid manifest',
  );
  const { requiredChecks, checks, maxHours } = manifest;
  const issues = manifest.issues ?? manifest.items?.map((item) => item.issue);
  requireFact(
    manifest.epic === epic &&
      unique(issues, positiveInteger) &&
      issues.length > 0 &&
      unique(requiredChecks, nonempty) &&
      requiredChecks.length > 0 &&
      Array.isArray(checks) &&
      new Set(checks.map((check) => check?.name)).size === checks.length &&
      checks.every(
        (check) =>
          exactKeys(check, ['name', 'run'], ['expectStdoutIncludes']) &&
          nonempty(check.name) &&
          Array.isArray(check.run) &&
          nonempty(check.run[0]) &&
          check.run.every((arg) => typeof arg === 'string' && !arg.includes('\0')) &&
          (!Object.hasOwn(check, 'expectStdoutIncludes') ||
            typeof check.expectStdoutIncludes === 'string'),
      ) &&
      typeof maxHours === 'number' &&
      Number.isFinite(maxHours * 3600000) &&
      maxHours > 0,
    'Invalid manifest',
  );
  if (manifest.items) {
    const ids = manifest.items.map((item) => item.id);
    requireFact(unique(ids, nonempty), 'Invalid manifest item ids');
    for (const item of manifest.items)
      requireFact(
        exactKeys(item, ['id', 'issue', 'dependsOn'], ['humanHeld']) &&
          unique(item.dependsOn, (id) => ids.includes(id) && id !== item.id) &&
          (item.humanHeld === undefined || typeof item.humanHeld === 'boolean'),
        'Invalid manifest dependency',
      );
    const visiting = new Set();
    const visited = new Set();
    const visit = (id) => {
      requireFact(!visiting.has(id), 'Invalid manifest dependency cycle');
      if (visited.has(id)) return;
      visiting.add(id);
      for (const dependency of manifest.items.find((item) => item.id === id).dependsOn)
        visit(dependency);
      visiting.delete(id);
      visited.add(id);
    };
    for (const id of ids) visit(id);
  }
  return manifest;
}
export function nodes(connection, context) {
  requireFact(
    Array.isArray(connection?.nodes) && connection.pageInfo?.hasNextPage === false,
    `Missing or partial GitHub ${context}`,
  );
  return connection.nodes;
}
export function labels(connection) {
  return nodes(connection, 'labels').map((label) => label.name);
}
export function errorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  const stderr = error?.stderr?.toString().trim().slice(-2000);
  return stderr ? `${message.split('\n')[0]}\n${stderr}` : message;
}
export function parseShas(output) {
  const shas = output.trim() ? output.trim().split('\n') : [];
  requireFact(
    unique(shas, (sha) => shaPattern.test(sha)),
    'Malformed git ancestry',
  );
  return shas;
}
function issueBlocker({ number, state, stateReason, closingSha }, history) {
  if (state !== 'CLOSED') return `Issue #${number} is open.`;
  if (stateReason !== 'COMPLETED') return `Issue #${number} has closing reason ${stateReason}.`;
  if (!closingSha) return `Issue #${number} has no merged PR or closing commit.`;
  if (!history.has(closingSha)) return `Issue #${number}: ${closingSha} is not on main.`;
  return null;
}
function requiredCheckFailures({ sha, runs }, requiredChecks) {
  return requiredChecks.flatMap((name) => {
    const matching = runs.filter((run) => run.name === name && run.app?.slug === 'github-actions');
    if (!matching.length) return [`required check "${name}" has no run on ${sha}`];
    const latest = matching.reduce((left, right) => (right.id > left.id ? right : left));
    return latest.status === 'completed' && latest.conclusion === 'success'
      ? []
      : [`required check "${name}" is not successful on ${sha}`];
  });
}
export function activeHoursAt(startedAt, pauseIntervals, at) {
  const end = Date.parse(at);
  let cursor = Math.min(Date.parse(startedAt), end);
  let active = 0;
  for (const interval of pauseIntervals) {
    const pauseStart = Math.min(end, Math.max(cursor, Date.parse(interval.startedAt)));
    active += pauseStart - cursor;
    cursor = Math.max(pauseStart, Math.min(end, Date.parse(interval.endedAt ?? at)));
  }
  return (active + end - cursor) / 3600000;
}
export function decideEpic(facts) {
  try {
    const { manifest, issues, commits, checks, now, startedAt, pause, fail } = facts;
    validateManifest(manifest, manifest?.epic);
    requireFact(
      issues.length === (manifest.issues ?? manifest.items).length &&
        issues.every(
          (issue, index) =>
            issue.number === (manifest.issues ?? manifest.items.map((item) => item.issue))[index],
        ) &&
        checks.length === manifest.checks.length,
      'Missing gathered facts',
    );
    const reasons = [];
    const definitions =
      manifest.items ??
      manifest.issues.map((issue) => ({
        id: String(issue),
        issue,
        dependsOn: [],
      }));
    const historySet = new Set(facts.history);
    const items = definitions.map((definition, index) => {
      const issue = issues[index];
      const blocker = issueBlocker(issue, historySet);
      const missingPull = manifest.items && !issue.mergedPr;
      if (blocker) reasons.push(blocker);
      if (missingPull) reasons.push(`Issue #${issue.number} has no merged closing PR.`);
      const held =
        definition.humanHeld ||
        issue.labels.some((label) => humanLabels.has(label)) ||
        issue.linkedPulls.some(
          (pull) =>
            pull.state === 'OPEN' &&
            (pull.isDraft === true || pull.labels.some((label) => humanLabels.has(label))),
        );
      const needsOwner = manifest.items && issue.state === 'CLOSED' && (blocker || missingPull);
      return {
        id: definition.id,
        status:
          !blocker && !missingPull
            ? 'done'
            : needsOwner
              ? 'needsOwner'
              : held
                ? 'humanHeld'
                : 'ready',
        pr: issue.pr ?? null,
      };
    });
    const byId = new Map(items.map((item) => [item.id, item]));
    const classified = new Set();
    const classify = (definition) => {
      if (classified.has(definition.id)) return;
      for (const id of definition.dependsOn) classify(definitions.find((item) => item.id === id));
      const item = byId.get(definition.id);
      if (
        item.status === 'ready' &&
        definition.dependsOn.some((id) => byId.get(id).status !== 'done')
      )
        item.status = 'blocked';
      classified.add(definition.id);
    };
    for (const definition of definitions) classify(definition);
    const humanHeld = items.filter((item) => item.status === 'humanHeld').map((item) => item.id);
    const needsOwner = items.filter((item) => item.status === 'needsOwner').map((item) => item.id);
    const blocked = items.filter((item) => item.status === 'blocked').map((item) => item.id);
    const ready = items.filter((item) => item.status === 'ready').map((item) => item.id);
    const mainSha = facts.mainSha;
    requireFact(
      commits.length === 1 && commits[0].sha === mainSha,
      'Missing or reordered examined main commits',
    );
    const failures = requiredCheckFailures(commits[0], manifest.requiredChecks);
    const mainGreen = failures.length === 0;
    reasons.push(...failures);
    for (const check of checks)
      if (check.status !== 'passed')
        reasons.push(`Check "${check.name}" ${check.status}: ${check.reason}`);
    const activeHours = activeHoursAt(startedAt ?? now, facts.pauseIntervals ?? [], now);
    const complete =
      items.every((item) => item.status === 'done') &&
      mainGreen &&
      checks.every((check) => check.status === 'passed');
    let completedAt = null;
    if (complete && !fail && !pause) {
      const completionTimes = issues.map((issue) => issue.closingAt);
      for (const name of manifest.requiredChecks) {
        const runs = commits[0].runs.filter(
          (run) => run.name === name && run.app?.slug === 'github-actions',
        );
        const greenRuns = runs.filter(
          (run) => run.status === 'completed' && run.conclusion === 'success',
        );
        for (const run of greenRuns)
          requireFact(
            isoPattern.test(run.completed_at) && Number.isFinite(Date.parse(run.completed_at)),
            'Missing or malformed check completion time',
          );
        completionTimes.push(
          new Date(Math.min(...greenRuns.map((run) => Date.parse(run.completed_at)))).toISOString(),
        );
      }
      requireFact(
        completionTimes.every(
          (time) => isoPattern.test(time) && Number.isFinite(Date.parse(time)),
        ),
        'Missing or malformed completion time',
      );
      completedAt = new Date(Math.max(...completionTimes.map((time) => Date.parse(time)))).toISOString();
    }
    const elapsed = complete
      ? activeHoursAt(startedAt ?? now, facts.pauseIntervals ?? [], completedAt) > manifest.maxHours
      : activeHours >= manifest.maxHours;
    let state = 'incomplete';
    if (fail) {
      state = 'failed';
      reasons.push(`Failed: ${fail}`);
    } else if (pause) {
      state = 'paused';
      reasons.push(`Paused: ${pause}`);
    } else if (elapsed) {
      state = 'failed';
      reasons.push(`Time cap of ${manifest.maxHours} hours elapsed since ${startedAt}.`);
    } else if (!ready.length && (humanHeld.length || needsOwner.length)) {
      state = 'paused';
      reasons.push(`Waiting on owner: ${[...humanHeld, ...needsOwner].join(', ')}.`);
    } else if (complete) {
      state = 'complete';
      reasons.push(`Every issue is completed on main; required checks passed at ${mainSha}.`);
    }
    const closingShas = new Set(issues.map((issue) => issue.closingSha));
    return {
      state,
      exitCode: exitCodes[state],
      items,
      humanHeld,
      needsOwner,
      blocked,
      ready,
      mainSha,
      mainGreen,
      completedAt,
      reasons,
      greenSha: mainGreen ? mainSha : null,
      lastClosingSha: facts.history.find((sha) => closingShas.has(sha)) ?? null,
    };
  } catch (error) {
    return { state: 'unknown', exitCode: 2, reasons: [errorMessage(error)] };
  }
}
