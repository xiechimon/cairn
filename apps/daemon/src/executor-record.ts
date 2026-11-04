import { computeHarnessHash, type HarnessMaterial } from './harness-hash.js';

export interface ExecutorRecord {
  backend: string;
  model: string;
  harness_sha: string;
  effort: string | null;
}

export function buildExecutorRecord(input: {
  backend: string;
  model: string;
  effort?: string | null | undefined;
  harness: HarnessMaterial;
}): ExecutorRecord {
  return {
    backend: input.backend,
    model: input.model,
    harness_sha: computeHarnessHash(input.harness),
    effort: input.effort || null,
  };
}
