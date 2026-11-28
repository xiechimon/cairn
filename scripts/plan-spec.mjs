import { createHash } from 'node:crypto';

const FEAT = /^feat(?:\(|:|\s|$)/;
const EXEMPT =
  /^(?:fix|test|docs|chore|ci|ops|refactor|style|perf|security)(?:\(|:|\s|$)|^Revert\s/;
const STATE_PROTO =
  /^(?:apps\/server\/(?:drizzle\/|src\/db\/schema\.ts$)|packages\/shared\/src\/protocol\/)/;
const PLAN_PATH = /^docs\/design\/[a-z0-9][a-z0-9._-]*\.md$/i;
const RESERVED = /^docs\/design\/(?:README|tested-sha-landing|preflight-ci-verification)\.md$/i;
const PLACEHOLDER =
  /^(?:todo|tbd)(?:\b|$)|^(?:n\/?a|none|placeholder|pending|later|\.\.\.|-|<[^>]+>)$/i;
const HOLLOW_MODEL =
  /^(?:same|self|author|subagent|agent|reviewer|fresh(?:[- ]context)?(?:\s+subagent)?|plan\s+gate\s+reviewer|model|unknown|auto|default)$/i;
const PROVING_TEST_RX =
  /(?:^|[\s`"'([+,;])((?:apps|packages|integration|eval)\/[A-Za-z0-9._/@-]+\.(?:test\.(?:ts|tsx|mts)|spec\.(?:ts|tsx))|scripts\/[A-Za-z0-9._/@-]+\.test\.mjs)(?=$|[\s`"'()\]+,;:])/g;

const stripOuter = (text) =>
  String(text ?? '')
    .replace(/^[\s`"'*-]+|[\s`"'*-]+$/g, '')
    .trim();

export const isHollow = (text, min = 8) => {
  const s = stripOuter(text);
  return s.length < min || PLACEHOLDER.test(s);
};

export const isValidPlanPath = (p) =>
  typeof p === 'string' && !p.includes('..') && PLAN_PATH.test(p) && !RESERVED.test(p);

export const extractPlanTrailer = (msg) => /^Plan:\s*(\S+)\s*$/im.exec(msg)?.[1] ?? null;

export function isTier1Commit(subject, productRuntimePaths) {
  if (FEAT.test(subject.trim()) && productRuntimePaths.length > 0)
    return { required: true, reason: 'feat commit touches product runtime files' };
  if (!EXEMPT.test(subject.trim()) && productRuntimePaths.some((p) => STATE_PROTO.test(p)))
    return { required: true, reason: 'persisted-state or protocol change' };
  return {
    required: false,
    reason: productRuntimePaths.length ? 'tier-0 change' : 'no product runtime change',
  };
}

export function extractProvingTestPaths(cell) {
  const out = [];
  const seen = new Set();
  for (const match of String(cell ?? '').matchAll(PROVING_TEST_RX)) {
    const path = match[1];
    if (path.includes('..') || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

export function parseSliceStatus(raw) {
  const clean = stripOuter(raw);
  if (!clean) return { kind: 'missing', target: null };
  if (/^this\s+change$/i.test(clean)) return { kind: 'this-change', target: null };
  const later = /^later\s*:\s*(.+)$/i.exec(clean);
  if (later) {
    const target = stripOuter(later[1]);
    if (target.length < 2 || PLACEHOLDER.test(target)) return { kind: 'invalid', target: null };
    return { kind: 'later', target };
  }
  return { kind: 'invalid', target: null };
}

export function normalizeModelId(raw) {
  if (typeof raw !== 'string') return '';
  const stripped = stripOuter(raw);
  if (!stripped || PLACEHOLDER.test(stripped) || HOLLOW_MODEL.test(stripped)) return '';
  const withoutNotes = stripped
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\s+via\s+.+$/i, '')
    .trim();
  const base = withoutNotes.includes('/')
    ? withoutNotes.slice(withoutNotes.lastIndexOf('/') + 1)
    : withoutNotes;
  const cleaned = base
    .toLowerCase()
    .replace(/@.*$/, '')
    .replace(/[-_. ]?20\d{6}(?:[-_.]?\d+)?$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (cleaned.length < 3 || PLACEHOLDER.test(cleaned) || HOLLOW_MODEL.test(cleaned)) return '';
  return cleaned;
}

export function scanPlan(content) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const sections = new Map();
  const headings = [];
  let [fence, cur, revAt] = [null, null, -1];
  for (let i = 0; i < lines.length; i += 1) {
    const line = i === 0 ? lines[i].replace(/^\uFEFF/, '') : lines[i];
    const mark = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length && !mark[2].trim())
        fence = null;
      continue;
    }
    if (mark && !(mark[1][0] === '`' && mark[2].includes('`'))) {
      fence = mark[1];
      continue;
    }
    const h = /^ {0,3}##[ \t]+(.+?)[ \t]*$/.exec(line);
    const setext = /^ {0,3}[^\s#>|*+`~-]/.test(line) && /^ {0,3}-+[ \t]*$/.test(lines[i + 1] ?? '');
    if (h || setext) {
      const name = (h ? h[1].replace(/[ \t]+#+[ \t]*$/, '') : line.trim()).toLowerCase();
      headings.push(name);
      if (revAt === -1 && name === 'review') revAt = i;
      cur = [];
      sections.set(name, cur);
      if (!h) i += 1;
      continue;
    }
    if (cur) cur.push(line);
  }
  const body = `${(revAt === -1 ? lines : lines.slice(0, revAt)).join('\n').trimEnd()}\n`;
  const review = revAt === -1 ? null : (sections.get('review') ?? []).join('\n');
  return { sections, body, review, headings };
}

export const computePlanHash = (content) =>
  createHash('sha256').update(scanPlan(content).body, 'utf8').digest('hex');

const splitRow = (line) =>
  line
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, '|').trim());

export function parseEdgeCases(sections) {
  const edges = (sections.get('edge cases') ?? [])
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|'));
  const headerCells = edges.length >= 1 ? splitRow(edges[0]) : [];
  const hasSeparator = edges.length >= 2 && /^\|[\s:-]+(?:\|[\s:-]+)+\|?$/.test(edges[1]);
  const hasSliceColumn = headerCells.length >= 4 && /slice|status/i.test(headerCells[3]);
  const rows = hasSeparator
    ? edges.slice(2).map((line, idx) => {
        const cells = splitRow(line);
        const sliceStatusRaw = cells[3] ?? '';
        return {
          index: idx + 1,
          cells,
          edgeCase: cells[0] ?? '',
          userBehavior: cells[1] ?? '',
          provingTest: cells[2] ?? '',
          sliceStatusRaw,
          sliceStatus: parseSliceStatus(sliceStatusRaw),
          testPaths: extractProvingTestPaths(cells[2] ?? ''),
        };
      })
    : [];
  const dedupe = (paths) => [...new Set(paths)];
  const requiredTestPaths = dedupe(
    rows.filter((r) => r.sliceStatus.kind !== 'later').flatMap((r) => r.testPaths),
  );
  const thisChangeTestPaths = dedupe(
    rows.filter((r) => r.sliceStatus.kind === 'this-change').flatMap((r) => r.testPaths),
  );
  return {
    lineCount: edges.length,
    hasSeparator,
    hasSliceColumn,
    rows,
    requiredTestPaths,
    thisChangeTestPaths,
  };
}

export function validatePlanContent(content) {
  const errors = [];
  const pushOnce = (msg) => {
    if (!errors.includes(msg)) errors.push(msg);
  };
  const { sections, body, review, headings } = scanPlan(content);
  for (const name of ['user scenario', 'scope', 'edge cases', 'out of scope', 'review']) {
    if (headings.filter((heading) => heading === name).length > 1)
      errors.push(`Duplicate ## ${name} section`);
  }
  const reviewIndex = headings.indexOf('review');
  if (reviewIndex !== -1 && reviewIndex !== headings.length - 1)
    errors.push('## Review must be the final level-two section');
  const expectedHash = createHash('sha256').update(body, 'utf8').digest('hex');
  const list = (key, rx) => (sections.get(key) ?? []).map((l) => rx.exec(l)?.[1]).filter(Boolean);
  if (isHollow((sections.get('user scenario') ?? []).join(' '), 40))
    errors.push('User scenario must be a concrete >=40-char scenario');
  const scope = list('scope', /^\s*\d+\.\s+(.+)$/);
  if (scope.length === 0 || scope.some((x) => isHollow(x, 10)))
    errors.push('Scope must contain numbered rows with concrete behavior');
  const edgeCases = parseEdgeCases(sections);
  if (edgeCases.lineCount < 4 || !edgeCases.hasSeparator)
    errors.push('Edge cases table must have at least 2 concrete rows');
  else {
    if (!edgeCases.hasSliceColumn)
      errors.push('Edge cases table must include a Slice/Status column');
    for (const row of edgeCases.rows) {
      if (isHollow(row.edgeCase, 8) || isHollow(row.userBehavior, 8))
        pushOnce('Every Edge cases row must fill edge case and user behavior');
      if (row.testPaths.length === 0)
        pushOnce('Every Edge cases row Proving test must name a test file path');
      if (
        edgeCases.hasSliceColumn &&
        row.sliceStatus.kind !== 'this-change' &&
        row.sliceStatus.kind !== 'later'
      )
        pushOnce(
          'Every Edge cases row must set Slice/Status to "this change" or "later: <ticket or slice>"',
        );
    }
  }
  const out = list('out of scope', /^\s*[-*]\s+(.+)$/);
  if (out.length === 0 || out.some((x) => isHollow(x, 8)))
    errors.push('Out of scope must list at least one concrete bullet item');
  if (review === null) errors.push('Missing ## Review section');
  else {
    const fields = new Map();
    const metadata =
      /^\s*(?:[-*+]\s+)?(Verdict|Plan-SHA256|Author-Model|Reviewer|Reviewer-Model|Findings|Fix-check|Fix-check-Plan-SHA256):[ \t]*(.*)$/i;
    for (const line of review.split('\n')) {
      const match = metadata.exec(line);
      if (!match) continue;
      const key = match[1].toLowerCase();
      if (fields.has(key)) errors.push(`Duplicate ## Review ${match[1]} field`);
      else fields.set(key, match[2]);
    }
    const field = (name) => fields.get(name.toLowerCase()) ?? '';
    const verdict = field('Verdict').trim().toUpperCase();
    if (!['PASS', 'CONCERNS', 'BLOCK', 'FAIL'].includes(verdict))
      errors.push('## Review must record a valid Verdict');
    const hm = /^([0-9a-f]{64})$/i.exec(field('Plan-SHA256').trim());
    if (!hm) errors.push('## Review missing 64-char Plan-SHA256');
    else if (verdict === 'PASS' && hm[1].toLowerCase() !== expectedHash)
      errors.push(`Plan-SHA256 mismatch (expected ${expectedHash})`);
    const fixCheck = field('Fix-check').trim().toUpperCase();
    if (fields.has('fix-check') && fixCheck !== 'PASS' && fixCheck !== 'FAIL')
      errors.push('## Review Fix-check must be PASS or FAIL');
    if (['CONCERNS', 'BLOCK', 'FAIL'].includes(verdict)) {
      if (fixCheck !== 'PASS') errors.push('## Review must record Fix-check: PASS');
      const fixHash = /^([0-9a-f]{64})$/i.exec(field('Fix-check-Plan-SHA256').trim());
      if (!fixHash) errors.push('## Review missing 64-char Fix-check-Plan-SHA256');
      else if (fixHash[1].toLowerCase() !== expectedHash)
        errors.push(`Fix-check-Plan-SHA256 mismatch (expected ${expectedHash})`);
    }
    if (isHollow(field('Reviewer'), 3)) errors.push('## Review must name Reviewer');
    const authorModel = field('Author-Model');
    const reviewerModel = field('Reviewer-Model');
    const authorNorm = normalizeModelId(authorModel);
    const reviewerNorm = normalizeModelId(reviewerModel);
    if (!authorNorm) errors.push('## Review must record Author-Model');
    if (!reviewerNorm) errors.push('## Review must record Reviewer-Model');
    if (authorNorm && reviewerNorm && authorNorm === reviewerNorm)
      errors.push(
        `## Review Reviewer-Model (${reviewerModel.trim()}) must differ from Author-Model (${authorModel.trim()})`,
      );
    if (isHollow(field('Findings'), 5)) errors.push('## Review must summarize Findings');
  }
  return { ok: errors.length === 0, errors, expectedHash, edgeCases };
}
