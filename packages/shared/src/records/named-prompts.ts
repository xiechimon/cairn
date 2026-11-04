import { z } from 'zod';
import { CONTINUE_PROMPTS } from './prompts.js';
import { REVIEW_GATE_HEAD } from './review.js';

export const NAMED_PROMPT_IDS = ['ship', 'review'] as const;
export const namedPromptIdSchema = z.enum(NAMED_PROMPT_IDS);
export type NamedPromptId = z.infer<typeof namedPromptIdSchema>;

export const NAMED_PROMPT_MAX_CHARS = 20_000;

export const DEFAULT_NAMED_PROMPTS: Record<NamedPromptId, { title: string; text: string }> = {
  ship: { title: 'Ship', text: CONTINUE_PROMPTS.merge },
  review: { title: 'Review', text: REVIEW_GATE_HEAD },
};

export const namedPromptOverridesSchema = z.partialRecord(
  namedPromptIdSchema,
  z.string().min(1).max(NAMED_PROMPT_MAX_CHARS),
);
export type NamedPromptOverrides = z.infer<typeof namedPromptOverridesSchema>;

export const namedPromptRecordSchema = z.object({
  id: namedPromptIdSchema,
  title: z.string(),
  defaultText: z.string(),
  text: z.string(),
  overridden: z.boolean(),
});
export type NamedPromptRecord = z.infer<typeof namedPromptRecordSchema>;

export const putNamedPromptBodySchema = z
  .object({
    text: z
      .string()
      .max(NAMED_PROMPT_MAX_CHARS)
      .refine((value) => value.trim() !== '', 'text must not be blank'),
  })
  .strict();
export type PutNamedPromptBody = z.infer<typeof putNamedPromptBodySchema>;

export const SHIP_ROUTES = ['merge-gate', 'local-merge', 'custom'] as const;
export const shipRouteSchema = z.enum(SHIP_ROUTES);
export type ShipRoute = z.infer<typeof shipRouteSchema>;
export const DEFAULT_SHIP_ROUTE: ShipRoute = 'merge-gate';

export const shipRouteRecordSchema = z.object({ shipRoute: shipRouteSchema });
export type ShipRouteRecord = z.infer<typeof shipRouteRecordSchema>;
export const putShipRouteBodySchema = shipRouteRecordSchema.strict();
export type PutShipRouteBody = z.infer<typeof putShipRouteBodySchema>;
