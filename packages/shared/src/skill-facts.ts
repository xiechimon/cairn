import { z } from 'zod';
import type { ToolCallRecord } from './agent-backend.js';

export const skillFactSchema = z.object({
  name: z.string().min(1),
  denied: z.boolean(),
});
export type SkillFact = z.infer<typeof skillFactSchema>;

const SKILL_FILE = 'SKILL.md';

function segmentsOf(path: string): string[] {
  return path.split(/[\\/]/);
}

function stringArg(args: unknown, key: string): string | null {
  if (args === null || typeof args !== 'object') return null;
  const v = (args as Record<string, unknown>)[key];
  return typeof v === 'string' && v !== '' ? v : null;
}

export function skillCallName(call: ToolCallRecord): string | null {
  const tool = call.name;
  if (tool === 'Skill') {
    const raw = stringArg(call.arguments, 'skill') ?? stringArg(call.arguments, 'command');
    if (raw === null) return null;
    const stripped = raw.startsWith('skill:') ? raw.slice('skill:'.length) : raw;
    return stripped === '' ? null : stripped;
  }
  if (tool !== 'Read' && tool !== 'read') return null;
  const path = stringArg(call.arguments, 'file_path') ?? stringArg(call.arguments, 'path');
  if (path === null) return null;
  const segs = segmentsOf(path);
  if (segs.at(-1) !== SKILL_FILE) return null;
  const parent = segs.at(-2);
  return parent === undefined || parent === '' ? null : parent;
}

export function classifySkillFact(call: ToolCallRecord): SkillFact | null {
  if (call.result === undefined) return null;
  const name = skillCallName(call);
  if (name === null) return null;
  return { name, denied: call.isError === true };
}
