import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { z } from 'astro/zod';
import { defineCollection } from 'astro:content';

const isoDateField = z
  .union([z.string(), z.date()])
  .transform((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v));

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
        geo: z
          .object({
            questionId: z.string(),
            template: z.enum(['hub', 'qa', 'how-to', 'compare', 'troubleshoot']),
            cluster: z.string(),
            sources: z.array(z.string()).min(1),
            verifiedVersion: z.string(),
            verifiedDate: isoDateField,
            competitorSources: z
              .array(
                z.object({
                  url: z.string().url(),
                  date: isoDateField,
                }),
              )
              .optional(),
          })
          .optional(),
      }),
    }),
  }),
};
