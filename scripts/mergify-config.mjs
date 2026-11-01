import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { mustBeGreenJobs, requiredChecks } from './merge-checks.mjs';

const prGatePath = '.claude/workflows/pr-gate.js';
const gatePathsPath = 'packages/shared/merge-gate-paths.json';
export const configPath = '.mergify.yml';
const prOnlyChecks = ['pr-evidence'];
const maxLinesEachWay = 400;
const botAuthor = 'cairnwright[bot]';
const mergeBotAccount = 'xiechimon';
export const admitLabel = 'queue-admit';
const batchHeadRe = '^B[0-9]+/';
const batchSize = 5;
const batchWait = '3 min';
const checkRetries = 1;
const scopes = {
  web: ['apps/web/**/*'],
  backend: ['apps/server/**/*', 'apps/daemon/**/*', 'integration/**/*'],
};
const barrierFiles = ['packages/**/*'];

function routingPolicy(source, gatePaths) {
  const extract = (start, end) => {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    if (from < 0 || to < 0 || source.indexOf(start, from + start.length) !== -1)
      throw new Error(`pr-gate.js no longer has a single ${start}`);
    return source.slice(from, to);
  };
  const matcher = extract('function globToRegExp', 'const SCRIPT_SHA256');
  return runInNewContext(
    `${matcher}\n;({
      protectedSources: [...gatePaths.protected, ...gatePaths.mergeGateSource].map(
        (glob) => globToRegExp(glob, { protect: true }).source,
      ),
      autoMergeSources: gatePaths.autoMerge.map((glob) => globToRegExp(glob).source),
      maxFiles: gatePaths.limits.maxFiles,
    })`,
    { gatePaths },
    { timeout: 1000, contextCodeGeneration: { strings: false, wasm: false } },
  );
}

const anchorless = (source) => source.replace(/^\^/, '').replace(/\$$/, '');
const quoted = (condition) => `'${condition.replaceAll("'", "''")}'`;
const passedOrSkipped = (check) =>
  `      - or:\n          - check-success = ${check}\n          - check-skipped = ${check}`;

export function mergifyConfig(prGateSource, gatePaths) {
  const { protectedSources, autoMergeSources, maxFiles } = routingPolicy(prGateSource, gatePaths);
  const protectedRe = `(?i)^(?:${protectedSources.map(anchorless).join('|')})$`;
  const outsideRe = `(?ai)^(?!(?:${autoMergeSources.map(anchorless).join('|')})$)`;
  const deletedTestRe = '(?i)(^|/)(e2e|test|tests|__tests__)/|[.](test|spec)[.][cm]?[jt]sx?$';
  const prChecks = [...requiredChecks, ...mustBeGreenJobs];
  const draftChecks = prChecks.filter((check) => !prOnlyChecks.includes(check));
  const queueConditions = [
    '      - base = main',
    '      - -draft',
    '      - -label = needs-decision',
    '      - -label = owner-route',
    '      - -label = coordinator-hold',
    '      - or:',
    `          - -head ~= ${batchHeadRe}`,
    `          - label = ${admitLabel}`,
    '      - check-success = commit-author',
    '      - status-success = review-gate',
    '      - check-success = merge-route',
    ...prChecks.map(passedOrSkipped),
    `      - ${quoted(`-files ~= ${protectedRe}`)}`,
    `      - ${quoted(`-files ~= ${outsideRe}`)}`,
    `      - ${quoted(`-removed-files ~= ${deletedTestRe}`)}`,
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
