#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const WORKFLOWS = join(ROOT, '.github/workflows');
const NODE_FILE = /\.(?:mjs|cjs|js|mts|cts|ts)$/;
const PACKAGE_MANAGERS = new Set(['pnpm', 'npm', 'yarn', 'bun']);
const BUILTINS = new Set(builtinModules);
const SIDE_EFFECT_IMPORT = /^[ \t]*import[ \t]*['"]([^'"]+)['"]/gm;
const FROM_IMPORT = /^[ \t]*import[ \t][^'";]*?from[ \t]*['"]([^'"]+)['"]/gm;
const RE_EXPORT = /^[ \t]*export[ \t][^'";]*?from[ \t]*['"]([^'"]+)['"]/gm;

function isNodeFileToken(token) {
  return typeof token === 'string' && NODE_FILE.test(token) && !token.includes('$');
}

export function preinstallNodeFiles(text) {
  const jobs = new Map();
  let inJobs = false;
  let job = null;
  let step = null;
  let inRunBlock = false;
  for (const line of text.split('\n')) {
    if (!inJobs) {
      if (/^jobs:\s*$/.test(line)) inJobs = true;
      continue;
    }
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const jobKey = line.match(/^ {2}([^\s:#][^:]*):\s*$/);
    if (jobKey) {
      job = jobKey[1];
      jobs.set(job, []);
      step = null;
      inRunBlock = false;
      continue;
    }
    if (/^ {6}- /.test(line)) {
      step = { name: '', run: [] };
      if (job) jobs.get(job).push(step);
      inRunBlock = false;
      const inlineRun = line.match(/^ {6}- run: (.*)$/);
      if (inlineRun) step.run.push(inlineRun[1].trim());
      const name = line.match(/^ {6}- name: (.*)$/);
      if (name) step.name = name[1].trim();
      continue;
    }
    if (!step) continue;
    if (/^ {8}run: \|\s*$/.test(line)) {
      inRunBlock = true;
      continue;
    }
    const inlineRun = line.match(/^ {8}run: (.*)$/);
    if (inlineRun) {
      step.run.push(inlineRun[1].trim());
      inRunBlock = false;
      continue;
    }
    if (inRunBlock) {
      if (/^ {10}\S/.test(line)) step.run.push(line.trim());
      else if (/\S/.test(line)) inRunBlock = false;
    }
  }
  const invocations = [];
  for (const [jobName, steps] of jobs) {
    for (const currentStep of steps) {
      const runTokens = currentStep.run.map((line) => line.trim().split(/\s+/));
      if (
        runTokens.some(
          (tokens) =>
            PACKAGE_MANAGERS.has(tokens[0]) && /^(?:install|ci|add)(?:\s|$)/.test(tokens[1] ?? ''),
        )
      )
        break;
      for (const tokens of runTokens) {
        if (tokens[0] !== 'node') continue;
        const files =
          tokens[1] === '--test'
            ? tokens.slice(2).filter(isNodeFileToken)
            : isNodeFileToken(tokens[1])
              ? [tokens[1]]
              : [];
        for (const file of files)
          invocations.push({
            job: jobName,
            step: currentStep.name || currentStep.run[0] || 'unnamed step',
            file,
          });
      }
    }
  }
  return invocations;
}

export function depViolations(entries, root = ROOT) {
  const violations = [];
  const queue = [];
  for (const entry of entries) {
    const importer = resolve(root, entry.file);
    if (!existsSync(importer)) {
      violations.push({ ...entry, message: `${entry.file} does not exist` });
      continue;
    }
    queue.push({ ...entry, importer });
  }
  const seen = new Set();
  while (queue.length > 0) {
    const current = queue.shift();
    if (seen.has(current.importer)) continue;
    seen.add(current.importer);
    let text;
    try {
      text = readFileSync(current.importer, 'utf8');
    } catch {
      continue;
    }
    for (const pattern of [SIDE_EFFECT_IMPORT, FROM_IMPORT, RE_EXPORT]) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        const specifier = match[1];
        if (specifier.startsWith('node:') || BUILTINS.has(specifier)) continue;
        if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
          violations.push({
            ...current,
            importer: relative(root, current.importer) || current.importer,
            message: `${relative(root, current.importer) || current.importer} imports package '${specifier}'`,
          });
          continue;
        }
        const target = specifier.startsWith('/')
          ? join(root, specifier)
          : resolve(dirname(current.importer), specifier);
        if (!existsSync(target)) {
          violations.push({
            ...current,
            importer: relative(root, current.importer) || current.importer,
            message: `${relative(root, current.importer) || current.importer} imports missing file '${specifier}'`,
          });
          continue;
        }
        queue.push({ ...current, importer: target });
      }
    }
  }
  return violations;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const entries = [];
  for (const name of readdirSync(WORKFLOWS)
    .filter((file) => /\.ya?ml$/.test(file))
    .sort()) {
    const text = readFileSync(join(WORKFLOWS, name), 'utf8');
    entries.push(...preinstallNodeFiles(text).map((entry) => ({ ...entry, workflow: name })));
  }
  if (entries.length === 0) {
    console.error(
      '[preinstall-deps-gate] no node invocations before an install step; the workflows have moved',
    );
    process.exit(2);
  }
  const violations = depViolations(entries);
  if (violations.length > 0) {
    console.error(
      `[preinstall-deps-gate] ${violations.length} pre-install import(s) need node_modules:`,
    );
    for (const violation of violations)
      console.error(
        `  ${violation.workflow} job "${violation.job}" (${violation.step}) runs ${violation.file}: ${violation.message}`,
      );
    process.exit(1);
  }
  console.log(`[preinstall-deps-gate] PASS (${entries.length} pre-install node files)`);
}
