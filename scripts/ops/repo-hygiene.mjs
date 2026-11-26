#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { evaluateCoverage, manifestIssues } from '../issue-coverage.mjs';

export const REPORT_TITLE = 'Repo hygiene report';
export const PROTECTED_REFS = new Set(['main', 'queue/main', 'queue-state/main']);
export const PREFLIGHT_AGE_DAYS = 7;
export const DRAFT_RELEASE_AGE_DAYS = 1;
export const STALE_ISSUE_DAYS = 14;
const DAY_MS = 86400000;
const REPOSITORY = 'xiechimon/cairn';

const root = resolve(import.meta.dirname, '../..');

// ---------------------------------------------------------------------------
// Pure classifiers (unit-tested with the live repo cases as fixtures)

export function classifyPullRequest({
  uniqueCommits,
  changeOnMain,
  mainMatchSha,
  linkedIssue,
  mergeable,
  isDraft,
}) {
  if (isDraft) return { action: 'report', reason: 'draft PR — leaving it open' };
  if (changeOnMain === true) {
    const kind = uniqueCommits === 0 ? 'landed' : 'superseded';
    const named = mainMatchSha ?? linkedIssue?.landedSha ?? null;
    return {
      action: 'close',
      kind,
      comment: `This pull request's change is already on main${
        named ? ` (commit ${named})` : ''
      }${kind === 'superseded' ? ' through an equivalent change' : ''}, so it is being closed by repo hygiene. Reopen if that judgement is wrong.`,
    };
  }
  if (changeOnMain === null) return { action: 'report', reason: 'change comparison unreadable' };
  if (uniqueCommits === 0) {
    return {
      action: 'report',
      reason:
        'every patch-id matches main history but the change content is not on main — a revert may have removed it',
    };
  }
  const why = [];
  if (mergeable === 'CONFLICTING') why.push('conflicting');
  why.push(`${uniqueCommits} unique patch${uniqueCommits === 1 ? '' : 'es'} not on main`);
  if (linkedIssue?.state === 'CLOSED') {
    why.push(
      `its issue #${linkedIssue.number} is already closed${
        linkedIssue.landedSha ? ` by ${linkedIssue.landedSha}` : ''
      }; check whether the remaining diff is still wanted`,
    );
  }
  return { action: 'report', reason: `still wanted? (${why.join('; ')})` };
}

export function classifyBranch({
  name,
  uniquePatches,
  openPr,
  closedPr,
  liveChecks,
  tipAgeDays,
  changeOnMain,
}) {
  if (PROTECTED_REFS.has(name) || name.startsWith('queue/') || name.startsWith('enqueue/')) {
    return { action: 'keep', reason: 'protected ref' };
  }
  if (openPr !== null && openPr !== undefined) {
    return { action: 'keep', reason: `open PR #${openPr}` };
  }
  if (liveChecks === null) {
    return { action: 'report', reason: 'check status unreadable — kept for safety' };
  }
  if (liveChecks) return { action: 'keep', reason: 'has a live ci run' };
  if (!Number.isFinite(tipAgeDays) || uniquePatches === null || changeOnMain === null) {
    return { action: 'report', reason: 'branch evidence unreadable — kept for safety' };
  }
  if (tipAgeDays < 1) return { action: 'keep', reason: 'tip commit is younger than 1 day' };
  if (uniquePatches === 0) {
    if (changeOnMain !== true) {
      return {
        action: 'report',
        reason:
          'every patch-id matches main history but the change content is not on main — a revert may have removed it',
      };
    }
    return { action: 'delete', reason: 'every patch is on main' };
  }
  return {
    action: 'report',
    reason: `${uniquePatches} unique commits, ${closedPr ? `PR #${closedPr} is closed` : 'no PR'}`,
  };
}

export function classifyPreflightRef({
  ageDays,
  uniquePatches,
  liveChecks,
  openPrHead,
  changeOnMain,
}) {
  if (openPrHead) return { action: 'keep', reason: 'tip is an open PR head' };
  if (liveChecks === null) {
    return { action: 'report', reason: 'check status unreadable — kept for safety' };
  }
  if (liveChecks) return { action: 'keep', reason: 'has a live ci run' };
  if (!Number.isFinite(ageDays) || uniquePatches === null || changeOnMain === null) {
    return { action: 'report', reason: 'branch evidence unreadable — kept for safety' };
  }
  if (ageDays < PREFLIGHT_AGE_DAYS) {
    return { action: 'keep', reason: `younger than ${PREFLIGHT_AGE_DAYS} days` };
  }
  if (uniquePatches === 0 && changeOnMain !== true) {
    return {
      action: 'report',
      reason:
        'every patch-id matches main history but the change content is not on main — a revert may have removed it',
    };
  }
  if (uniquePatches === 0) {
    return { action: 'delete', reason: `older than ${PREFLIGHT_AGE_DAYS} days, patches on main` };
  }
  return {
    action: 'report',
    reason: `older than ${PREFLIGHT_AGE_DAYS} days with ${uniquePatches} unique commits`,
  };
}

