import { createHash } from 'node:crypto';

export function computeHarnessHash(material: {
  systemPrompt: string;
  skills: { name: string; content: string }[];
  tools: { name: string; description: string }[];
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        systemPrompt: material.systemPrompt,
        skills: [...material.skills].sort((a, b) => a.name.localeCompare(b.name)),
        tools: [...material.tools].sort((a, b) => a.name.localeCompare(b.name)),
      }),
    )
    .digest('hex');
}
