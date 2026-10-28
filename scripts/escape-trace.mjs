import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
  if (!sha) return null;
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
          files: candidate.paths.map((path) => ({ path, lines: [] })),
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
        files: candidate.paths.map((path) => ({ path, lines: [] })),
      });
    }

    const parentResult = tryGitAt(cwd, ['rev-parse', '--verify', `${candidate.followUpSha}^`]);
    if (!parentResult.ok) {
      trace.method = 'blame';
      trace.unresolvedReason = 'missing-parent-history';
      return trace;
    }
    const parent = parentResult.stdout.trim();
    const diffResult = tryGitAt(cwd, [
      'diff',
      '--unified=0',
      '--find-renames',
      `${parent}`,
      candidate.followUpSha,
      '--',
      ...candidate.paths,
    ]);
    if (!diffResult.ok) {
      trace.method = 'blame';
      trace.unresolvedReason = 'shallow-or-unavailable-diff';
      return trace;
    }
    const rangesByPath = new Map();
    let blamePath = null;
    for (const line of diffResult.stdout.split('\n')) {
      const pathMatch = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      if (pathMatch) {
        blamePath = pathMatch[1] === '/dev/null' ? pathMatch[2] : pathMatch[1];
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
    if (rangesByPath.size === 0) {
      trace.method = 'blame';
      trace.unresolvedReason = 'no-blameable-lines';
      return trace;
    }
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
        if (!blame.ok) {
          trace.method = 'blame';
          trace.unresolvedReason = 'shallow-or-unavailable-blame';
          trace.evidence.files = files;
          return trace;
        }
        for (const line of blame.stdout.split('\n')) {
          const header = /^([0-9a-f]{40}) \d+ \d+(?: \d+)?$/.exec(line);
          if (header) shas.add(header[1]);
        }
        fileRanges.push({ start: range.start, end: range.end });
      }
      files.push({ path, lines: fileRanges });
    }
    trace.evidence.files = files;
    const unique = [...shas];
    if (unique.length === 0) {
      trace.method = 'blame';
      trace.unresolvedReason = 'shallow-or-unavailable-blame';
      return trace;
    }
    if (unique.length > 1) {
      trace.status = 'multiple-origin';
      trace.method = 'blame';
      trace.evidence.introducingCandidates = unique;
      return trace;
    }
    const introducingSha = unique[0];
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
      files,
    });
  });
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
      console.log(JSON.stringify(resolveTraces(candidates, { responder }), null, 2));
    } else {
      const candidateArgs = args[0] === 'candidates' ? args.slice(1) : args;
      if (
        candidateArgs.length !== 4 ||
        candidateArgs[0] !== '--since' ||
        candidateArgs[2] !== '--until'
      )
        throw new Error(
          'Usage: node scripts/escape-trace.mjs [candidates] --since UTC --until UTC (inclusive since, exclusive until; origin/main committer timestamps)',
        );
      console.log(
        JSON.stringify(
          collectCandidates({ since: candidateArgs[1], until: candidateArgs[3] }),
          null,
          2,
        ),
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
