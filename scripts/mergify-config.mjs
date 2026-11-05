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
const batchSize = 5;
const batchWait = '3 min';
const checkRetries = 1;
const scopes = {
  web: ['apps/web/**/*'],
  backend: ['apps/server/**/*', 'apps/daemon/**/*', 'apps/coordinator/**/*', 'integration/**/*'],
};
const barrierFiles = ['packages/**/*'];

function queueLimits(source, gatePaths) {
  if (!source.includes('function globToRegExp'))
    throw new Error('pr-gate.js no longer has globToRegExp');
  const maxFiles = gatePaths.limits?.maxFiles;
  if (!Number.isInteger(maxFiles) || maxFiles < 1)
    throw new Error('limits.maxFiles must be a positive integer');
  return { maxFiles };
}

const passedOrSkipped = (check) =>
  `      - or:\n          - check-success = ${check}\n          - check-skipped = ${check}`;

export function mergifyConfig(prGateSource, gatePaths) {
  const maxLinesEachWay = gatePaths.limits?.maxLinesEachWay;
  if (!Number.isInteger(maxLinesEachWay) || maxLinesEachWay < 1)
    throw new Error('limits.maxLinesEachWay must be a positive integer');
  const { maxFiles } = queueLimits(prGateSource, gatePaths);
  const prChecks = [...requiredChecks, ...mustBeGreenJobs];
  const draftChecks = prChecks.filter((check) => !prOnlyChecks.includes(check));
  const queueConditions = [
    '      - base = main',
    '      - -draft',
    '      - -label = needs-decision',
    '      - -label = coordinator-hold',
    '      - or:',
    `          - -head ~= ${batchHeadRe}`,
    `          - label = ${admitLabel}`,
    '      - check-success = commit-author',
    '      - check-success = @github-actions/review-gate',
    '      - check-success = merge-route',
    ...prChecks.map(passedOrSkipped),
    `      - '#files <= ${maxFiles}'`,
    `      - '#added-lines <= ${maxLinesEachWay}'`,
    `      - '#deleted-lines <= ${maxLinesEachWay}'`,
  ].join('\n');
  const rule = (name, author, method) => `  - name: ${name}
    queue_conditions:
      - ${author}
${name === 'bot' ? "      - '#commits = 1'\n" : ''}${queueConditions}
    merge_conditions:
${draftChecks.map(passedOrSkipped).join('\n')}
    merge_method: ${method}
    batch_size: ${batchSize}
    batch_max_wait_time: ${batchWait}
    max_checks_retries: ${checkRetries}
    branch_protection_injection_mode: none
    merge_bot_account: ${mergeBotAccount}`;
  return `queue_rules:
${rule('default', `-author = ${botAuthor}`, 'squash')}
${rule('bot', `author = ${botAuthor}`, 'rebase')}
merge_protections_settings:
  auto_merge_conditions: true
merge_queue:
  mode: parallel
  max_parallel_checks: 3
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
