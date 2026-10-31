import type { TraceStep } from '../components/chat/trace-steps.js';

export type TranscriptStep = TraceStep;

export const SEED_TRANSCRIPT: TraceStep[] = [
  {
    kind: 'think',
    text: 'CI fails at the frozen install, so the lockfile and package.json disagree. Check the last commit first.',
    secs: 3,
  },
  { kind: 'search', query: 'ERR_PNPM_OUTDATED_LOCKFILE', hits: 2, secs: 1 },
  { kind: 'read', path: 'package.json', lines: 64, secs: 1 },
  {
    kind: 'say',
    text: 'The last commit bumped vitest in package.json without updating pnpm-lock.yaml.',
  },
  {
    kind: 'run',
    command: 'pnpm install --frozen-lockfile',
    exit: 1,
    output: [
      'ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with "frozen-lockfile"',
      'specifiers in the lockfile do not match package.json',
    ],
    secs: 4,
  },
  {
    kind: 'run',
    command: 'pnpm install',
    exit: 0,
    output: ['Lockfile is up to date, resolution step is skipped', 'Done in 11.2s'],
    secs: 12,
  },
  { kind: 'edit', path: 'pnpm-lock.yaml', added: 18, removed: 6, secs: 1 },
  { kind: 'push', branch: 'fix/lockfile', commit: '3f2a91c', secs: 3 },
  { kind: 'check', label: 'CI passed on 3f2a91c', ok: true },
];
