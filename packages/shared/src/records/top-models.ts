import { z } from 'zod';
import { thinkingLevelSchema } from '../agent-backend.js';
import { modelRefSchema } from './model-source.js';

export const topModelSchema = modelRefSchema.extend({
  provider: z.string().min(1),
  modelId: z.string().min(1),
  thinkingLevel: thinkingLevelSchema.nullable(),
});
export type TopModel = z.infer<typeof topModelSchema>;

export const topModelsSchema = z.array(topModelSchema).superRefine((models, ctx) => {
  const seen = new Set<string>();
  for (const [index, model] of models.entries()) {
    const key = JSON.stringify([model.provider, model.modelId]);
    if (seen.has(key)) {
      ctx.addIssue({ code: 'custom', path: [index], message: 'duplicate model' });
    }
    seen.add(key);
  }
});

export const putTopModelsBodySchema = z.object({ models: topModelsSchema });
export type PutTopModelsBody = z.infer<typeof putTopModelsBodySchema>;

export interface TopModelsEnvelope {
  models: TopModel[] | null;
}
