import { z } from 'zod';

const TARGET_PREFIX = 'Hosted merge target: ';
const targetSchema = z
  .object({
    projectId: z.string().min(1),
    repoName: z.string().min(1),
    baseBranch: z.string().min(1),
    configuredBaseBranch: z.string().nullable(),
  })
  .strict();

export function buildHostedMergeInstruction(target: z.infer<typeof targetSchema>): string {
  return `Merge the conversation branch into the pinned base branch ${JSON.stringify(target.baseBranch)}. Do not change the merge target.\n${TARGET_PREFIX}${JSON.stringify(target)}`;
}

export function parseHostedMergeInstruction(
  prompt: string | null,
): z.infer<typeof targetSchema> | null {
  const line = prompt?.split('\n').find((value) => value.startsWith(TARGET_PREFIX));
  if (line === undefined) return null;
  try {
    const result = targetSchema.safeParse(JSON.parse(line.slice(TARGET_PREFIX.length)));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
