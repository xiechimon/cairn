import { readFileSync } from 'node:fs';
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
