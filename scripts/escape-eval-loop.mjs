import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { collectCandidates, exportCases, resolveTraces, validateCases } from './escape-trace.mjs';
import { reportEscapes } from './review-escapes.mjs';

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function runEscapeEvalLoop({
  since,
  until,
  outDir,
  bankOut,
  cwd = process.cwd(),
  respondFile = null,
  allowNetwork = false,
}) {
  if (typeof outDir !== 'string' || !outDir) throw new Error('Expected --out directory');
  if (typeof bankOut !== 'string' || !bankOut) throw new Error('Expected --bank-out directory');
  mkdirSync(outDir, { recursive: true });
  mkdirSync(bankOut, { recursive: true });

  const candidates = collectCandidates({ since, until, cwd });
  writeJson(join(outDir, 'candidates.json'), candidates);

  let responder;
  if (respondFile) {
    responder = JSON.parse(readFileSync(respondFile, 'utf8'));
  } else if (allowNetwork) {
    responder = { pullsByCommit: {}, refs: {}, offline: false, allowNetwork: true };
  } else {
    responder = { pullsByCommit: {}, refs: {}, offline: true, allowNetwork: false };
  }
  const traces = resolveTraces(candidates, { cwd, responder });
  writeJson(join(outDir, 'traces.json'), traces);

  const weekly = reportEscapes(traces);
  writeJson(join(outDir, 'weekly-report.json'), weekly);
  const paths = ['ai-only', 'human-only', 'mixed', 'unknown'];
  const lines = ['Weekly review escapes (UTC Monday weeks)', ...weekly.limitations, ''];
  for (const week of weekly.weeks) {
    lines.push(week.week);
    for (const path of paths)
      lines.push(
        `  ${path}: ${week.paths[path].distinctPrs} PRs, ${week.paths[path].followUpEvents} follow-up events`,
      );
    lines.push(
      `  Unresolved attribution: ${week.unresolvedEvents}; unavailable review data: ${week.unavailableReviewEvents}`,
    );
  }
  lines.push(
    '',
    `Qualifying events: ${weekly.totals.qualifyingEvents}`,
    `Unknown review: ${weekly.totals.unknownReviewEvents}`,
    `Unresolved attribution: ${weekly.totals.unresolvedEvents}`,
    `Unavailable review data: ${weekly.totals.unavailableReviewEvents}`,
    `Outside 14 days: ${weekly.totals.outsideWindowEvents}`,
    `Duplicate events: ${weekly.totals.duplicateEvents}`,
    '',
    'Evidence',
  );
  for (const event of [...weekly.events, ...weekly.excluded]) {
    lines.push(
      `${event.originalPrUrl ?? 'Unresolved PR'} | ${event.followUpUrl ?? 'Unavailable follow-up'} | ${event.review?.path ?? event.reportStatus ?? event.exclusion}`,
      `  Attribution: ${event.method ?? 'unknown'} ${event.introducingUrl ?? ''} ${JSON.stringify(event.attributionEvidence)}`,
    );
    for (const evidence of event.review?.evidence ?? [])
      lines.push(
        `  ${evidence.reviewer} ${evidence.timestamp} ${evidence.headSha} ${evidence.url}${evidence.basisUrl ? ` basis: ${evidence.basisUrl}` : ''}`,
      );
    for (const error of event.review?.errors ?? [])
      lines.push(`  Unavailable: ${error.url} (${error.reason})`);
    if (event.review && !event.review.evidence.length)
      lines.push(`  Review sources: ${event.review.sources.join(' ')}`);
  }
  writeFileSync(join(outDir, 'weekly-report.txt'), `${lines.join('\n')}\n`);

  const exported = exportCases({ traces, outDir: bankOut, cwd });
  writeJson(join(outDir, 'export-report.json'), exported);
  const validation = validateCases(join(bankOut, 'cases'), { cwd });
  writeJson(join(outDir, 'validate-cases.json'), validation);
  if (!validation.ok) {
    const error = new Error(validation.errors.join('\n'));
    error.summary = {
      candidates: candidates.length,
      resolved: traces.filter((trace) => trace.status === 'resolved').length,
      exported: exported.exported.length,
      ineligible: exported.candidates.length,
      validation,
      weeklyTotals: weekly.totals,
    };
    throw error;
  }

  return {
    candidates: candidates.length,
    resolved: traces.filter((trace) => trace.status === 'resolved').length,
    exported: exported.exported.length,
    ineligible: exported.candidates.length,
    validation,
    weeklyTotals: weekly.totals,
    outDir,
    bankOut,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  try {
    const args = process.argv.slice(2);
    let since;
    let until;
    let outDir;
    let bankOut;
    let cwd = process.cwd();
    let respondFile = null;
    let allowNetwork = false;
    for (let index = 0; index < args.length; index++) {
      const flag = args[index];
      if (flag === '--since') since = args[++index];
      else if (flag === '--until') until = args[++index];
      else if (flag === '--out') outDir = args[++index];
      else if (flag === '--bank-out') bankOut = args[++index];
      else if (flag === '--cwd') cwd = args[++index];
      else if (flag === '--respond-file') respondFile = args[++index];
      else if (flag === '--allow-network') allowNetwork = true;
      else throw new Error(`Unknown argument: ${flag}`);
    }
    if (!since || !until || !outDir || !bankOut) {
      throw new Error(
        'Usage: node scripts/escape-eval-loop.mjs --since UTC --until UTC --out dir --bank-out dir [--cwd path] [--respond-file path] [--allow-network]',
      );
    }
    const summary = runEscapeEvalLoop({
      since,
      until,
      outDir: resolve(cwd, outDir),
      bankOut: resolve(cwd, bankOut),
      cwd: resolve(cwd),
      respondFile: respondFile ? resolve(cwd, respondFile) : null,
      allowNetwork,
    });
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    if (error.summary) console.log(JSON.stringify(error.summary, null, 2));
    console.error(error.message);
    process.exitCode = 1;
  }
}
