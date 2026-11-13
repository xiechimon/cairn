import { readFileSync } from 'node:fs';
import type { MachineHeartbeatBody } from '@cairn/shared';
import { collectVisibleSkillFileMap, type SkillsCatalogOpts } from './backend/skills.js';
import { buildExecutorRecord, type ExecutorRecord } from './executor-record.js';

export interface StepExecutorInput {
  catalog: SkillsCatalogOpts | null;
  injectedNames: readonly string[] | undefined;
  backend: string;
  model: string;
  effort: string | null | undefined;
  systemPrompt: string | null | undefined;
  tools: readonly { name: string; description: string }[];
}

export function stepExecutorRecord(input: StepExecutorInput): ExecutorRecord {
  const skillFiles =
    input.catalog === null ? new Map<string, string>() : collectVisibleSkillFileMap(input.catalog);
  const { injectedNames } = input;
  const skills = [...skillFiles]
    .filter(([name]) => injectedNames === undefined || injectedNames.includes(name))
    .map(([name, path]) => ({ name, content: readFileSync(path, 'utf8') }));
  return buildExecutorRecord({
    backend: input.backend,
    model: input.model,
    effort: input.effort,
    harness: {
      systemPrompt: input.systemPrompt ?? '',
      skills,
      tools: input.tools.map(({ name, description }) => ({ name, description })),
    },
  });
}

export async function reportStepProvenance(input: {
  record: () => StepExecutorInput;
  provenance: MachineHeartbeatBody;
  baseSha: string | null;
  heartbeat: (provenance: MachineHeartbeatBody) => Promise<void>;
  log: (line: string) => void;
}): Promise<void> {
  try {
    const executorRecord = stepExecutorRecord(input.record());
    input.provenance.baseSha = input.baseSha;
    input.provenance.harnessHash = executorRecord.harness_sha;
    input.log(`executor record ${JSON.stringify(executorRecord)}`);
    await input.heartbeat(input.provenance);
  } catch (err: unknown) {
    input.log(
      `build provenance report failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