export function classifyIssue({ closesCommits, daysSinceUpdate, wasReopened }) {
  if (closesCommits.length > 0) {
    if (typeof wasReopened !== 'boolean') {
      return {
        action: 'report',
        reason: 'issue timeline unreadable — not closing',
      };
    }
    if (wasReopened) {
      return {
        action: 'report',
        reason: 'the issue was reopened by a user — leaving it open',
      };
    }
    return {
      action: 'close',
      commit: closesCommits[0],
      comment: `Commit ${closesCommits[0]} is on main and names \`Closes #\` for this issue, so it is being closed by repo hygiene.`,
    };
  }
  if (daysSinceUpdate > STALE_ISSUE_DAYS) {
    return { action: 'flag-stale', reason: `no activity for ${daysSinceUpdate} days` };
  }
  return { action: 'ok' };
}

const normTitle = (title) => (title ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export function planBoard({ openIssues, closedIssueTitles = [], boardItems }) {
  const cairnIssues = boardItems.filter(
    (i) => i.type === 'ISSUE' && i.repository === REPOSITORY && Number.isInteger(i.number),
  );
  const onBoard = new Set(cairnIssues.map((i) => i.number));
  const taken = new Set([...openIssues.map((i) => i.title), ...closedIssueTitles].map(normTitle));
  const plan = { addTodo: [], moveDone: [], removeDraft: [], reportDraft: [] };
  for (const issue of openIssues) {
    if (!onBoard.has(issue.number)) plan.addTodo.push(issue.number);
  }
  for (const item of cairnIssues) {
    if (item.state === 'CLOSED' && item.status !== 'Done') plan.moveDone.push(item.id);
  }
  for (const item of boardItems) {
    if (item.type !== 'DRAFT_ISSUE') continue;
    if (taken.has(normTitle(item.title))) plan.removeDraft.push(item);
    else plan.reportDraft.push(item);
  }
  return plan;
}

export function classifyRelease({ isDraft, ageDays, tagDisposition }) {
  if (!isDraft || !Number.isFinite(ageDays) || ageDays <= DRAFT_RELEASE_AGE_DAYS) return 'keep';
  if (tagDisposition === 'delete') return 'delete';
  if (tagDisposition === 'keep' || tagDisposition === 'absent') return 'delete-release-only';
  return 'report';
}

export function classifyCache({ ref, liveRefs }) {
  if (!liveRefs || !/^(refs\/heads\/.+|refs\/pull\/\d+\/merge)$/.test(ref)) return 'keep';
  return liveRefs.has(ref) ? 'keep' : 'delete';
}

export function classifyScheduledRun({ recentConclusions, totalRuns }) {
  if (totalRuns === 0) return 'report-never-ran';
  const last = recentConclusions.slice(0, 3);
  if (last.length >= 3 && last.every((c) => c === 'failure')) return 'flag';
  return 'ok';
}

// ---------------------------------------------------------------------------
// Report

export function renderReport(state, format = 'summary') {
  const lines = [];
  if (format === 'issue') {
    lines.push(
      'Items here need judgement; the deterministic actions are in the run summary. Updated by `.github/workflows/repo-hygiene.yml`.',
      '',
    );
  }
  const prReports = (state.prs ?? []).filter((p) => p.verdict.action === 'report');
  if (prReports.length > 0 || state.prs === null || format === 'issue') {
    lines.push('## Pull requests');
    for (const pr of prReports) lines.push(`- #${pr.number} ${pr.title} — ${pr.verdict.reason}`);
    if (state.prs === null) lines.push('- open pull request list unreadable — no changes made');
    else if (prReports.length === 0) lines.push('- none need judgement');
    lines.push('');
  }
  const branchReports = (state.branches?.report ?? []).concat(state.preflight?.report ?? []);
  if (branchReports.length > 0) {
    lines.push('## Branches holding unique commits');
    for (const b of branchReports) lines.push(`- ${b}`);
    lines.push('');
  }
  if (state.issues) {
    lines.push('## Issues');
    lines.push(`- open: ${state.issues.open}`);
    for (const n of state.issues.stale ?? [])
      lines.push(`- #${n} quiet for over ${STALE_ISSUE_DAYS} days`);
    for (const [number, verdict] of Object.entries(state.issues.byNumber ?? {})) {
      if (verdict.action === 'report') lines.push(`- #${number} ${verdict.reason}`);
    }
    if ((state.issues.uncovered ?? []).length > 0) {
      lines.push(
        `- no destination in issue policy: ${state.issues.uncovered.map((n) => `#${n}`).join(', ')}`,
      );
    }
    if ((state.issues.unlabeled ?? []).length > 0) {
      lines.push(`- unlabeled: ${state.issues.unlabeled.map((n) => `#${n}`).join(', ')}`);
    }
    lines.push('');
  }
  if (format === 'issue') {
    const drafts = state.board?.reportDraft ?? [];
    lines.push('## Project board “cairn roadmap”');
    if (state.board?.error) lines.push(`- ${state.board.error}`);
    for (const d of drafts) lines.push(`- draft “${d.title}” — convert to an issue or remove`);
    if (!state.board?.error && drafts.length === 0) lines.push('- in sync');
    lines.push('');
    for (const key of ['releases', 'actions', 'security', 'settings', 'docs', 'workflows']) {
      const items = state[key]?.report ?? [];
      lines.push(`## ${key[0].toUpperCase()}${key.slice(1)}`);
      if (state[key]?.error) lines.push(`- ${state[key].error}`);
      for (const item of items) lines.push(`- ${item}`);
      if (!state[key]?.error && items.length === 0) lines.push('- clean');
      lines.push('');
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Collectors (GitHub + git). Injected `run`/`gh` make dry runs cheap to fake.

function exec(cmd, args, { raw = false, ...opts } = {}) {
  const output = execFileSync(cmd, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
  return raw ? output : output.trim();
}

function tryExec(cmd, args, opts = {}) {
  try {
    return exec(cmd, args, opts);
  } catch {
    return null;
  }
}

function gh(args, { token, input } = {}) {
  const env = token ? { ...process.env, GH_TOKEN: token } : process.env;
  return exec('gh', args, { env, input });
}

function ghCreate(args, { input } = {}) {
  exec('node', [join(root, 'scripts/lib/github-create-gate.mjs'), 'gh', ...args], { input });
}

function ghPaged(path, jqExpr) {
  const sep = path.includes('?') ? '&' : '?';
  return ghRows(`${path}${sep}per_page=100`, jqExpr);
}

function ghRows(endpoint, jqExpr, ...args) {
  const out = tryExec('gh', ['api', '--paginate', '--jq', jqExpr, endpoint, ...args]);
  if (out === null) return null;
  try {
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return null;
  }
}

function ghJson(args, opts) {
  const out = tryExec('gh', args, opts);
  if (out === null) return null;
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

const git = (args) => tryExec('git', args, { cwd: root });

function remoteHeads() {
  const out = git(['ls-remote', '--heads', 'origin']);
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, ref] = line.split('\t');
      return { name: ref.replace('refs/heads/', ''), sha };
    });
}

function uniquePatchCount(mainRef, sha) {
  const out = git(['cherry', mainRef, sha]);
  if (out === null) return null;
  const unique = out.split('\n').filter((l) => l.startsWith('+')).length;
  if (unique > 0) return unique;
  const merges = git(['rev-list', '--merges', '--count', `${mainRef}..${sha}`]);
  if (merges === null) return null;
  if (merges === '0') return 0;
  return changeOnMain(mainRef, sha) === true ? 0 : 1;
}

export function changeOnMain(mainRef, head, cwd = root) {
  const base = tryExec('git', ['merge-base', mainRef, head], { cwd });
  if (base === null) return null;
  const pathsFrom = (ref) =>
    tryExec(
      'git',
      ['diff', '--name-only', '--no-renames', '--ignore-submodules=none', '-z', ref, head],
      { cwd, encoding: 'latin1', raw: true },
    );
  const touched = pathsFrom(base);
  if (touched === null) return null;
  if (touched === '') return true;
  const different = pathsFrom(mainRef);
  if (different === null) return null;
  const paths = new Set(touched.split('\0').filter(Boolean));
  return !different.split('\0').some((path) => paths.has(path));
}

function tipAgeDays(sha) {
  const epoch = git(['log', '-1', '--format=%ct', sha]);
  return epoch === null ? null : (Date.now() / 1000 - Number(epoch)) / 86400;
}

export function liveChecks(sha, read = ghJson) {
  const pages = read([
    'api',
    '--paginate',
    '--slurp',
    `repos/xiechimon/cairn/commits/${sha}/check-runs?per_page=100`,
  ]);
  if (pages === null) return null;
  return [pages]
    .flat()
    .flatMap((page) => page?.check_runs ?? [])
    .some((r) => r.status !== 'completed');
}

function landedCommitForIssue(number, mainRef) {
  const bySubject = git([
    'log',
    mainRef,
    '--format=%H',
    '--extended-regexp',
    '--grep',
    `\\(#${number}\\)`,
  ]);
  return closesCommitsFor(number, mainRef)[0] ?? (bySubject ? bySubject.split('\n')[0] : null);
}

export function closesCommitsFor(number, mainRef, logCache = null) {
  const out = logCache ?? git(['log', mainRef, '--format=%H %B%x00', '-2000']);
  if (out === null) return [];
  const hits = [];
  for (const block of out.split('\0')) {
    const [header, ...body] = block.trimStart().split('\n');
    let fence = null;
    for (const line of body) {
      const mark = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (mark) {
        if (!fence) fence = mark[1];
        else if (mark[1].startsWith(fence) && mark[2].trim() === '') fence = null;
      } else if (!fence && line.trimEnd() === `Closes #${number}`) {
        hits.push(header.split(' ')[0]);
        break;
      }
    }
  }
  return hits;
}

function issueNumberFromTitle(title) {
  const match = /\((\d+)\)/.exec(title);
  return match ? Number(match[1]) : null;
}

function collectPrs({ mainRef }) {
  const prs = ghRows(
    'graphql',
    '.data.repository.pullRequests.nodes[]',
    '-f',
    'query=query($endCursor:String){repository(owner:"xiechimon",name:"cairn"){pullRequests(states:OPEN,first:100,after:$endCursor){nodes{number,title,headRefName,headRefOid,isDraft,mergeable,body} pageInfo{hasNextPage endCursor}}}}',
  );
  if (prs === null) return null;
  for (const pr of prs) {
    if (pr.isDraft) {
      pr.verdict = classifyPullRequest(pr);
      continue;
    }
    const head = `refs/hygiene/pr-${pr.number}`;
    git(['fetch', '--quiet', 'origin', `+refs/pull/${pr.number}/head:${head}`]);
    const actual = git(['rev-parse', '--verify', head]);
    if (actual === null || actual !== pr.headRefOid) {
      pr.uniqueCommits = null;
      pr.verdict = {
        action: 'report',
        reason: `head ${pr.headRefOid.slice(0, 9)} could not be fetched to compare against main — refusing to judge`,
      };
      continue;
    }
    pr.uniqueCommits = uniquePatchCount(mainRef, head) ?? 1;
    pr.changeOnMain = changeOnMain(mainRef, head);
    const issueNum =
      issueNumberFromTitle(pr.title) ?? Number(/#(\d+)/.exec(pr.body ?? '')?.[1] ?? NaN);
    pr.linkedIssue = null;
    if (Number.isFinite(issueNum)) {
      const issue = ghJson(['issue', 'view', String(issueNum), '--json', 'number,state']);
      pr.linkedIssue = issue
        ? {
            number: issueNum,
            state: issue.state,
            landedSha: landedCommitForIssue(issueNum, mainRef),
          }
        : {
            number: issueNum,
            state: 'UNKNOWN',
            landedSha: landedCommitForIssue(issueNum, mainRef),
          };
    }
    pr.mainMatchSha =
      pr.uniqueCommits === 0 && Number.isFinite(issueNum)
        ? landedCommitForIssue(issueNum, mainRef)
        : null;
    pr.verdict = classifyPullRequest(pr);
  }
  for (const stale of (git(['for-each-ref', 'refs/hygiene', '--format=%(refname)']) ?? '')
    .split('\n')
    .filter(Boolean)
    .filter((ref) => !prs.some((pr) => ref === `refs/hygiene/pr-${pr.number}`)))
    git(['update-ref', '-d', stale]);
  return prs;
}

function execCode(cmd, args) {
  try {
    exec(cmd, args);
    return 0;
  } catch (error) {
    return error.status ?? 128;
  }
}

function collectIssues({ mainRef }) {
  const open =
    ghJson([
      'issue',
      'list',
      '--state',
      'open',
      '--limit',
      '1000',
      '--json',
      'number,title,labels,updatedAt',
    ]) ?? [];
  const coverage = JSON.parse(readFileSync(join(root, 'docs/ops/issue-coverage.json'), 'utf8'));
  const manifestDir = join(root, '.claude/epics');
  const manifests = manifestIssues(
    Object.fromEntries(
      readdirSync(manifestDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => [f, readFileSync(join(manifestDir, f), 'utf8')]),
    ),
  );
  const coverageReport = evaluateCoverage({
    open,
    manifests,
    coverage: coverage.issues,
    today: new Date().toISOString().slice(0, 10),
  });
  const state = {
    open: open.length,
    closedNumbers: [],
    stale: [],
    uncovered: coverageReport.uncovered.map((i) => i.number),
    unlabeled: open.filter((i) => (i.labels ?? []).length === 0).map((i) => i.number),
    byNumber: {},
  };
  const logCache = git(['log', mainRef, '--format=%H %B%x00', '-2000']);
  for (const issue of open) {
    const closesCommits = closesCommitsFor(issue.number, mainRef, logCache);
    const daysSinceUpdate = Math.floor((Date.now() - Date.parse(issue.updatedAt)) / DAY_MS);
    let wasReopened = null;
    if (closesCommits.length > 0) {
      const events = ghPaged(`repos/xiechimon/cairn/issues/${issue.number}/timeline`, '.[]');
      if (events?.every((event) => typeof event?.event === 'string')) {
        wasReopened = events.some((event) => event.event === 'reopened');
      }
    }
    const verdict = classifyIssue({
      number: issue.number,
      closesCommits,
      daysSinceUpdate,
      wasReopened,
    });
    state.byNumber[issue.number] = verdict;
    if (verdict.action === 'close') state.closedNumbers.push(issue.number);
    if (verdict.action === 'flag-stale') state.stale.push(issue.number);
  }
  return state;
}

function collectBranches({ mainRef, prs }) {
  const heads = remoteHeads();
  if (prs === null) {
    const reason = 'pull request list unreadable — refusing to judge refs';
    return {
      branches: { deleted: [], kept: [], report: [reason] },
      preflight: { deleted: [], kept: [], report: [reason] },
      heads,
    };
  }
  const openByBranch = new Map(prs.map((pr) => [pr.headRefName, pr.number]));
  const openHeads = new Set(prs.map((pr) => pr.headRefOid));
  const closedPrs = ghJson([
    'pr',
    'list',
    '--state',
    'closed',
    '--limit',
    '1000',
    '--json',
    'number,headRefName',
  ]);
  const closedByBranch = new Map((closedPrs ?? []).map((pr) => [pr.headRefName, pr.number]));
  const branches = { deleted: [], kept: [], report: [] };
  const preflight = { deleted: [], kept: [], report: [] };
  for (const head of heads) {
    if (
      PROTECTED_REFS.has(head.name) ||
      head.name.startsWith('queue/') ||
      head.name.startsWith('enqueue/')
    ) {
      branches.kept.push(head.name);
      continue;
    }
    if (git(['cat-file', '-e', `${head.sha}^{commit}`]) === null) {
      git([
        'fetch',
        '--quiet',
        '--no-tags',
        '--no-write-fetch-head',
        '--refmap=',
        'origin',
        `refs/heads/${head.name}`,
      ]);
    }
    const evidence = {
      uniquePatches: uniquePatchCount(mainRef, head.sha),
      changeOnMain: changeOnMain(mainRef, head.sha),
      liveChecks: liveChecks(head.sha),
    };
    if (head.name.startsWith('preflight/')) {
      const verdict = classifyPreflightRef({
        ...evidence,
        ageDays: tipAgeDays(head.sha),
        openPrHead: openHeads.has(head.sha) || openByBranch.has(head.name),
      });
      if (verdict.action === 'delete') preflight.deleted.push({ name: head.name, sha: head.sha });
      else if (verdict.action === 'report')
        preflight.report.push(`${head.name} (${verdict.reason})`);
      else preflight.kept.push(head.name);
      continue;
    }
    const verdict = classifyBranch({
      ...evidence,
      name: head.name,
      openPr: openByBranch.get(head.name) ?? null,
      closedPr: closedByBranch.get(head.name) ?? null,
      tipAgeDays: tipAgeDays(head.sha),
    });
    if (verdict.action === 'delete') branches.deleted.push({ name: head.name, sha: head.sha });
    else if (verdict.action === 'report') branches.report.push(`${head.name} (${verdict.reason})`);
    else branches.kept.push(head.name);
  }
  return { branches, preflight, heads };
}

// --- project board ----------------------------------------------------------

function boardGraphql(token, query) {
  const out = tryExec('gh', ['api', 'graphql', '-f', `query=${query}`], {
    env: { ...process.env, GH_TOKEN: token },
  });
  if (out === null) return { error: 'graphql call failed' };
  const parsed = JSON.parse(out);
  if (parsed.errors?.length) return { error: parsed.errors.map((e) => e.message).join('; ') };
  return parsed.data;
}

function boardMutate(token, query) {
  const data = boardGraphql(token, query);
  if (data?.error || data === null || data === undefined) {
    throw new Error(data?.error ?? 'board write returned nothing');
  }
  return data;
}

async function collectBoard({ token, login, projectNumber }) {
  const pageItems = [];
  let cursor = null;
  for (;;) {
    const after = cursor ? `, after:"${cursor}"` : '';
    const data = boardGraphql(
      token,
      `{ user(login:"${login}") { projectV2(number:${projectNumber}) { id title field(name:"Status") { ... on ProjectV2SingleSelectField { id options { id name } } } items(first:100${after}) { pageInfo{endCursor hasNextPage} nodes { id type content { ... on Issue { id number state title repository { nameWithOwner } } ... on DraftIssue { title } } fieldValueByName(name:"Status") { ... on ProjectV2ItemFieldSingleSelectValue { name optionId } } } } } } }`,
    );
    if (data.error) return { error: `board read failed: ${data.error}` };
    const project = data.user.projectV2;
    for (const node of project.items.nodes) {
      pageItems.push({
        id: node.id,
        type: node.type,
        number: node.content?.number,
        repository: node.content?.repository?.nameWithOwner,
        state: node.content?.state,
        title: node.content?.title,
        issueId: node.content?.id,
        status: node.fieldValueByName?.name ?? null,
      });
    }
    if (!project.items.pageInfo.hasNextPage) {
      return { projectId: project.id, statusField: project.field, items: pageItems };
    }
    cursor = project.items.pageInfo.endCursor;
  }
}

// ---------------------------------------------------------------------------
// Executors

function deleteRefWithLease(ref, sha) {
  return git(['push', 'origin', `--force-with-lease=${ref}:${sha}`, `:${ref}`]);
}

function act(mode, lines, label, fn) {
  if (mode === 'apply') {
    try {
      const result = fn();
      if (result === null) {
        lines.push(`FAIL ${label} — command returned nothing`);
      } else {
        lines.push(`DONE ${label}${typeof result === 'string' && result ? ` — ${result}` : ''}`);
      }
    } catch (error) {
      lines.push(`FAIL ${label} — ${String(error.message).split('\n')[0]}`);
    }
  } else {
    lines.push(`WOULD ${label}`);
  }
}

// ---------------------------------------------------------------------------
// CLI

async function main() {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const at = args.indexOf(name);
    return at === -1 ? fallback : args[at + 1];
  };
  const mode = option('--mode', process.env.HYGIENE_MODE ?? 'dry');
  const summaryFile = option('--summary', process.env.GITHUB_STEP_SUMMARY ?? null);
  const writeReport = mode === 'apply' && !args.includes('--no-report');
  const mainRef = 'origin/main';
  const boardToken = process.env.HYGIENE_PROJECT_TOKEN ?? null;
  const boardLogin = process.env.HYGIENE_BOARD_LOGIN ?? 'xiechimon';
  const boardNumber = Number(process.env.HYGIENE_BOARD_NUMBER ?? 2);

  exec('git', ['fetch', '--quiet', '--prune', 'origin', 'main'], { cwd: root });
  exec('git', ['fetch', '--quiet', 'origin', 'refs/tags/*:refs/tags/*'], { cwd: root });
  const actions = [`repo-hygiene mode=${mode} main=${mainRef}`];
  const state = {};

  // 1. pull requests ---------------------------------------------------------
  state.prs = collectPrs({ mainRef });
  for (const pr of state.prs ?? []) {
    if (pr.verdict.action === 'close') {
      act(mode, actions, `close pr #${pr.number} (${pr.verdict.kind})`, () => {
        const latest = ghJson([
          'pr',
          'view',
          String(pr.number),
          '--json',
          'state,isDraft,headRefOid',
        ]);
        if (
          latest?.state !== 'OPEN' ||
          latest.isDraft !== false ||
          latest.headRefOid !== pr.headRefOid
        ) {
          throw new Error('PR state or head changed since the scan');
        }
        ghCreate(['pr', 'comment', String(pr.number), '--body', pr.verdict.comment]);
        return gh(['pr', 'close', String(pr.number)]);
      });
    } else {
      actions.push(`REPORT pr #${pr.number} ${pr.title}`);
    }
  }

  // 2. issues ----------------------------------------------------------------
  state.issues = collectIssues({ mainRef });
  for (const number of state.issues.closedNumbers) {
    const verdict = state.issues.byNumber[number];
    act(mode, actions, `close issue #${number} (Closes commit ${verdict.commit} on main)`, () => {
      ghCreate(['issue', 'comment', String(number), '--body', verdict.comment]);
      return gh(['issue', 'close', String(number)]);
    });
  }

  // 3. branches ---------------------------------------------------------------
  const { branches, preflight, heads } = collectBranches({ mainRef, prs: state.prs });
  state.branches = branches;
  state.preflight = preflight;
  const deletable = [...branches.deleted, ...preflight.deleted];
  if (deletable.length > 0) {
    for (const { name, sha } of deletable) {
      act(mode, actions, `delete remote branch ${name}`, () =>
        deleteRefWithLease(`refs/heads/${name}`, sha),
      );
    }
  }

  // 4. project board -----------------------------------------------------------
  if (!boardToken) {
    state.board = {
      error:
        'HYGIENE_PROJECT_TOKEN is not set; GITHUB_TOKEN cannot write a user-owned Projects v2 board and fine-grained PATs do not support user projects. Owner action: create a classic PAT with the `project` scope and store it as the HYGIENE_PROJECT_TOKEN repo secret.',
    };
  } else {
    const board = await collectBoard({
      token: boardToken,
      login: boardLogin,
      projectNumber: boardNumber,
    });
    if (board.error) {
      state.board = {
        error: `${board.error}. Owner action: store a classic PAT with the \`project\` scope as HYGIENE_PROJECT_TOKEN.`,
      };
    } else {
      const openIssues = ghJson([
        'issue',
        'list',
        '--state',
        'open',
        '--limit',
        '1000',
        '--json',
        'number,title',
      ]);
      const closedIssues = ghJson([
        'issue',
        'list',
        '--state',
        'closed',
        '--limit',
        '1000',
        '--json',
        'title',
      ]);
      if (!Array.isArray(openIssues) || !Array.isArray(closedIssues)) {
        state.board = { error: 'issue list unreadable — board sync skipped' };
      } else {
        const plan = planBoard({
          openIssues,
          closedIssueTitles: closedIssues.map((i) => i.title),
          boardItems: board.items,
        });
        state.board = plan;
        const doneOption = board.statusField.options.find((o) => o.name === 'Done');
        const todoOption = board.statusField.options.find((o) => o.name === 'Todo');
        for (const number of plan.addTodo) {
          act(mode, actions, `add issue #${number} to the board as Todo`, () => {
            const issueId = boardMutate(
              boardToken,
              `{ repository(owner:"${boardLogin}",name:"cairn") { issue(number:${number}) { id } } }`,
            ).repository.issue.id;
            const itemId = boardMutate(
              boardToken,
              `mutation { addProjectV2ItemById(input:{projectId:"${board.projectId}", contentId:"${issueId}"}) { item { id } } }`,
            ).addProjectV2ItemById.item.id;
            boardMutate(
              boardToken,
              `mutation { updateProjectV2ItemFieldValue(input:{projectId:"${board.projectId}", itemId:"${itemId}", fieldId:"${board.statusField.id}", value:{singleSelectOptionId:"${todoOption.id}"}}) { projectV2Item { id } } }`,
            );
          });
        }
        for (const itemId of plan.moveDone) {
          act(mode, actions, `mark board item ${itemId} Done`, () =>
            boardMutate(
              boardToken,
              `mutation { updateProjectV2ItemFieldValue(input:{projectId:"${board.projectId}", itemId:"${itemId}", fieldId:"${board.statusField.id}", value:{singleSelectOptionId:"${doneOption.id}"}}) { projectV2Item { id } } }`,
            ),
          );
        }
        for (const draft of plan.removeDraft) {
          act(mode, actions, `remove duplicate draft “${draft.title}”`, () =>
            boardMutate(
              boardToken,
              `mutation { deleteProjectV2Item(input:{projectId:"${board.projectId}", itemId:"${draft.id}"}) { deletedItemId } }`,
            ),
          );
        }
      }
    }
  }

  // 5. releases ------------------------------------------------------------------
  {
    const releases =
      ghJson(['release', 'list', '--limit', '1000', '--json', 'tagName,isDraft,createdAt']) ?? [];
    state.releases = { deleted: [], deletedReleaseOnly: [], report: [] };
    const now = Date.now();
    const draftReleases = releases.filter(
      (rel) => rel.isDraft && (now - Date.parse(rel.createdAt)) / DAY_MS > DRAFT_RELEASE_AGE_DAYS,
    );
    const tagRows = draftReleases.length > 0 ? git(['ls-remote', '--tags', 'origin']) : null;
    const tags = new Map(
      (tagRows ?? '')
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split('\t').reverse()),
    );
    const liveHeadShas = new Set([mainRef, ...heads.map((head) => head.sha)]);
    for (const rel of draftReleases) {
      const ref = `refs/tags/${rel.tagName}`;
      const tagOid = tags.get(ref);
      let tagDisposition = 'unknown';
      if (tagRows !== null && !tagOid) tagDisposition = 'absent';
      if (tagOid) {
        const commit = git(['rev-parse', '--verify', `${tagOid}^{commit}`]);
        if (commit !== null) {
          const otherTagPointsToCommit = [...tags].some(
            ([name, sha]) => name !== ref && name !== `${ref}^{}` && sha === commit,
          );
          const ancestry = [...liveHeadShas].map((headSha) =>
            execCode('git', ['merge-base', '--is-ancestor', commit, headSha]),
          );
          if (otherTagPointsToCommit || ancestry.includes(0)) tagDisposition = 'keep';
          else if (ancestry.every((code) => code === 1)) tagDisposition = 'delete';
        }
      }
      const verdict = classifyRelease({
        isDraft: true,
        ageDays: (now - Date.parse(rel.createdAt)) / DAY_MS,
        tagDisposition,
      });
      if (verdict === 'keep') continue;
      if (verdict === 'report') {
        state.releases.report.push(`draft ${rel.tagName}: tag ancestry unreadable — left in place`);
        continue;
      }
      const target =
        verdict === 'delete' ? state.releases.deleted : state.releases.deletedReleaseOnly;
      target.push(rel.tagName);
      act(
        mode,
        actions,
        `delete draft release ${rel.tagName}${verdict === 'delete' ? ' and its tag' : ' (release only)'}`,
        () => {
          const draft = ghJson(['release', 'view', '--json', 'isDraft', '--', rel.tagName]);
          if (draft?.isDraft !== true) throw new Error('release no longer verifiably a draft');
          gh(['release', 'delete', '--yes', '--', rel.tagName]);
          if (verdict === 'delete' && deleteRefWithLease(ref, tagOid) === null)
            throw new Error(`tag ${rel.tagName} could not be deleted`);
        },
      );
    }
    // failed desktop-release publishes
    const failed = ghJson([
      'run',
      'list',
      '--workflow',
      'desktop-release',
      '--limit',
      '10',
      '--json',
      'databaseId,conclusion,status,displayTitle,headSha',
    ])?.filter((r) => r.status === 'completed' && r.conclusion === 'failure');
    for (const run of failed ?? []) {
      state.releases.report.push(
        `desktop-release run ${run.databaseId} failed on ${run.headSha?.slice(0, 9)} (${run.displayTitle}) — check whether it failed to publish`,
      );
    }
  }

  // 6. actions ------------------------------------------------------------------
  {
    state.actions = { deletedCaches: [], report: [] };
    let liveRefs = null;
    let caches = null;
    if (state.prs === null) {
      state.actions.report.push('open pull request list unreadable — cache cleanup skipped');
    } else {
      liveRefs = new Set(heads.map((h) => `refs/heads/${h.name}`));
      liveRefs.add('refs/heads/main');
      for (const pr of state.prs) liveRefs.add(`refs/pull/${pr.number}/merge`);
      caches = ghPaged('repos/xiechimon/cairn/actions/caches', '.actions_caches[]');
      if (caches === null) {
        state.actions.report.push('actions cache list not readable with this token');
      }
    }
    for (const cache of caches ?? []) {
      if (classifyCache({ ref: cache.ref, liveRefs }) === 'delete') {
        state.actions.deletedCaches.push(`${cache.key.slice(0, 40)} @ ${cache.ref}`);
        act(mode, actions, `delete actions cache ${cache.id} (${cache.ref})`, () =>
          gh(['api', '-X', 'DELETE', `repos/xiechimon/cairn/actions/caches/${cache.id}`]),
        );
      }
    }
    // scheduled workflows
    const wfDir = join(root, '.github/workflows');
    state.workflows = { report: [] };
    for (const file of readdirSync(wfDir).filter((f) => f.endsWith('.yml'))) {
      if (!/cron:/.test(readFileSync(join(wfDir, file), 'utf8'))) continue;
      const runs =
        ghJson([
          'run',
          'list',
          '--workflow',
          file,
          '--limit',
          '3',
          '--json',
          'conclusion,status',
        ]) ?? [];
      const completed = runs.filter((r) => r.status === 'completed' || r.conclusion);
      const verdict = classifyScheduledRun({
        name: file,
        recentConclusions: completed.map((r) => r.conclusion),
        totalRuns: runs.length,
      });
      if (verdict === 'flag') state.workflows.report.push(`${file}: last 3 runs all failed`);
      if (verdict === 'report-never-ran')
        state.workflows.report.push(`${file}: scheduled but has no recorded runs`);
    }
  }

  // 7. docs ----------------------------------------------------------------------
  {
    const docOut = tryExec('node', [join(root, 'scripts/doc-refs-gate.mjs'), '--report'], {
      cwd: root,
    });
    const featureMap = execCode('node', [
      join(root, 'scripts/generate-feature-map.mjs'),
      '--check',
    ]);
    state.docs = { report: [] };
    if (docOut !== null && docOut.trim().length > 0) {
      state.docs.report.push(...docOut.trim().split('\n'));
    }
    if (featureMap !== 0)
      state.docs.report.push(
        'feature-map.json is out of date with scripts/generate-feature-map.mjs',
      );
    if (docOut === null)
      state.docs.report.push('doc-refs-gate found broken references — see preflight');
  }

  // 8. security -----------------------------------------------------------------
  {
    const sec = { report: [] };
    if (tryExec('gh', ['api', 'repos/xiechimon/cairn/vulnerability-alerts']) === null) {
      sec.report.push('Dependabot vulnerability alerts are disabled or unreachable');
    }
    const vuln = ghPaged('repos/xiechimon/cairn/dependabot/alerts?state=open', '.[]');
    if (vuln === null) {
      sec.report.push('Dependabot open-alert list not readable with this token');
    } else {
      for (const a of vuln) {
        sec.report.push(
          `Dependabot ${a.security_advisory?.severity ?? a.security_vulnerability?.severity ?? ''}: ${a.security_advisory?.summary ?? a.html_url} (${a.dependency?.package?.name ?? '?'})`,
        );
      }
    }
    const fixes = ghJson(['api', 'repos/xiechimon/cairn/automated-security-fixes']);
    if (fixes?.enabled === true)
      sec.report.push('automated security fixes (bump PRs) are enabled — policy says off');
    const codeql = ghJson(['api', 'repos/xiechimon/cairn/code-scanning/default-setup']);
    if (codeql?.state !== 'configured')
      sec.report.push(`CodeQL default setup is ${codeql?.state ?? 'unreachable'}`);
    const repoMeta = ghJson(['api', 'repos/xiechimon/cairn']);
    const scanStatus = repoMeta?.security_and_analysis?.secret_scanning?.status;
    if (scanStatus && scanStatus !== 'enabled') sec.report.push(`secret scanning is ${scanStatus}`);
    const scanning = ghPaged('repos/xiechimon/cairn/code-scanning/alerts?state=open', '.[]');
    if (scanning === null) {
      sec.report.push('CodeQL alert list not readable with this token');
    }
    for (const a of scanning ?? []) {
      sec.report.push(
        `CodeQL open: ${a.rule?.description ?? a.rule?.id} in ${a.most_recent_instance?.location?.path ?? '?'}`,
      );
    }
    const secrets = ghPaged('repos/xiechimon/cairn/secret-scanning/alerts?state=open', '.[]');
    if (secrets === null) {
      sec.report.push('secret-scanning alert list not readable with this token');
    }
    for (const a of secrets ?? []) {
      sec.report.push(`secret-scanning open: ${a.secret_type_display_name ?? a.secret_type}`);
    }
    state.security = sec;
  }

  // 9. settings drift -------------------------------------------------------------
  {
    const drift = { report: [] };
    const repoMeta = ghJson(['api', 'repos/xiechimon/cairn']);
    if (repoMeta?.has_wiki === true) drift.report.push('wiki is enabled again — turn it off');
    const templatesDir = join(root, '.github/DISCUSSION_TEMPLATE');
    if (!existsSync(templatesDir) || readdirSync(templatesDir).length === 0) {
      drift.report.push('Discussions templates are missing');
    }
    const rulesets = ghJson(['api', 'repos/xiechimon/cairn/rulesets']) ?? [];
    const green = rulesets.find((r) => r.name === 'green-main');
    const detail = green ? ghJson(['api', `repos/xiechimon/cairn/rulesets/${green.id}`]) : null;
    const ruleTypes = detail?.rules?.map((r) => r.type) ?? [];
    const required = detail?.rules?.find((r) => r.type === 'required_status_checks');
    const contexts = new Set(
      required?.parameters?.required_status_checks?.map((c) => c.context) ?? [],
    );
    const intact =
      green?.enforcement === 'active' &&
      ['deletion', 'non_fast_forward', 'required_status_checks'].every((t) =>
        ruleTypes.includes(t),
      ) &&
      ['check', 'pack-smoke', 'e2e-gate'].every((c) => contexts.has(c));
    if (!intact) drift.report.push('green-main ruleset is missing or weakened');
    state.settings = drift;
  }

  // report issue -----------------------------------------------------------------
  const issueBody = renderReport(state, 'issue');
  const runSummary = [...actions, '', issueBody].join('\n');
  if (summaryFile)
    appendFileSync(summaryFile, `## Repo hygiene (${mode})\n\n\`\`\`\n${runSummary}\n\`\`\`\n`);
  process.stdout.write(`${runSummary}\n`);

  if (writeReport) {
    const existing = ghJson([
      'issue',
      'list',
      '--state',
      'open',
      '--limit',
      '100',
      '--search',
      `in:title "${REPORT_TITLE}"`,
      '--json',
      'number,title',
    ])?.find((i) => i.title === REPORT_TITLE);
    if (existing) {
      gh(['issue', 'edit', String(existing.number), '--body', issueBody]);
    } else {
      ghCreate([
        'issue',
        'create',
        '--title',
        REPORT_TITLE,
        '--body',
        issueBody,
        '--label',
        'needs-triage',
      ]);
      const number = ghJson([
        'issue',
        'list',
        '--state',
        'open',
        '--limit',
        '100',
        '--search',
        `in:title "${REPORT_TITLE}"`,
        '--json',
        'number,title',
      ])?.find((i) => i.title === REPORT_TITLE)?.number;
      if (Number.isFinite(number)) {
        const id = ghJson([
          'api',
          'graphql',
          '-f',
          `query={ repository(owner:"${boardLogin}",name:"cairn") { issue(number:${number}) { id } } }`,
        ])?.data?.repository?.issue?.id;
        if (id) {
          tryExec('gh', [
            'api',
            'graphql',
            '-f',
            `query=mutation { pinIssue(input:{issueId:"${id}"}) { issue { number } } }`,
          ]);
        }
      }
    }
  }
  mkdirSync(join(root, '.gardener'), { recursive: true });
  writeFileSync(
    join(root, '.gardener/repo-hygiene.json'),
    JSON.stringify({ mode, at: new Date().toISOString(), state }, null, 2),
  );
  if (mode === 'apply' && actions.some((line) => line.startsWith('FAIL '))) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`repo-hygiene: ${error.message}`);
    process.exitCode = 2;
  });
}
