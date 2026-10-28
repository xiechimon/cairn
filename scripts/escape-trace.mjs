import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REVIEWER_INPUT_FORBIDDEN = new Set([
  'defect',
  'location',
  'correction',
  'labels',
  'answer',
  'knownCorrection',
]);

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

function expandSha(cwd, sha) {
  if (!sha || typeof sha !== 'string') return null;
  const result = tryGitAt(cwd, ['rev-parse', '--verify', `${sha}^{commit}`]);
  if (!result.ok) return null;
  return result.stdout.trim();
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
      if (currentSha !== introducingSha)
        return { ok: false, reason: 'blame-not-introducing' };
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
    if (origLines[index] !== expected) return { ok: false, reason: 'noncontiguous-introducing-lines' };
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
  if (trace.status === 'unresolved')
    return `unresolved:${trace.unresolvedReason ?? 'unspecified'}`;
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
    readFileSync(resolve(import.meta.dirname, '../integration/eval/review/case.schema.json'), 'utf8'),
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
    const typeOk =
      schema.type === actual || (schema.type === 'number' && actual === 'integer');
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
    value.forEach((item, index) =>
      errors.push(...validateAgainstSchema(item, schema.items, `${path}[${index}]`)),
    );
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
  const fixingPatch = gitAt(cwd, [
    'diff',
    `${fixingSha}^`,
    fixingSha,
    '--',
    location.path,
  ]);
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
  if (
    defect.startLine !== location.startLine ||
    defect.endLine !== location.endLine
  )
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
        correction: fixingPatch.trim()
          ? `${fixingSubject}\n\n${fixingPatch}`
          : fixingSubject,
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
  candidates.sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b)),
  );
  exported.sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(join(outDir, 'candidates.json'), stableStringify(candidates));
  return { exported, candidates };
}

function validateBankCase(bankCase, { cwd, schema }) {
  const errors = validateAgainstSchema(bankCase, schema);
  for (const key of Object.keys(bankCase.reviewerInput ?? {})) {
    if (REVIEWER_INPUT_FORBIDDEN.has(key))
      errors.push(`reviewerInput must not contain ${key}`);
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
    const blob = tryGitAt(cwd, [
      'show',
      `${introducingSha}:${bankCase.answer.defect.path}`,
    ]);
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
    throw new Error(
      'Usage: node scripts/escape-trace.mjs validate-cases <cases-dir> [--cwd path]',
    );
  }
  if (!casesDir)
    throw new Error(
      'Usage: node scripts/escape-trace.mjs validate-cases <cases-dir> [--cwd path]',
    );
  return { casesDir, cwd };
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  try {
    const args = process.argv.slice(2);
    if (args[0] === 'export-cases') {
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
      if (args.length !== 4 || args[0] !== '--since' || args[2] !== '--until')
        throw new Error(
          'Usage: node scripts/escape-trace.mjs --since UTC --until UTC (inclusive since, exclusive until; origin/main committer timestamps)\n       node scripts/escape-trace.mjs export-cases --traces path --out dir\n       node scripts/escape-trace.mjs validate-cases <cases-dir>',
        );
      printJson(collectCandidates({ since: args[1], until: args[3] }));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
