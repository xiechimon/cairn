import { z } from 'zod';

export const reviewSeveritySchema = z.enum(['blocking', 'suggestion', 'info']);
export type ReviewSeverity = z.infer<typeof reviewSeveritySchema>;

export const reviewFindingSchema = z.object({
  id: z.string(),
  severity: reviewSeveritySchema,
  summary: z.string(),
  description: z.string().optional(),
  file: z.string().optional(),
  line: z.coerce.number().int().positive().optional(),
  suggestion: z.string().optional(),
});
export type ReviewFinding = z.infer<typeof reviewFindingSchema>;

export const reviewVerdictSchema = z.object({
  conclusion: z.string(),
  gateLoosening: z.boolean().optional(),
  evalRulerChange: z.boolean().optional(),
  findings: z.array(reviewFindingSchema).default([]),
});
export type ReviewVerdict = z.infer<typeof reviewVerdictSchema>;

export const reviewGateSchema = z.enum(['confirm', 'review']);
export type ReviewGate = z.infer<typeof reviewGateSchema>;

export const reviewPromptMetaSchema = z.object({
  kind: z.literal('review'),
  agentId: z.string(),
  gate: reviewGateSchema.optional(),
  expectedHeadSha: z.string().optional(),
});
export type ReviewPromptMeta = z.infer<typeof reviewPromptMetaSchema>;

export function parseReviewPromptMeta(prompt: string | null): ReviewPromptMeta | null {
  if (prompt === null) return null;
  const newline = prompt.indexOf('\n');
  const head = (newline === -1 ? prompt : prompt.slice(0, newline)).trim();
  if (!head.startsWith('{')) return null;
  try {
    const parsed = reviewPromptMetaSchema.safeParse(JSON.parse(head));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function hasBlockingFinding(verdict: ReviewVerdict): boolean {
  return verdict.findings.some((f) => f.severity === 'blocking');
}
