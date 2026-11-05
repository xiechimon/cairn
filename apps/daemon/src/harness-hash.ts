import { createHash } from 'node:crypto';

export interface HarnessMaterial {
  systemPrompt: string;
  skills: { name: string; content: string }[];
  tools: { name: string; description: string }[];
}

function byNameCodeUnits(a: { name: string }, b: { name: string }): number {
  if (a.name < b.name) return -1;
  return a.name > b.name ? 1 : 0;
}

export function computeHarnessHash(material: HarnessMaterial): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        systemPrompt: material.systemPrompt,
        skills: [...material.skills].sort(byNameCodeUnits),
        tools: [...material.tools].sort(byNameCodeUnits),
      }),
    )
    .digest('hex');
}
