#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PACKAGE_ORDER = [
  '@cairn/shared',
  '@xiechimon/cairn',
  '@cairn/web',
  '@xiechimon/cairn-cli',
  '@cairn/desktop',
  '@cairn/integration',
];
const ALL_PACKAGES = new Set(PACKAGE_ORDER);
const PACKAGE_SCOPES = [
  ['packages/shared/', new Set(PACKAGE_ORDER)],
  ['apps/server/', new Set(['@xiechimon/cairn', '@cairn/integration'])],
  ['apps/web/', new Set(['@cairn/web'])],
  ['apps/daemon/', new Set(['@xiechimon/cairn-cli', '@cairn/integration'])],
  ['apps/desktop/', new Set(['@cairn/desktop'])],
  ['integration/', new Set(['@cairn/integration'])],
];
const ROOT_WIDE_INPUTS = new Set(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']);

export function typecheckPackagesForPaths(paths) {
  const selected = new Set();
  for (const path of paths) {
    if (ROOT_WIDE_INPUTS.has(path)) {
      for (const name of ALL_PACKAGES) selected.add(name);
      continue;
    }
    for (const [prefix, packages] of PACKAGE_SCOPES) {
      if (!path.startsWith(prefix)) continue;
      for (const name of packages) selected.add(name);
      break;
    }
  }
  return PACKAGE_ORDER.filter((name) => selected.has(name));
}

export function fastGatePlan(paths) {
  return [
    ['pnpm', 'lint'],
    ...typecheckPackagesForPaths(paths).map((name) => ['pnpm', '--filter', name, 'typecheck']),
    ['pnpm', 'test:changed'],
  ];
}

export function parseGateWrapper(wrapper = '') {
  return wrapper.trim().split(/\s+/).filter(Boolean);
}

function shellQuote(arg) {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

export function fastGateShellCommand(plan) {
  return plan.map((step) => step.map(shellQuote).join(' ')).join(' && ');
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

export function committedPaths(cwd) {
  const base = git(['merge-base', 'origin/main', 'HEAD'], cwd);
  return git(['diff', '--no-renames', '--name-only', base, 'HEAD'], cwd)
    .split('\n')
    .filter(Boolean);
}

export function exactTreeError(cwd) {
  const status = git(['status', '--porcelain'], cwd);
  if (status === '') return null;
  return 'the worktree does not exactly match HEAD; commit or remove the uncommitted files so the gate tests the tree that preflight pushes';
}

export function runFastGate({
  cwd,
  wrapper = process.env.CAIRN_PREFLIGHT_GATE_WRAPPER ?? '',
  spawn = spawnSync,
  log = console.log,
  checkTree = exactTreeError,
  listPaths = committedPaths,
}) {
  const dirty = checkTree(cwd);
  if (dirty !== null) return { ok: false, error: dirty };
  const plan = fastGatePlan(listPaths(cwd));
  const wrapperTokens = parseGateWrapper(wrapper);
  if (wrapperTokens.length > 0) {
    const [wrapperCommand, ...wrapperArgs] = wrapperTokens;
    const shellCommand = fastGateShellCommand(plan);
    const args = [...wrapperArgs, 'sh', '-c', shellCommand];
    log(`[preflight-fast-gate] ${wrapperCommand} ${args.join(' ')}`);
    const result = spawn(wrapperCommand, args, { cwd, stdio: 'inherit' });
    if (result.status !== 0) {
      return {
        ok: false,
        error: `${wrapperCommand} failed on the exact HEAD tree; fix it before preflight pushes`,
        status: result.status ?? 1,
      };
    }
    return { ok: true, plan, wrapped: true };
  }
  for (const [command, ...args] of plan) {
    log(`[preflight-fast-gate] ${command} ${args.join(' ')}`);
    const result = spawn(command, args, { cwd, stdio: 'inherit' });
    if (result.status !== 0) {
      return {
        ok: false,
        error: `${command} ${args.join(' ')} failed on the exact HEAD tree; fix it before preflight pushes`,
        status: result.status ?? 1,
      };
    }
  }
  return { ok: true, plan, wrapped: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = runFastGate({ cwd: process.cwd() });
  if (!result.ok) {
    console.error(`[preflight-fast-gate] ${result.error}`);
    process.exit(result.status ?? 1);
  }
  console.log('[preflight-fast-gate] PASS');
}
