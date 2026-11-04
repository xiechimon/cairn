import { z } from 'zod';
import { epochMs, phaseSchema, recordId } from '../records/common.js';
import { SEARCH_FILTER_KEYS } from '../search-syntax.js';

export const SEARCH_FILTER_PROBLEMS = [
  'empty',
  'unknown_state',
  'bad_pr',
  'bad_date',
  'bad_cost',
  'unknown_project',
  'unknown_person',
] as const;

export const searchFilterResultSchema = z.object({
  key: z.enum(SEARCH_FILTER_KEYS),
  raw: z.string(),
  value: z.string(),
  negated: z.boolean(),
  valid: z.boolean(),
  reason: z.enum(SEARCH_FILTER_PROBLEMS).optional(),
});
export type SearchFilterResult = z.infer<typeof searchFilterResultSchema>;

export const searchResponseSchema = z.object({
  todos: z.array(
    z.object({
      id: recordId,
      seqNum: z.number().int(),
      title: z.string(),
      phase: phaseSchema,
      phaseAt: epochMs,
      projectName: z.string(),
    }),
  ),
  projects: z.array(z.object({ id: recordId, name: z.string() })),
  agents: z.array(z.object({ id: recordId, displayName: z.string() })),
  filters: z.array(searchFilterResultSchema).optional(),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;

export const SEARCH_PLACEHOLDER = '搜索任务、项目、成员…';

export const SEARCH_GOTO_GROUP = [
  '看板',
  '定时',
  '团队',
  '技能',
  'MCP',
  '密钥',
  '机器',
  '模型服务',
  '帐号',
  'API 密钥',
] as const;

export function searchNoResultsCopy(query: string): string {
  return `没有与“${query}”匹配的结果`;
}
