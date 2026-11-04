import { z } from 'zod';
import { recordId } from './common.js';

export const SKILL_ENTRY_FILE = 'SKILL.md';

export const SKILLS_DIR_DEFAULT = '~/.agents/skills';

export const MAX_SKILL_FILE_BYTES = 512_000;

export const MAX_SKILL_TOTAL_BYTES = 2_000_000;

export const skillRecordSchema = z.object({
  id: recordId,
  teamId: recordId,
  name: z.string(),
  description: z.string().nullable(),
});
export type SkillRecord = z.infer<typeof skillRecordSchema>;

export const skillFileBodySchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});
export type SkillFileBody = z.infer<typeof skillFileBodySchema>;

export const createSkillBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  files: z.array(skillFileBodySchema).min(1),
});
export type CreateSkillBody = z.infer<typeof createSkillBodySchema>;

export const updateSkillBodySchema = createSkillBodySchema;
export type UpdateSkillBody = CreateSkillBody;

export const updateSkillToolParamsSchema = updateSkillBodySchema.extend({
  skillId: z.string().min(1),
});
export type UpdateSkillToolParams = z.infer<typeof updateSkillToolParamsSchema>;

export const importSkillBodySchema = z
  .object({
    localPath: z.string().min(1).optional(),
    url: z.string().min(1).optional(),
  })
  .refine((b) => (b.localPath !== undefined) !== (b.url !== undefined), {
    message: 'invalid body: exactly one of localPath or url is required',
  });
export type ImportSkillBody = z.infer<typeof importSkillBodySchema>;

export const SKILL_DIR_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function parseSkillFrontmatter(content: string): {
  name?: string;
  description?: string;
} {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  const block = m?.[1];
  if (block === undefined) return {};
  const out: { name?: string; description?: string } = {};
  for (const line of block.split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    const key = kv?.[1];
    if (key !== 'name' && key !== 'description') continue;
    const value = (kv?.[2] ?? '')
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2')
      .trim();
    if (value !== '' && !/^[>|][+-]?$/.test(value)) out[key] = value;
  }
  return out;
}

export function splitSkillEntry(content: string): {
  name?: string;
  description?: string;
  body: string;
} {
  const m = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(content);
  if (m === null) return { body: content };
  return {
    ...parseSkillFrontmatter(content),
    body: content.slice(m[0].length).replace(/^(\r?\n)+/, ''),
  };
}

export function buildSkillEntry(name: string, description: string, body: string): string {
  const head = `---\nname: ${name}\ndescription: ${description}\n---\n`;
  const trimmed = body.trim();
  return trimmed === '' ? head : `${head}\n${trimmed}\n`;
}

export const SKILL_PAGE_COPY = {
  empty: '尚无技能。',
  directoryHint: '把包含 SKILL.md 的技能目录放进 {dir}，或新建一个技能，即会出现在这里。',
} as const;
