import { COMPLETION_CAP, type CompletionRange, type CompletionTriggerSpec } from './completion.js';

export const SLASH_COMPLETION_SPEC: CompletionTriggerSpec = {
  trigger: '/',
  tokenClass: '\\p{L}\\p{N}\\p{M}_.()[\\]~:-',
};

export function slashFilter<T>(
  query: string,
  items: readonly T[],
  labelOf: (item: T) => string,
  cap: number = COMPLETION_CAP,
): T[] {
  if (query === '') return items.slice(0, cap);
  const q = query.toLowerCase();
  return items
    .filter((item) => {
      const words = labelOf(item).split(/[:_-]/);
      if (words.some((w) => w.toLowerCase().startsWith(q))) return true;
      return words.join('').toLowerCase().startsWith(q);
    })
    .slice(0, cap);
}

export type SlashRowKind = 'insert' | 'execute';

export type BuiltinSlashName = 'clear' | 'attach' | 'mention' | 'review' | 'stop' | 'help';

export interface BuiltinSlashDef {
  name: BuiltinSlashName;
  aliases: string[];
  descKey: string;
  kind: 'execute';
}

export const BUILTIN_SLASH_COMMANDS: BuiltinSlashDef[] = [
  { name: 'clear', aliases: ['new'], descKey: '清空输入', kind: 'execute' },
  { name: 'attach', aliases: [], descKey: '添加附件', kind: 'execute' },
  { name: 'mention', aliases: ['at'], descKey: '打开提及面板', kind: 'execute' },
  { name: 'review', aliases: [], descKey: '发起 AI 审核', kind: 'execute' },
  { name: 'stop', aliases: ['cancel'], descKey: '停止当前运行', kind: 'execute' },
  { name: 'help', aliases: [], descKey: '查看命令说明', kind: 'execute' },
];

export interface SkillEntry {
  id: string;
  name: string;
  description?: string;
}

export interface AvailableSlash {
  review: boolean;
  stop: boolean;
}

export interface SlashRow {
  name: string;
  kind: SlashRowKind;
  builtin?: BuiltinSlashName;
  descKey?: string;
  skillId?: string;
  description?: string;
}

export interface SlashSection {
  section: 'builtin' | 'skill';
  rows: SlashRow[];
}

export interface BuildSlashSectionsOptions {
  query: string;
  available: AvailableSlash;
  skills: readonly SkillEntry[];
  cap?: number;
}

export function buildSlashSections({
  query,
  available,
  skills,
  cap = COMPLETION_CAP,
}: BuildSlashSectionsOptions): SlashSection[] {
  const q = query.toLowerCase();
  const matches = (names: string[]): boolean => {
    if (q === '') return true;
    return names.some((n) => {
      const words = n.split(/[:_-]/);
      if (words.some((w) => w.toLowerCase().startsWith(q))) return true;
      return words.join('').toLowerCase().startsWith(q);
    });
  };
  const builtinNames = new Set(BUILTIN_SLASH_COMMANDS.map((c) => c.name.toLowerCase()));
  const builtinRows: SlashRow[] = [];
  for (const def of BUILTIN_SLASH_COMMANDS) {
    if (def.name === 'review' && !available.review) continue;
    if (def.name === 'stop' && !available.stop) continue;
    if (!matches([def.name, ...def.aliases])) continue;
    builtinRows.push({ name: def.name, kind: 'execute', builtin: def.name, descKey: def.descKey });
    if (builtinRows.length >= cap) break;
  }
  const skillRows: SlashRow[] = [];
  const room = cap - builtinRows.length;
  if (room > 0) {
    for (const skill of skills) {
      if (builtinNames.has(skill.name.toLowerCase())) continue;
      if (!matches([skill.name])) continue;
      skillRows.push({
        name: skill.name,
        kind: 'insert',
        skillId: skill.id,
        ...(skill.description != null ? { description: skill.description } : {}),
      });
      if (skillRows.length >= room) break;
    }
  }
  const sections: SlashSection[] = [];
  if (builtinRows.length > 0) sections.push({ section: 'builtin', rows: builtinRows });
  if (skillRows.length > 0) sections.push({ section: 'skill', rows: skillRows });
  return sections;
}

export function isMessageStart(value: string, rangeStart: number): boolean {
  return value.slice(0, rangeStart).trim() === '';
}

export type SlashAcceptVia = 'enter' | 'tab';
export type SlashAcceptAction = 'run' | 'insert-token' | 'insert-text';

export function resolveSlashAccept({
  kind,
  atStart,
  via,
}: {
  name: string;
  kind: SlashRowKind;
  atStart: boolean;
  via: SlashAcceptVia;
}): SlashAcceptAction {
  if (via === 'enter' && atStart && kind === 'execute') return 'run';
  if (kind === 'insert') return 'insert-token';
  return 'insert-text';
}

export function insertSlashText(
  value: string,
  range: CompletionRange,
  name: string,
): { value: string; caret: number } {
  const piece = `/${name} `;
  const next = value.slice(0, range.start) + piece + value.slice(range.end);
  return { value: next, caret: range.start + piece.length };
}
