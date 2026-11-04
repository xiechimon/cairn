import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const sandboxOptions = { timeout: 1000, contextCodeGeneration: { strings: false, wasm: false } };

export function ownerRouting(headSha) {
  const git = (args) =>
    execFileSync('git', args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  const source = git(['show', 'origin/main:.claude/workflows/pr-gate.js']);
  const gatePaths = JSON.parse(git(['show', 'origin/main:packages/shared/merge-gate-paths.json']));
  const extract = (start, end) => {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    if (from < 0 || to < 0 || source.indexOf(start, from + start.length) !== -1)
      throw new Error('Unsupported owner routing policy');
    return source.slice(from, to);
  };
  const constants = extract('const AUTO_MERGE =', 'const FILES_CMD =');
  const routing = extract('const safety = reviewed.find', 'const checked =');
  const isEvidence = runInNewContext(
    `${constants}\n;(path) => EVIDENCE_RE.test(path)`,
    { args: { gatePaths } },
    sandboxOptions,
  );
  const range = `origin/main...${headSha}`;
  const numstat = git([
    '-c',
    'core.quotePath=false',
    '--attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904',
    'diff',
    '--no-renames',
    '--numstat',
    range,
  ]);
  const changedFiles = [];
  const binaryFiles = [];
  let linesChanged = 0;
  for (const row of numstat.replace(/\n$/, '').split('\n')) {
    const match = /^(\d+|-)\t(\d+|-)\t([\p{L}\p{M}\p{N}._/@+%-]+)$/u.exec(row);
    if (!match || (match[1] === '-') !== (match[2] === '-'))
      throw new Error('Invalid owner routing numstat');
    const [, added, removed, path] = match;
    changedFiles.push(path);
    if (added === '-') binaryFiles.push(path);
    else if (!isEvidence(path)) linesChanged += Number(added) + Number(removed);
  }
  const deleted = git([
    '-c',
    'core.quotePath=false',
    'diff',
    '--no-renames',
    '--name-only',
    '--diff-filter=D',
    range,
  ]).replace(/\n$/, '');
  const deletedFiles = deleted ? deleted.split('\n') : [];
  if (!Number.isSafeInteger(linesChanged) || !deletedFiles.every((f) => changedFiles.includes(f)))
    throw new Error('Invalid owner routing diff');
  const reasons = runInNewContext(
    `${constants}
const matchedProtected = changedFiles.filter(isProtected);
const reviewed = [];
${routing}
humanReasons`,
    { args: { gatePaths }, changedFiles, deletedFiles, binaryFiles, linesChanged },
    sandboxOptions,
  );
  if (!Array.isArray(reasons) || !reasons.every((reason) => typeof reason === 'string'))
    throw new Error('Invalid owner routing result');
  return reasons;
}

const OWNER_ROUTE_LABEL = 'owner-route';

export function syncOwnerRouteLabel(repo, pr, routed, gh) {
  const labels = gh(['api', `repos/${repo}/issues/${pr}/labels`, '--jq', '.[].name'])
    .split('\n')
    .filter(Boolean);
  const has = labels.includes(OWNER_ROUTE_LABEL);
  if (routed && !has)
    gh([
      'api',
      '--method',
      'POST',
      `repos/${repo}/issues/${pr}/labels`,
      '-f',
      `labels[]=${OWNER_ROUTE_LABEL}`,
    ]);
  if (!routed && has)
    gh(['api', '--method', 'DELETE', `repos/${repo}/issues/${pr}/labels/${OWNER_ROUTE_LABEL}`]);
}

const runGh = (args) => execFileSync('gh', args, { encoding: 'utf8' });

if (process.argv[1] && realpathSync(process.argv[1]) === import.meta.filename) {
  const [head = '', ...rest] = process.argv.slice(2);
  const labelFlag = rest.indexOf('--label-pr');
  const labelPr = labelFlag === -1 ? null : rest[labelFlag + 1];
  const repo = process.env.GITHUB_REPOSITORY ?? '';
  if (
    !/^[0-9a-f]{40}$/.test(head) ||
    (labelFlag !== -1 && (!/^[1-9][0-9]*$/.test(labelPr ?? '') || !/^[\w.-]+\/[\w.-]+$/.test(repo)))
  ) {
    console.error(
      'usage: merge-route.mjs <40-hex head sha> [--label-pr <number>] (needs GITHUB_REPOSITORY)',
    );
    process.exit(2);
  }
  const reasons = ownerRouting(head);
  if (labelPr) {
    try {
      syncOwnerRouteLabel(repo, labelPr, reasons.length > 0, runGh);
    } catch (error) {
      console.error(`merge-route: could not sync the ${OWNER_ROUTE_LABEL} label: ${error.message}`);
    }
  }
  if (reasons.length > 0) {
    console.log(`merge-route: owner route for ${head.slice(0, 8)}:`);
    for (const reason of reasons) console.log(`- ${reason}`);
    process.exit(1);
  }
  console.log(`merge-route: ${head.slice(0, 8)} may enter the merge queue`);
}
