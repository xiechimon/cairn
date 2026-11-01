import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { mustBeGreenJobs, requiredChecks } from './merge-checks.mjs';

const prGatePath = '.claude/workflows/pr-gate.js';
export const configPath = '.mergify.yml';
const prOnlyChecks = ['pr-evidence', 'gates'];
const maxLinesEachWay = 400;

function routingPolicy(source) {
  const extract = (start, end) => {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    if (from < 0 || to < 0 || source.indexOf(start, from + start.length) !== -1)
      throw new Error(`pr-gate.js no longer has a single ${start}`);
    return source.slice(from, to);
  };
  const lists = extract('const AUTO_MERGE = [', '\n// Matching that widens');
  const matcher = extract('function globToRegExp', 'const SCRIPT_SHA256');
  const limits = extract('const MAX_FILES =', 'const EVIDENCE_RE');
  return runInNewContext(
    `${lists}\n${matcher}\n${limits}\n;({
      protectedSources: PROTECTED.map((glob) => globToRegExp(glob, { protect: true }).source),
      autoMergeSources: AUTO_MERGE.map((glob) => globToRegExp(glob).source),
      maxFiles: MAX_FILES,
    })`,
    {},
    { timeout: 1000, contextCodeGeneration: { strings: false, wasm: false } },
  );
}

const anchorless = (source) => source.replace(/^\^/, '').replace(/\$$/, '');
const quoted = (condition) => `'${condition.replaceAll("'", "''")}'`;
const passedOrSkipped = (check) =>
  `      - or:\n          - check-success = ${check}\n          - check-skipped = ${check}`;

export function mergifyConfig(prGateSource) {
  const { protectedSources, autoMergeSources, maxFiles } = routingPolicy(prGateSource);
  const protectedRe = `(?i)^(?:${protectedSources.map(anchorless).join('|')})$`;
  const outsideRe = `(?ai)^(?!(?:${autoMergeSources.map(anchorless).join('|')})$)`;
  const deletedTestRe = '(?i)(^|/)(e2e|test|tests|__tests__)/|[.](test|spec)[.][cm]?[jt]sx?$';
  const prChecks = [...requiredChecks, ...mustBeGreenJobs];
  const draftChecks = prChecks.filter((check) => !prOnlyChecks.includes(check));
  return `queue_rules:
  - name: default
    queue_conditions:
      - base = main
      - -draft
      - -label = needs-decision
      - -label = owner-route
      - -author = cairnwright[bot]
      - status-success = review-gate
${prChecks.map(passedOrSkipped).join('\n')}
      - ${quoted(`-files ~= ${protectedRe}`)}
      - ${quoted(`-files ~= ${outsideRe}`)}
      - ${quoted(`-removed-files ~= ${deletedTestRe}`)}
      - '#files <= ${maxFiles}'
      - '#added-lines <= ${maxLinesEachWay}'
      - '#deleted-lines <= ${maxLinesEachWay}'
    merge_conditions:
${draftChecks.map(passedOrSkipped).join('\n')}
    merge_method: squash
    batch_size: 3
    batch_max_wait_time: 2 min
merge_queue:
  max_parallel_checks: 2
`;
}

if (process.argv[1] && realpathSync(process.argv[1]) === import.meta.filename) {
  writeFileSync(configPath, mergifyConfig(readFileSync(prGatePath, 'utf8')));
}
