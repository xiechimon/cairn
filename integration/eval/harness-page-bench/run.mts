// Skeleton: harness page benchmark runner.
// Drives one question through one harness and collects a PageRun.
// Full harness drivers (pacman, Claude Code CLI, bare pi) land after #1511-#1514.

import { machineScore } from './grade.mts';

export interface RunOptions {
  question: string;
  harness: 'pacman' | 'claude-code-cli' | 'bare-pi';
  model: string;
  runs: number;
}

export async function runOne(_opts: RunOptions): Promise<void> {
  console.log('harness page benchmark: not implemented yet', _opts);
}

export { machineScore };
