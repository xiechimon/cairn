import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REVIEWER_INPUT_FORBIDDEN = new Set([
  'defect',
  'location',
  'correction',
  'labels',
  'answer',
  'knownCorrection',
]);

export const ESCAPE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export function collectCandidates({ since, until, cwd = process.cwd() }) {
  const bounds = [since, until].map((value) => {
    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    )
      throw new Error('Interval bounds must be explicit UTC timestamps ending in Z');
    const date = new Date(value);
    if (
      !Number.isFinite(date.getTime()) ||
      date.toISOString() !== value.replace(/Z$/, value.includes('.') ? 'Z' : '.000Z')
    )
      throw new Error('Invalid UTC timestamp');
    return date.getTime();
  });
  if (bounds[0] >= bounds[1]) throw new Error('Expected since < until');
  const git = (args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const history = git(['log', 'origin/main', '--format=%H%x00%cI', '-z']);
  const fields = history.split('\0');
  const candidates = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const followUpSha = fields[i];
    const time = new Date(fields[i + 1]).getTime();
    if (time < bounds[0] || time >= bounds[1]) continue;
    const message = git(['show', '-s', '--format=%B', followUpSha]).replace(/\n$/, '');
    const subject = message.split('\n', 1)[0];
    const conventionalFix = /^(?:fix|hotfix|bugfix)(?:\([^\n)]+\))?!?:\s+\S/i.test(subject);
    const scopedFix = /^[a-z][\w-]*\([^\n)]+\)!?:\s+(?:fix|hotfix|bugfix)\b/i.test(subject);
    const revert =
      /^Revert "[^\n]+"(?: \(#\d+\))?$/.test(subject) ||
      /^revert(?:\([^\n)]+\))?!?:\s+\S/i.test(subject);
    if (!conventionalFix && !scopedFix && !revert) continue;
    const paths = git([
      'diff-tree',
      '--root',
      '--no-commit-id',
      '--name-only',
      '-r',
      '-m',
      '-z',
      followUpSha,
    ])
      .split('\0')
      .filter(Boolean);
    candidates.push({
      followUpSha,
      timestamp: new Date(time).toISOString(),
      message,
      paths: [...new Set(paths)].sort(),
      fixingPr: Number(subject.match(/\(#(\d+)\)\s*$/)?.[1]) || null,
    });
  }
  return candidates.sort(
    (a, b) => a.timestamp.localeCompare(b.timestamp) || a.followUpSha.localeCompare(b.followUpSha),
  );
}

function gitAt(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

function tryGitAt(cwd, args) {
  try {
    return { ok: true, stdout: gitAt(cwd, args) };
  } catch (error) {
    return { ok: false, error };
  }
}

function lookupRef(responder, number) {
  const key = String(number);
  return responder.refs?.[key] ?? responder.refs?.[number] ?? null;
}

function expandSha(cwd, sha) {
  if (!sha || typeof sha !== 'string') return null;
  const result = tryGitAt(cwd, ['rev-parse', '--verify', `${sha}^{commit}`]);
  if (!result.ok) return null;
  return result.stdout.trim();
}

function resolveCommitToPr(cwd, sha, responder) {
  const full = expandSha(cwd, sha);
  if (!full) return { pr: null, mergedAt: null, reason: 'missing-commit' };
  const subject = gitAt(cwd, ['show', '-s', '--format=%s', full]).trim();
  const subjectPr = Number(subject.match(/\(#(\d+)\)\s*$/)?.[1]) || null;
  const direct =
    responder.pullsByCommit?.[full] ?? responder.pullsByCommit?.[full.slice(0, 7)] ?? null;
  let pulls = [];
  if (direct) pulls = direct;
  else if (!responder.offline && responder.allowNetwork) {
    try {
      const repo = gitAt(cwd, ['remote', 'get-url', 'origin']).trim();
      const match = /github\.com[:/]([^/]+)\/([^/.]+)/.exec(repo);
      if (match) {
        const body = execFileSync(
          'gh',
          ['api', `repos/${match[1]}/${match[2]}/commits/${full}/pulls`],
          { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
        );
        pulls = JSON.parse(body).map((pull) => ({
          number: pull.number,
          merged_at: pull.merged_at,
        }));
      }
    } catch {
      pulls = [];
    }
  }
  pulls = pulls.filter((pull) => pull.merged_at);
  const unique = [...new Map(pulls.map((pull) => [pull.number, pull])).values()];
  if (unique.length > 1) {
    if (subjectPr && unique.some((pull) => pull.number === subjectPr)) {
      const chosen = unique.find((pull) => pull.number === subjectPr);
      return { pr: subjectPr, mergedAt: chosen.merged_at, reason: null };
    }
    return { pr: null, mergedAt: null, reason: 'multiple-associated-prs' };
  }
  if (unique.length === 1) {
    const only = unique[0];
    if (subjectPr && subjectPr !== only.number)
      return { pr: null, mergedAt: null, reason: 'conflicting-pr-metadata' };
    return { pr: only.number, mergedAt: only.merged_at, reason: null };
  }
  if (subjectPr) {
    const ref = lookupRef(responder, subjectPr);
    if (ref?.type === 'pull' && ref.merged_at)
      return { pr: subjectPr, mergedAt: ref.merged_at, reason: null };
    if (ref?.type === 'issue') return { pr: null, mergedAt: null, reason: 'issue-not-pr' };
    return { pr: subjectPr, mergedAt: null, reason: 'unavailable-pr-metadata' };
  }
  return { pr: null, mergedAt: null, reason: 'unavailable-pr-metadata' };
}

function finishResolved(trace, { introducingSha, originalPr, introducingMergedAt, method, files }) {
  trace.introducingSha = introducingSha;
  trace.originalPr = originalPr;
  trace.introducingMergedAt = introducingMergedAt
    ? new Date(introducingMergedAt).toISOString()
    : null;
  trace.method = method;
  if (files) trace.evidence.files = files;
  let inside = null;
  if (trace.introducingMergedAt && trace.followUpTimestamp) {
    const delta =
      new Date(trace.followUpTimestamp).getTime() - new Date(trace.introducingMergedAt).getTime();
    inside = Number.isFinite(delta) && delta >= 0 ? delta <= ESCAPE_WINDOW_MS : false;
  }
  trace.withinEscapeWindow = inside;
  if (inside === false) {
    trace.status = 'outside-window';
    trace.unresolvedReason = null;
    return trace;
  }
  if (originalPr === null || introducingSha === null || !trace.introducingMergedAt) {
    trace.status = 'unresolved';
    trace.unresolvedReason = trace.unresolvedReason ?? 'unavailable-pr-metadata';
    return trace;
  }
  trace.status = 'resolved';
  trace.unresolvedReason = null;
  return trace;
}

function stripDiffGitPrefix(value) {
  if (value === '/dev/null') return '/dev/null';
  if (value.startsWith('a/') || value.startsWith('b/')) return value.slice(2);
  return value;
}

function readDiffGitToken(line, index, role) {
  if (index >= line.length) return null;
  if (line[index] === '"') {
    let i = index + 1;
    let out = '';
    const bytes = [];
    const flushBytes = () => {
      if (bytes.length === 0) return;
      out += new TextDecoder('utf-8').decode(Uint8Array.from(bytes));
      bytes.length = 0;
    };
    while (i < line.length) {
      if (line[i] === '\\' && i + 1 < line.length) {
        const next = line[++i];
        if (next >= '0' && next <= '7') {
          let oct = next;
          for (
            let k = 0;
            k < 2 && i + 1 < line.length && line[i + 1] >= '0' && line[i + 1] <= '7';
            k++
          )
            oct += line[++i];
          bytes.push(Number.parseInt(oct, 8));
          i++;
          continue;
        }
        flushBytes();
        if (next === 'a') out += '\x07';
        else if (next === 'b') out += '\b';
        else if (next === 't') out += '\t';
        else if (next === 'n') out += '\n';
        else if (next === 'v') out += '\v';
        else if (next === 'f') out += '\f';
        else if (next === 'r') out += '\r';
        else if (next === '\\' || next === '"') out += next;
        else out += next;
        i++;
        continue;
      }
      if (line[i] === '"') {
        flushBytes();
        return { value: out, next: i + 1 };
      }
      flushBytes();
      out += line[i++];
    }
    return null;
  }
  if (role === 'second') return { value: line.slice(index), next: line.length };
  let splitAt = -1;
  for (const marker of [' b/', ' /dev/null', ' "']) {
    const at = line.indexOf(marker, index);
    if (at < 0) continue;
    if (splitAt < 0 || at < splitAt) splitAt = at;
  }
  if (splitAt < 0) return null;
  return { value: line.slice(index, splitAt), next: splitAt };
}

export function parseDiffGitPaths(line) {
  if (!line.startsWith('diff --git ')) return null;
  const first = readDiffGitToken(line, 'diff --git '.length, 'first');
  if (!first || line[first.next] !== ' ') return null;
  const second = readDiffGitToken(line, first.next + 1, 'second');
  if (!second) return null;
  return { a: stripDiffGitPrefix(first.value), b: stripDiffGitPrefix(second.value) };
}

function blameChangedLines(cwd, followUpSha, paths) {
  const parentResult = tryGitAt(cwd, ['rev-parse', '--verify', `${followUpSha}^`]);
  if (!parentResult.ok)
    return { status: 'unresolved', reason: 'missing-parent-history', files: [], shas: [] };
  const parent = parentResult.stdout.trim();
  const diffResult = tryGitAt(cwd, [
    'diff',
    '--unified=0',
    '--find-renames',
    `${parent}`,
    followUpSha,
    '--',
    ...paths,
  ]);
  if (!diffResult.ok)
    return { status: 'unresolved', reason: 'shallow-or-unavailable-diff', files: [], shas: [] };
  const rangesByPath = new Map();
  let blamePath = null;
  for (const line of diffResult.stdout.split('\n')) {
    const pathsInHeader = parseDiffGitPaths(line);
    if (pathsInHeader) {
      blamePath = pathsInHeader.a === '/dev/null' ? pathsInHeader.b : pathsInHeader.a;
      continue;
    }
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!hunk || !blamePath || blamePath === '/dev/null') continue;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    if (count === 0) continue;
    const list = rangesByPath.get(blamePath) ?? [];
    list.push({ start, end: start + count - 1 });
    rangesByPath.set(blamePath, list);
  }
  if (rangesByPath.size === 0)
    return { status: 'unresolved', reason: 'no-blameable-lines', files: [], shas: [] };
  const shas = new Set();
  const files = [];
  for (const [path, ranges] of rangesByPath) {
    const fileRanges = [];
    for (const range of ranges) {
      const blame = tryGitAt(cwd, [
        'blame',
        '--porcelain',
        '-L',
        `${range.start},${range.end}`,
        parent,
        '--',
        path,
      ]);
      if (!blame.ok)
        return {
          status: 'unresolved',
          reason: 'shallow-or-unavailable-blame',
          files,
          shas: [...shas],
        };
      for (const blameLine of blame.stdout.split('\n')) {
        const header = /^([0-9a-f]{40}) \d+ \d+(?: \d+)?$/.exec(blameLine);
        if (header) shas.add(header[1]);
      }
      fileRanges.push({ start: range.start, end: range.end });
    }
    files.push({ path, lines: fileRanges });
  }
  const unique = [...shas];
  if (unique.length === 0)
    return { status: 'unresolved', reason: 'shallow-or-unavailable-blame', files, shas: unique };
  if (unique.length > 1) return { status: 'multiple-origin', reason: null, files, shas: unique };
  return { status: 'resolved', reason: null, files, shas: unique };
}

function evidenceFiles(cwd, followUpSha, paths) {
  const blamed = blameChangedLines(cwd, followUpSha, paths);
  if (blamed.files.length > 0) return blamed.files;
  return paths.map((path) => ({ path, lines: [] }));
}

export function resolveTraces(candidates, { cwd = process.cwd(), responder = {} } = {}) {
  const active = {
    pullsByCommit: responder.pullsByCommit ?? {},
    refs: responder.refs ?? {},
    offline: responder.offline ?? true,
    allowNetwork: responder.allowNetwork ?? false,
  };
  return candidates.map((candidate) => {
    const trace = {
      followUpSha: candidate.followUpSha,
      fixingSha: candidate.followUpSha,
      followUpTimestamp: candidate.timestamp,
      fixingPr: candidate.fixingPr,
      introducingSha: null,
      introducingMergedAt: null,
      originalPr: null,
      method: null,
      status: 'unresolved',
      unresolvedReason: null,
      withinEscapeWindow: null,
      evidence: {
        paths: candidate.paths,
        files: [],
        references: [],
        unvalidatedReferences: [],
        introducingCandidates: [],
      },
    };
    const message = candidate.message ?? '';

    const revertMatch = /This reverts commit ([0-9a-f]{7,40})\.?/i.exec(message);
    const revertSha = revertMatch?.[1] ?? null;
    if (revertSha) {
      const full = expandSha(cwd, revertSha);
      if (!full) {
        trace.unresolvedReason = 'missing-reverted-commit';
        trace.method = 'revert-body';
        return trace;
      }
      const resolved = resolveCommitToPr(cwd, full, active);
      if (
        resolved.reason === 'multiple-associated-prs' ||
        resolved.reason === 'conflicting-pr-metadata'
      ) {
        trace.status =
          resolved.reason === 'multiple-associated-prs' ? 'multiple-origin' : 'unresolved';
        trace.unresolvedReason = resolved.reason;
        trace.method = 'revert-body';
        trace.introducingSha = full;
        return trace;
      }
      if (resolved.pr !== null && resolved.mergedAt)
        return finishResolved(trace, {
          introducingSha: full,
          originalPr: resolved.pr,
          introducingMergedAt: resolved.mergedAt,
          method: 'revert-body',
          files: evidenceFiles(cwd, candidate.followUpSha, candidate.paths),
        });
      trace.method = 'revert-body';
      trace.introducingSha = full;
      trace.unresolvedReason = resolved.reason ?? 'unavailable-pr-metadata';
      return trace;
    }

    const refs = [];
    for (const match of message.matchAll(/\bintroduced by #(\d+)\b/gi))
      refs.push({ kind: 'introduced-by', number: Number(match[1]), needsValidation: true });
    for (const match of message.matchAll(/\b(?:fixes|fixed)\s+#(\d+)\b/gi))
      refs.push({ kind: 'fixes', number: Number(match[1]), needsValidation: true });
    const validated = [];
    for (const ref of refs) {
      const meta = lookupRef(active, ref.number);
      if (!meta) {
        trace.evidence.unvalidatedReferences.push({
          ...ref,
          reason: 'unavailable-pr-metadata',
        });
        continue;
      }
      if (meta.type === 'issue') {
        trace.evidence.unvalidatedReferences.push({ ...ref, reason: 'issue-not-pr' });
        continue;
      }
      if (meta.type !== 'pull' || !meta.merged_at) {
        trace.evidence.unvalidatedReferences.push({
          ...ref,
          reason: 'unavailable-pr-metadata',
        });
        continue;
      }
      const mergeSha = meta.merge_commit_sha ? expandSha(cwd, meta.merge_commit_sha) : null;
      validated.push({
        ...ref,
        number: meta.number,
        merged_at: meta.merged_at,
        merge_commit_sha: mergeSha,
      });
      trace.evidence.references.push({ kind: ref.kind, number: meta.number });
    }
    if (validated.length > 1) {
      const prs = [...new Set(validated.map((ref) => ref.number))];
      if (prs.length > 1) {
        trace.status = 'multiple-origin';
        trace.method = 'explicit-reference';
        trace.evidence.introducingCandidates = validated
          .map((ref) => ref.merge_commit_sha)
          .filter(Boolean);
        return trace;
      }
    }
    if (validated.length >= 1) {
      const chosen = validated[0];
      if (!chosen.merge_commit_sha) {
        trace.method = 'explicit-reference';
        trace.originalPr = chosen.number;
        trace.introducingMergedAt = new Date(chosen.merged_at).toISOString();
        trace.unresolvedReason = 'missing-merge-commit';
        return trace;
      }
      return finishResolved(trace, {
        introducingSha: chosen.merge_commit_sha,
        originalPr: chosen.number,
        introducingMergedAt: chosen.merged_at,
        method: 'explicit-reference',
        files: evidenceFiles(cwd, candidate.followUpSha, candidate.paths),
      });
    }

    const blamed = blameChangedLines(cwd, candidate.followUpSha, candidate.paths);
    trace.evidence.files = blamed.files;
    if (blamed.status === 'unresolved') {
      trace.method = 'blame';
      trace.unresolvedReason = blamed.reason;
      return trace;
    }
    if (blamed.status === 'multiple-origin') {
      trace.status = 'multiple-origin';
      trace.method = 'blame';
      trace.evidence.introducingCandidates = blamed.shas;
      return trace;
    }
    const introducingSha = blamed.shas[0];
    const resolved = resolveCommitToPr(cwd, introducingSha, active);
    if (resolved.pr === null || !resolved.mergedAt) {
      trace.method = 'blame';
      trace.introducingSha = introducingSha;
      trace.unresolvedReason = resolved.reason ?? 'unavailable-pr-metadata';
      return trace;
    }
    return finishResolved(trace, {
      introducingSha,
      originalPr: resolved.pr,
      introducingMergedAt: resolved.mergedAt,
      method: 'blame',
      files: blamed.files,
    });
  });
}

function stableStringify(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function caseId({ originalPr, fixingPr, fixingSha, path, startLine, endLine }) {
  return [
    `pr-${originalPr}`,
    `fix-${fixingPr ?? 'none'}`,
    fixingSha.slice(0, 12),
    path.replaceAll(/[^A-Za-z0-9._-]+/g, '_'),
    `L${startLine}-${endLine}`,
  ].join('__');
}

function defectLocations(trace) {
  const files = Array.isArray(trace?.evidence?.files) ? trace.evidence.files : [];
  const locations = [];
  for (const file of files) {
    if (!file || typeof file.path !== 'string' || file.path.length === 0) continue;
    const ranges = Array.isArray(file.lines) ? file.lines : [];
    for (const range of ranges) {
      const start = Number(range?.start);
      const end = Number(range?.end);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) continue;
      locations.push({ path: file.path, startLine: start, endLine: end });
    }
  }
  return locations;
}

function blobLineCount(text) {
  if (text.length === 0) return 0;
  return text.endsWith('\n') ? text.slice(0, -1).split('\n').length : text.split('\n').length;
}

function mapFixingParentLocation(cwd, fixingSha, introducingSha, location) {
  const parentResult = tryGitAt(cwd, ['rev-parse', '--verify', `${fixingSha}^`]);
  if (!parentResult.ok) return { ok: false, reason: 'fixing-parent-missing' };
  const fixingParent = parentResult.stdout.trim();
  const parentBlob = tryGitAt(cwd, ['show', `${fixingParent}:${location.path}`]);
  if (!parentBlob.ok) return { ok: false, reason: 'defect-path-missing-at-fixing-parent' };
  if (location.endLine > blobLineCount(parentBlob.stdout))
    return { ok: false, reason: 'defect-line-out-of-range-at-fixing-parent' };
  const blame = tryGitAt(cwd, [
    'blame',
    '--porcelain',
    '-C',
    '-M',
    '-L',
    `${location.startLine},${location.endLine}`,
    fixingParent,
    '--',
    location.path,
  ]);
  if (!blame.ok) return { ok: false, reason: 'blame-unmapable' };
  const origLines = [];
  let mappedPath = null;
  let currentSha = null;
  for (const line of blame.stdout.split('\n')) {
    const header = /^([0-9a-f]{40}) (\d+) (\d+)(?: (\d+))?$/.exec(line);
    if (header) {
      currentSha = header[1];
      if (currentSha !== introducingSha) return { ok: false, reason: 'blame-not-introducing' };
      origLines.push(Number(header[2]));
      continue;
    }
    if (line.startsWith('filename ') && currentSha === introducingSha)
      mappedPath = line.slice('filename '.length);
  }
  if (origLines.length === 0) return { ok: false, reason: 'unmapped-to-introducing' };
  origLines.sort((a, b) => a - b);
  const startLine = origLines[0];
  const endLine = origLines[origLines.length - 1];
  for (let expected = startLine, index = 0; index < origLines.length; index++, expected++) {
    if (origLines[index] !== expected)
      return { ok: false, reason: 'noncontiguous-introducing-lines' };
  }
  const path = mappedPath || location.path;
  const introBlob = tryGitAt(cwd, ['show', `${introducingSha}:${path}`]);
  if (!introBlob.ok) return { ok: false, reason: 'defect-path-missing-at-introducing' };
  if (endLine > blobLineCount(introBlob.stdout))
    return { ok: false, reason: 'defect-line-out-of-range' };
  return { ok: true, location: { path, startLine, endLine } };
}

function ineligibleReason(trace) {
  if (!trace || typeof trace !== 'object') return 'invalid-trace';
  if (trace.status === 'unresolved') return `unresolved:${trace.unresolvedReason ?? 'unspecified'}`;
  if (trace.status === 'multiple-origin') return 'multiple-origin';
  if (trace.status === 'outside-window') return 'outside-window';
  if (trace.status !== 'resolved') return `status:${trace.status ?? 'missing'}`;
  if (!trace.originalPr) return 'missing-original-pr';
  if (!trace.fixingPr) return 'missing-fixing-pr';
  if (!trace.introducingSha) return 'missing-introducing-sha';
  if (!trace.fixingSha && !trace.followUpSha) return 'missing-fixing-sha';
  if (defectLocations(trace).length === 0) return 'missing-defect-location';
  return null;
}

function loadSchema() {
  return JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, '../integration/eval/review/case.schema.json'),
      'utf8',
    ),
  );
}

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number' && Number.isInteger(value)) return 'integer';
  return typeof value;
}

function validateAgainstSchema(value, schema, path = '$') {
  const errors = [];
  if (schema.const !== undefined && value !== schema.const)
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value))
    errors.push(`${path}: expected one of ${schema.enum.join(', ')}`);
  if (schema.type) {
    const actual = typeOf(value);
    const typeOk = schema.type === actual || (schema.type === 'number' && actual === 'integer');
    if (!typeOk) errors.push(`${path}: expected ${schema.type}, got ${actual}`);
  }
  if (schema.type === 'string') {
    if (schema.minLength != null && value.length < schema.minLength)
      errors.push(`${path}: string shorter than ${schema.minLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value))
      errors.push(`${path}: string does not match ${schema.pattern}`);
  }
  if (schema.type === 'integer') {
    if (!Number.isInteger(value)) errors.push(`${path}: expected integer`);
    if (Number.isInteger(value) && schema.minimum != null && value < schema.minimum)
      errors.push(`${path}: expected >= ${schema.minimum}`);
  }
  if (schema.type === 'array' && Array.isArray(value) && schema.items) {
    for (let index = 0; index < value.length; index++)
      errors.push(...validateAgainstSchema(value[index], schema.items, `${path}[${index}]`));
  }
  if (schema.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${path}: missing required property ${key}`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!schema.properties?.[key]) errors.push(`${path}: unexpected property ${key}`);
      }
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (key in value) errors.push(...validateAgainstSchema(value[key], child, `${path}.${key}`));
    }
  }
  return errors;
}

function buildCase(trace, location, { cwd }) {
  const introducingSha = expandSha(cwd, trace.introducingSha);
  const fixingSha = expandSha(cwd, trace.fixingSha ?? trace.followUpSha);
  if (!introducingSha) return { ok: false, reason: 'introducing-sha-unresolvable' };
  if (!fixingSha) return { ok: false, reason: 'fixing-sha-unresolvable' };
  const parent = tryGitAt(cwd, ['rev-parse', '--verify', `${introducingSha}^`]);
  if (!parent.ok) return { ok: false, reason: 'replay-base-missing' };
  const replayBase = parent.stdout.trim();
  const mapped = mapFixingParentLocation(cwd, fixingSha, introducingSha, location);
  if (!mapped.ok) return mapped;
  const defect = mapped.location;
  const subject = gitAt(cwd, ['show', '-s', '--format=%s', introducingSha]).trim();
  const diff = gitAt(cwd, ['show', '--format=', '--unified=3', introducingSha]);
  if (!diff.trim()) return { ok: false, reason: 'introducing-diff-empty' };
  const fixingSubject = gitAt(cwd, ['show', '-s', '--format=%s', fixingSha]).trim();
  const fixingPatch = gitAt(cwd, ['diff', `${fixingSha}^`, fixingSha, '--', location.path]);
  const id = caseId({
    originalPr: trace.originalPr,
    fixingPr: trace.fixingPr,
    fixingSha,
    path: defect.path,
    startLine: defect.startLine,
    endLine: defect.endLine,
  });
  const limitations = [];
  if (!fixingPatch.trim()) limitations.push('fixing-patch-empty-for-path');
  if (defect.path !== location.path) limitations.push('path-renamed-since-introducing');
  if (defect.startLine !== location.startLine || defect.endLine !== location.endLine)
    limitations.push('lines-shifted-since-introducing');
  return {
    ok: true,
    case: {
      version: 1,
      id,
      provenance: {
        originalPr: trace.originalPr,
        fixingPr: trace.fixingPr,
        introducingSha,
        fixingSha,
        replayBase,
      },
      reviewerInput: {
        originalPr: trace.originalPr,
        subject,
        diff,
      },
      answer: {
        defect: {
          path: defect.path,
          startLine: defect.startLine,
          endLine: defect.endLine,
        },
        labels: ['production-escape', trace.method ?? 'unknown-method'],
        correction: fixingPatch.trim() ? `${fixingSubject}\n\n${fixingPatch}` : fixingSubject,
      },
      tracing: {
        method: String(trace.method ?? 'unknown'),
        evidenceSufficiency: 'verified',
        replayLimitations: limitations,
        evidence: trace.evidence ?? {},
      },
    },
  };
}

export function exportCases({ traces, outDir, cwd = process.cwd() }) {
  if (!Array.isArray(traces)) throw new Error('export-cases expects a traces array');
  const casesDir = join(outDir, 'cases');
  mkdirSync(casesDir, { recursive: true });
  const exported = [];
  const candidates = [];
  const seen = new Set();
  for (const trace of traces) {
    const reason = ineligibleReason(trace);
    if (reason) {
      candidates.push({
        followUpSha: trace?.followUpSha ?? trace?.fixingSha ?? null,
        fixingSha: trace?.fixingSha ?? trace?.followUpSha ?? null,
        introducingSha: trace?.introducingSha ?? null,
        originalPr: trace?.originalPr ?? null,
        fixingPr: trace?.fixingPr ?? null,
        status: trace?.status ?? null,
        unresolvedReason: trace?.unresolvedReason ?? null,
        ineligibleReason: reason,
      });
      continue;
    }
    const locations = defectLocations(trace);
    for (const location of locations) {
      const built = buildCase(trace, location, { cwd });
      if (!built.ok) {
        candidates.push({
          followUpSha: trace.followUpSha ?? trace.fixingSha,
          fixingSha: trace.fixingSha ?? trace.followUpSha,
          introducingSha: trace.introducingSha,
          originalPr: trace.originalPr,
          fixingPr: trace.fixingPr,
          status: trace.status,
          unresolvedReason: null,
          path: location.path,
          startLine: location.startLine,
          endLine: location.endLine,
          ineligibleReason: built.reason,
        });
        continue;
      }
      if (seen.has(built.case.id)) continue;
      seen.add(built.case.id);
      writeFileSync(join(casesDir, `${built.case.id}.json`), stableStringify(built.case));
      exported.push({ id: built.case.id, path: `cases/${built.case.id}.json` });
    }
  }
  candidates.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  exported.sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(join(outDir, 'candidates.json'), stableStringify(candidates));
  return { exported, candidates };
}

function validateBankCase(bankCase, { cwd, schema }) {
  const errors = validateAgainstSchema(bankCase, schema);
  for (const key of Object.keys(bankCase.reviewerInput ?? {})) {
    if (REVIEWER_INPUT_FORBIDDEN.has(key)) errors.push(`reviewerInput must not contain ${key}`);
  }
  if (errors.length) return errors;
  if (bankCase.answer.defect.endLine < bankCase.answer.defect.startLine)
    errors.push('defect line range is invalid');
  const introducingSha = expandSha(cwd, bankCase.provenance.introducingSha);
  const fixingSha = expandSha(cwd, bankCase.provenance.fixingSha);
  const replayBase = expandSha(cwd, bankCase.provenance.replayBase);
  if (!introducingSha) errors.push('introducingSha is not in history');
  if (!fixingSha) errors.push('fixingSha is not in history');
  if (!replayBase) errors.push('replay base is not in history');
  if (introducingSha && replayBase) {
    const parent = tryGitAt(cwd, ['rev-parse', '--verify', `${introducingSha}^`]);
    if (!parent.ok || parent.stdout.trim() !== replayBase)
      errors.push('replay base must be the introducing parent');
  }
  if (introducingSha) {
    const blob = tryGitAt(cwd, ['show', `${introducingSha}:${bankCase.answer.defect.path}`]);
    if (!blob.ok) errors.push('defect path missing at introducing commit');
    else {
      const lineCount = blobLineCount(blob.stdout);
      if (bankCase.answer.defect.endLine > lineCount)
        errors.push('defect line range exceeds introducing blob');
    }
  }
  return errors;
}

export function validateCases(casesDir, { cwd = process.cwd() } = {}) {
  const schema = loadSchema();
  if (!existsSync(casesDir)) return { ok: false, errors: [`missing cases directory: ${casesDir}`] };
  const files = readdirSync(casesDir)
    .filter((name) => name.endsWith('.json'))
    .sort();
  const errors = [];
  const ids = new Set();
  for (const name of files) {
    const path = join(casesDir, name);
    let bankCase;
    try {
      bankCase = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      errors.push(`${name}: invalid JSON (${error.message})`);
      continue;
    }
    if (ids.has(bankCase.id)) errors.push(`${name}: duplicate case id ${bankCase.id}`);
    ids.add(bankCase.id);
    if (name !== `${bankCase.id}.json`)
      errors.push(`${name}: filename must match id ${bankCase.id}.json`);
    for (const error of validateBankCase(bankCase, { cwd, schema }))
      errors.push(`${name}: ${error}`);
  }
  return { ok: errors.length === 0, errors, caseCount: files.length };
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function parseExportArgs(args) {
  let tracesPath = null;
  let outDir = null;
  let cwd = process.cwd();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--traces') {
      tracesPath = args[++i];
      continue;
    }
    if (args[i] === '--out') {
      outDir = args[++i];
      continue;
    }
    if (args[i] === '--cwd') {
      cwd = args[++i];
      continue;
    }
    throw new Error(
      'Usage: node scripts/escape-trace.mjs export-cases --traces path --out dir [--cwd path]',
    );
  }
  if (!tracesPath || !outDir)
    throw new Error(
      'Usage: node scripts/escape-trace.mjs export-cases --traces path --out dir [--cwd path]',
    );
  return { tracesPath, outDir, cwd };
}

function parseValidateArgs(args) {
  let casesDir = null;
  let cwd = process.cwd();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--cwd') {
      cwd = args[++i];
      continue;
    }
    if (casesDir == null && !args[i].startsWith('--')) {
      casesDir = args[i];
      continue;
    }
    throw new Error('Usage: node scripts/escape-trace.mjs validate-cases <cases-dir> [--cwd path]');
  }
  if (!casesDir)
    throw new Error('Usage: node scripts/escape-trace.mjs validate-cases <cases-dir> [--cwd path]');
  return { casesDir, cwd };
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  try {
    const args = process.argv.slice(2);
    if (args[0] === 'trace') {
      let respondFile = null;
      const rest = [];
      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--respond-file') {
          respondFile = args[++i];
          continue;
        }
        rest.push(args[i]);
      }
      if (rest.length > 0 || respondFile === undefined)
        throw new Error('Usage: node scripts/escape-trace.mjs trace [--respond-file path]');
      const input = readFileSync(0, 'utf8');
      const candidates = JSON.parse(input);
      if (!Array.isArray(candidates))
        throw new Error('trace expects a JSON array of candidates on stdin');
      const responder = respondFile
        ? JSON.parse(readFileSync(respondFile, 'utf8'))
        : { pullsByCommit: {}, refs: {} };
      printJson(resolveTraces(candidates, { responder }));
    } else if (args[0] === 'export-cases') {
      const { tracesPath, outDir, cwd } = parseExportArgs(args.slice(1));
      const traces = JSON.parse(readFileSync(tracesPath, 'utf8'));
      const result = exportCases({ traces, outDir: resolve(cwd, outDir), cwd });
      printJson(result);
    } else if (args[0] === 'validate-cases') {
      const { casesDir, cwd } = parseValidateArgs(args.slice(1));
      const result = validateCases(resolve(cwd, casesDir), { cwd });
      if (!result.ok) {
        console.error(result.errors.join('\n'));
        process.exitCode = 1;
      } else {
        printJson({ ok: true, caseCount: result.caseCount });
      }
    } else {
      const candidateArgs = args[0] === 'candidates' ? args.slice(1) : args;
      if (
        candidateArgs.length !== 4 ||
        candidateArgs[0] !== '--since' ||
        candidateArgs[2] !== '--until'
      )
        throw new Error(
          'Usage: node scripts/escape-trace.mjs [candidates] --since UTC --until UTC (inclusive since, exclusive until; origin/main committer timestamps)\n       node scripts/escape-trace.mjs trace [--respond-file path]\n       node scripts/escape-trace.mjs export-cases --traces path --out dir\n       node scripts/escape-trace.mjs validate-cases <cases-dir>',
        );
      printJson(collectCandidates({ since: candidateArgs[1], until: candidateArgs[3] }));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
