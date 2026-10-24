import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const AGENT_BINARIES = new Set(['codex', 'pi', 'grok']);

export function mentionsTicket(text, ticket) {
  return new RegExp(`(?<!\\d)${ticket}(?!\\d)`).test(text ?? '');
}

export function findTicketConflicts({ ticket, selfCwd, selfPid, dirs, branches, prs, processes }) {
  const conflicts = [];
  const unchecked = [];
  const sources = [
    {
      source: 'workdir',
      items: dirs,
      hits: (items) =>
        items
          .filter((d) => d.path !== selfCwd && mentionsTicket(basename(d.path), ticket))
          .map((d) => `${d.path} (branch ${d.branch})`),
    },
    {
      source: 'remote-branch',
      items: branches,
      hits: (items) => items.filter((b) => mentionsTicket(b, ticket)),
    },
    {
      source: 'pr',
      items: prs,
      hits: (items) =>
        items
          .filter((pr) =>
            [pr.title, pr.headRefName, pr.body].some((t) => mentionsTicket(t, ticket)),
          )
          .map((pr) => `#${pr.number} ${pr.title} (${pr.headRefName})`),
    },
    {
      source: 'process',
      items: processes,
      hits: (items) => {
        const parentOf = new Map(items.map((p) => [p.pid, p.ppid]));
        const dispatchChain = new Set();
        for (let pid = selfPid; pid && !dispatchChain.has(pid); pid = parentOf.get(pid)) {
          dispatchChain.add(pid);
        }
        return items
          .filter(
            (p) =>
              !dispatchChain.has(p.pid) &&
              p.command
                .trim()
                .split(/\s+/)
                .slice(0, 2)
                .some((token) => AGENT_BINARIES.has(basename(token))) &&
              mentionsTicket(p.command, ticket),
          )
          .map((p) => `pid ${p.pid} ${p.command}`);
      },
    },
  ];
  for (const { source, items, hits } of sources) {
    if (items === null) {
      unchecked.push({ source });
      continue;
    }
    for (const detail of hits(items)) conflicts.push({ source, detail });
  }
  return { conflicts, unchecked };
}

function runQuiet(file, args, options = {}) {
  try {
    return execFileSync(file, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 20000,
      maxBuffer: 32 * 1024 * 1024,
      ...options,
    });
  } catch {
    return null;
  }
}

function realPathOrSelf(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

export function collectTicketSources(ticket, targetDir) {
  const dirs = new Map();
  for (const root of new Set([tmpdir(), '/tmp'])) {
    let names = [];
    try {
      names = readdirSync(root);
    } catch {}
    for (const name of names) {
      const path = realPathOrSelf(join(root, name));
      if (dirs.has(path) || !mentionsTicket(name, ticket) || !existsSync(join(path, '.git'))) {
        continue;
      }
      const branch = runQuiet('git', ['-C', path, 'branch', '--show-current'])?.trim();
      dirs.set(path, { path, branch: branch || 'unknown' });
    }
  }

  const lsRemote = runQuiet('git', ['ls-remote', '--heads', 'origin'], { cwd: targetDir });
  const branches =
    lsRemote === null
      ? null
      : lsRemote
          .split('\n')
          .map((line) => line.split('\t')[1]?.replace(/^refs\/heads\//, ''))
          .filter(Boolean);

  const prList = runQuiet('gh', [
    'pr',
    'list',
    '--repo',
    'xiechimon/cairn',
    '--search',
    ticket,
    '--state',
    'open',
    '--json',
    'number,title,headRefName,body',
  ]);
  let prs = null;
  try {
    prs = prList === null ? null : JSON.parse(prList);
  } catch {}

  const ps = runQuiet('ps', ['-axo', 'pid=,ppid=,command=']);
  const processes =
    ps === null
      ? null
      : ps
          .split('\n')
          .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
          .filter(Boolean)
          .map(([, pid, ppid, command]) => ({ pid: Number(pid), ppid: Number(ppid), command }));

  return {
    ticket,
    selfCwd: realPathOrSelf(targetDir),
    selfPid: process.pid,
    dirs: [...dirs.values()],
    branches,
    prs,
    processes,
  };
}
