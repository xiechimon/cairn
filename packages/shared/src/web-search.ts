import { z } from 'zod';

export const WEB_SEARCH_TOOL_NAME = 'web_search';
export const WEB_FETCH_TOOL_NAME = 'web_fetch';
export const WEB_EXA_KEY_SECRET = 'EXA_API_KEY';
export const WEB_BRAVE_KEY_SECRET = 'BRAVE_SEARCH_API_KEY';
export const WEB_SEARCH_BUDGET_EXHAUSTED = 'search budget exhausted';

export const webProviderSchema = z.enum(['exa', 'brave', 'plain']);
export type WebProvider = z.infer<typeof webProviderSchema>;

export const webResultSchema = z.object({
  url: z.string(),
  title: z.string(),
  text: z.string(),
  fetchedAt: z.string(),
});
export type WebResult = z.infer<typeof webResultSchema>;

export const webToolOutputSchema = z.object({
  provider: webProviderSchema,
  results: z.array(webResultSchema),
  truncated: z.boolean(),
});
export type WebToolOutput = z.infer<typeof webToolOutputSchema>;
