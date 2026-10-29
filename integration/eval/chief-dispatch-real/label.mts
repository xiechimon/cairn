import type { ExportedDispatchCase, LabeledDispatchCase } from './types.mts';

export interface Labeler {
  vendor: string;
  label: (input: { prompt: string; options: string[] }) => Promise<string>;
}

function rosterFromCase(input: ExportedDispatchCase): LabeledDispatchCase['roster'] {
  const seen = new Map<string, LabeledDispatchCase['roster'][number]>();
  for (const project of input.projectsSnapshot) {
    for (const agent of project.agents) {
      if (seen.has(agent.key)) continue;
      seen.set(agent.key, {
        key: agent.key,
        displayName: agent.displayName,
        modelId: 'eval-label',
        description: agent.description,
      });
    }
  }
  return [...seen.values()];
}

function optionsOf(input: ExportedDispatchCase): string[] {
  return rosterFromCase(input).map((a) => a.key);
}

export async function labelDispatchCases(
  cases: ExportedDispatchCase[],
  labelers: [Labeler, Labeler],
): Promise<LabeledDispatchCase[]> {
  const [a, b] = labelers;
  if (a.vendor.trim() === '' || b.vendor.trim() === '') {
    throw new Error('labelers must declare a non-empty vendor');
  }
  if (a.vendor.toLowerCase() === b.vendor.toLowerCase()) {
    throw new Error('two labelers from the same vendor are refused; use different vendors');
  }
  const kept: LabeledDispatchCase[] = [];
  for (const input of cases) {
    const options = optionsOf(input);
    const payload = { prompt: input.prompt, options };
    const [left, right] = await Promise.all([a.label(payload), b.label(payload)]);
    if (left === 'unclear' || right === 'unclear') continue;
    if (left !== right) continue;
    if (!options.includes(left)) continue;
    kept.push({
      id: input.caseId,
      tags: ['dispatch', 'real', input.outcome, left],
      prompt: input.prompt,
      expect: { kind: 'dispatch', agent: left },
      roster: rosterFromCase(input),
    });
  }
  return kept;
}
