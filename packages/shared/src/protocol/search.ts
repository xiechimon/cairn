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

export const searchMessageHitSchema = z.object({
  id: recordId,
  threadId: recordId,
  snippet: z.string(),
  projectId: recordId.nullable().optional(),
  projectName: z.string().nullable().optional(),
  createdAt: epochMs,
});
export type SearchMessageHit = z.infer<typeof searchMessageHitSchema>;

export const searchMemoryHitSchema = z.object({
  id: recordId,
  title: z.string(),
  snippet: z.string(),
  projectId: recordId.nullable().optional(),
  projectName: z.string().nullable().optional(),
  updatedAt: epochMs,
});
export type SearchMemoryHit = z.infer<typeof searchMemoryHitSchema>;

export const searchResponseSchema = z.object({
  todos: z.array(
    z.object({
      id: recordId,
      seqNum: z.number().int(),
      title: z.string(),
      phase: phaseSchema,
      phaseAt: epochMs,
      projectName: z.string(),
      archived: z.boolean().optional(),
    }),
  ),
  projects: z.array(
    z.object({
      id: recordId,
      name: z.string(),
      archived: z.boolean().optional(),
    }),
  ),
  messages: z.array(searchMessageHitSchema).optional(),
  memories: z.array(searchMemoryHitSchema).optional(),
  filters: z.array(searchFilterResultSchema).optional(),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;

export function searchNoResultsCopy(query: string): string {
  return `没有与“${query}”匹配的结果`;
}
