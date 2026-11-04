import { z } from 'zod';

export const ORB_SERVICE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

export const ORB_SERVICE_RESERVED_ENV = ['PORT', 'PUBLIC_URL', 'AMP_THREAD_ID'] as const;

const orbServiceNameSchema = z.string().regex(ORB_SERVICE_NAME_RE);

const orbPortalLinkSchema = z
  .object({
    url: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    description: z.string().optional(),
  })
  .strict();

const orbExtraPortalSchema = z
  .object({
    url: z.string().min(1),
    title: z.string().min(1),
    description: z.string().optional(),
  })
  .strict();

const orbServiceEnvSchema = z
  .record(z.string(), z.string())
  .refine((env) => ORB_SERVICE_RESERVED_ENV.every((key) => env[key] === undefined), {
    message: 'env must not set PORT, PUBLIC_URL, or AMP_THREAD_ID',
  });

export const orbServiceSchema = z
  .object({
    command: z.string().min(1),
    cwd: z.string().min(1).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    env: orbServiceEnvSchema.optional(),
    health: z.string().regex(/^\/.*/).optional(),
    portal: z.union([z.literal(true), orbPortalLinkSchema]).optional(),
    portals: z.array(orbExtraPortalSchema).optional(),
    review: z.boolean().optional(),
    platforms: z
      .array(z.enum(['linux', 'darwin']))
      .min(1)
      .optional(),
  })
  .strict();
export type OrbService = z.infer<typeof orbServiceSchema>;

export const orbServicesFileSchema = z
  .object({
    services: z
      .record(orbServiceNameSchema, orbServiceSchema)
      .refine((services) => Object.keys(services).length > 0, {
        message: 'services must not be empty',
      }),
  })
  .strict();
export type OrbServicesFile = z.infer<typeof orbServicesFileSchema>;
