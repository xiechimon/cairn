import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { machineSkillsManifestResponseSchema } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';

const frozenOldMachineSkillsResponseSchema = z.object({
  skills: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      dirName: z.string(),
      files: z.array(
        z.object({
          path: z.string(),
          content: z.string(),
        }),
      ),
    }),
  ),
});

const OLD_BUNDLE_200 = {
  skills: [
    {
      id: 'alpha',
      name: 'alpha',
      description: '旧整包分发形',
      dirName: 'alpha',
      files: [
        { path: 'SKILL.md', content: '---\nname: alpha\n---\n\nbody\n' },
        { path: 'notes.md', content: 'notes body\n' },
      ],
    },
  ],
};

function archived(relFromRepoRoot: string): unknown {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`../../../${relFromRepoRoot}`, import.meta.url)), 'utf8'),
  ) as unknown;
}

describe('skills distribution wire version skew (#919 seam: new daemon × old server / old daemon × new server)', () => {
  test('V2 old monolithic-shape fixture passes the frozen old schema (fixture validity disproved by contradiction)', () => {
    expect(frozenOldMachineSkillsResponseSchema.safeParse(OLD_BUNDLE_200).success).toBe(true);
  });

  test('V1 new daemon × old server 200: the current manifest schema cleanly rejects the old monolithic shape', () => {
    const result = machineSkillsManifestResponseSchema.safeParse(OLD_BUNDLE_200);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.')).join(' ');
      expect(paths).toContain('selection');
    }
  });

  test('V3 old daemon × new server: the frozen old schema cleanly rejects the machine-captured new manifest shape', () => {
    const golden = archived('docs/verify/920/wire-new/manifest-new.json') as {
      manifest: unknown;
    };
    const result = frozenOldMachineSkillsResponseSchema.safeParse(golden.manifest);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.')).join(' ');
      expect(paths).toContain('content');
    }
  });

  test('V4 current schema passes the machine-captured new manifest golden sample (#920 archive, independent source)', () => {
    const golden = archived('docs/verify/920/wire-new/manifest-new.json') as {
      manifest: unknown;
    };
    expect(machineSkillsManifestResponseSchema.safeParse(golden.manifest).success).toBe(true);
  });

  test('V5 old server byte-gate 400 archived shape is still "non-2xx + body.error naming the root cause"', () => {
    const old400 = archived('docs/verify/920/wire-old-before/manifest-old-400.json') as {
      status: number;
      body: { error: string };
    };
    expect(old400.status).toBe(400);
    expect(old400.body.error).toContain('skill file too large');
  });
});
