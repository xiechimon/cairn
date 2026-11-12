import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { mustBeGreenJobs, requiredChecks } from './merge-checks.mjs';

const prGatePath = '.claude/workflows/pr-gate.js';
const gatePathsPath = 'packages/shared/merge-gate-paths.json';
export const configPath = '.mergify.yml';
const prOnlyChecks = ['pr-evidence'];
const botAuthor = 'cairnwright[bot]';
const mergeBotAccount = 'xiechimon';
export const admitLabel = 'queue-admit';
const batchHeadRe = '^B[0-9]+/';
const batchSize = { min: 1, max: 4 };
const batchWait = '0 s';
const checkRetries = 1;
const parallelChecks = 1;
const scopes = {
  web: ['apps/web/**/*'],
  backend: ['apps/server/**/*', 'apps/daemon/**/*', 'integration/**/*'],
};
const barrierFiles = ['packages/**/*'];

const ownerSecurity = ['credentials', 'machineAndCommandBoundary', 'externalEntryAuth'];

export function ownerRouteGlobs(gatePaths) {
  const named = gatePaths?.ownerRoute ?? {};
  const queue = gatePaths?.humanQueue ?? {};
  return [
    ...(named.ciAndMergeMachinery ?? []),
    ...(named.evalRuler ?? []),
    ...ownerSecurity.flatMap((key) => queue[key] ?? []),
  ];
}

function globToMergify(glob) {
  const tail = glob.endsWith('/**');
  const body = tail ? glob.slice(0, -3) : glob;
  let re = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '*' && body[i + 1] === '*') {
      re += '.*';
      i += 1;
    } else if (ch === '*') {
      re += '[^/]*';
    } else {
      re += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return `${re}${tail ? '(?:/.*)?' : ''}`;
}

export function ownerRouteAdmission(globs) {
  return `(?i)^(?:${globs.map(globToMergify).join('|')})$`;
}

function queueLimits(source, gatePaths) {
  if (!source.includes('function globToRegExp'))
    throw new Error('pr-gate.js no longer has globToRegExp');
  const maxFiles = gatePaths.limits?.maxQueueFiles;
  if (!Number.isInteger(maxFiles) || maxFiles < 1)
    throw new Error('limits.maxQueueFiles must be a positive integer');
  return { maxFiles };
}

const passedOrSkipped = (check) =>
  `      - or:\n          - check-success = ${check}\n          - check-skipped = ${check}`;

export function mergifyConfig(prGateSource, gatePaths) {
  const { maxFiles } = queueLimits(prGateSource, gatePaths);
  const prChecks = [...requiredChecks, ...mustBeGreenJobs];
  const draftChecks = prChecks.filter((check) => !prOnlyChecks.includes(check));
  const queueConditions = [
    '      - or:',
    '          - base = main',
    '          - "#depends-on > 0"',
    '      - -draft',
    "      - '#review-threads-unresolved = 0'",
    '      - -label = coordinator-hold',
    `      - '-files ~= ${ownerRouteAdmission(ownerRouteGlobs(gatePaths))}'`,
    '      - or:',
    `          - -head ~= ${batchHeadRe}`,
    `          - label = ${admitLabel}`,
    '      - check-success = commit-author',
    '      - check-success = @github-actions/review-gate',
    '      - check-success = merge-route',
    '      - check-success = pr-size',
    ...prChecks.map(passedOrSkipped),
    `      - '#files <= ${maxFiles}'`,
  ].join('\n');
  const rule = (name, author, method) => `  - name: ${name}
    queue_conditions:
      - ${author}
${queueConditions}
    merge_conditions:
${draftChecks.map(passedOrSkipped).join('\n')}
    merge_method: ${method}
    batch_size:
      min: ${batchSize.min}
      max: ${batchSize.max}
    batch_max_wait_time: ${batchWait}
    max_checks_retries: ${checkRetries}
    branch_protection_injection_mode: none
    merge_bot_account: ${mergeBotAccount}`;
  return `queue_rules:
${rule('default', `-author = ${botAuthor}`, 'fast-forward')}
${rule('bot', `author = ${botAuthor}`, 'fast-forward')}
merge_protections_settings:
  auto_merge_conditions: true
commands_restrictions:
  dequeue:
    conditions:
      - sender-permission >= write
merge_queue:
  mode: serial
  max_parallel_checks: ${parallelChecks}
  dequeued_label: dequeued
scopes:
  source:
    files:
${Object.entries(scopes)
  .map(
    ([name, globs]) =>
      `      ${name}:\n        include:\n${globs.map((glob) => `          - ${glob}`).join('\n')}`,
  )
  .join('\n')}
  barrier_files:
    include:
${barrierFiles.map((glob) => `      - ${glob}`).join('\n')}
`;
}

if (process.argv[1] && realpathSync(process.argv[1]) === import.meta.filename) {
  writeFileSync(
    configPath,
    mergifyConfig(
      readFileSync(prGatePath, 'utf8'),
      JSON.parse(readFileSync(gatePathsPath, 'utf8')),
    ),
  );
}
