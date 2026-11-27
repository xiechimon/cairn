import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { z } from 'astro/zod';
import { defineCollection } from 'astro:content';

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
            verifiedDate: z.string(),
            competitorSources: z
              .array(
                z.object({
                  url: z.string().url(),
                  date: z.string(),
                }),
              )
              .optional(),
          })
          .optional(),
      }),
    }),
  }),
};
