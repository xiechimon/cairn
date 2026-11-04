import { z } from 'zod';

export const ORB_SERVICE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

export const ORB_SERVICE_RESERVED_ENV = ['PORT', 'PUBLIC_URL', 'AMP_THREAD_ID'] as const;

const orbServiceNameSchema = z.string().regex(ORB_SERVICE_NAME_RE);

export function isOrbPortalUrl(value: string): boolean {
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0;
  } catch {
    return false;
  }
}

const orbPortalUrlSchema = z.string().min(1).refine(isOrbPortalUrl, {
  message: 'portal url must be a path starting with / or an http(s) URL',
});

export function isOrbRepoRelativeCwd(value: string): boolean {
  if (
    value.length === 0 ||
    value.startsWith('/') ||
    value.startsWith('\\') ||
    /^[A-Za-z]:/.test(value)
  ) {
    return false;
  }
  let depth = 0;
  for (const part of value.replaceAll('\\', '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      depth -= 1;
      if (depth < 0) return false;
      continue;
    }
    depth += 1;
  }
  return true;
}

const orbServiceCwdSchema = z.string().min(1).refine(isOrbRepoRelativeCwd, {
  message: 'cwd must be a repository-relative path',
});

const orbPortalLinkSchema = z
  .object({
    url: orbPortalUrlSchema.optional(),
    title: z.string().min(1).optional(),
    description: z.string().optional(),
  })
  .strict();

const orbExtraPortalSchema = z
  .object({
    url: orbPortalUrlSchema,
    title: z.string().min(1),
    description: z.string().optional(),
  })
  .strict();

const orbPortalFolderSchema = z
  .object({
    folder: z.string().min(1),
    links: z.array(orbExtraPortalSchema).min(1),
  })
  .strict();

const orbPortalsSchema = z.array(z.union([orbExtraPortalSchema, orbPortalFolderSchema])).refine(
  (entries) => {
    const folders = entries.flatMap((entry) => ('folder' in entry ? [entry.folder] : []));
    return new Set(folders).size === folders.length;
  },
  { message: 'portal folder names must be unique within a service' },
);

const orbServiceEnvSchema = z
  .record(z.string(), z.string())
  .refine((env) => ORB_SERVICE_RESERVED_ENV.every((key) => env[key] === undefined), {
    message: 'env must not set PORT, PUBLIC_URL, or AMP_THREAD_ID',
  });

export const orbServiceSchema = z
  .object({
    command: z.string().min(1),
    cwd: orbServiceCwdSchema.optional(),
    port: z.number().int().min(1).max(65535).optional(),
    env: orbServiceEnvSchema.optional(),
    health: z.string().regex(/^\/.*/).optional(),
    portal: z.union([z.literal(true), orbPortalLinkSchema]).optional(),
    portals: orbPortalsSchema.optional(),
    review: z.boolean().optional(),
    agent: z.enum(['off', 'observe', 'control']).optional(),
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
