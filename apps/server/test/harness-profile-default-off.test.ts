import { HARNESS_PROFILE_CAPABILITIES, patchHarnessProfileBodySchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import { harnessProfile as harnessProfileTable } from '../src/db/schema.js';
import {
  harnessProfileModeOf,
  harnessProfileOf,
  servesHarnessCapability,
  upsertHarnessProfile,
} from '../src/services/harness-profile.js';
import { bootServer, type TestServer } from './helpers.js';

const servers: TestServer[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.dispose();
});

function boot() {
  const s = bootServer();
  servers.push(s);
  return s;
}

describe('F1 a team without a profile row is independent and serves nothing', () => {
  test('no row means no record, independent mode, and every capability off', () => {
    const s = boot();
    expect(harnessProfileOf(s.db, s.team.id)).toBeNull();
    expect(harnessProfileModeOf(s.db, s.team.id)).toBe('independent');
    for (const capability of HARNESS_PROFILE_CAPABILITIES) {
      expect(servesHarnessCapability(s.db, s.team.id, capability)).toBe(false);
    }
  });

  test('a row written without an explicit mode still reads independent', () => {
    const s = boot();
    s.db
      .insert(harnessProfileTable)
      .values({ id: 'hp-default', teamId: s.team.id, createdAt: 1, updatedAt: 1 })
      .run();
    expect(harnessProfileModeOf(s.db, s.team.id)).toBe('independent');
    for (const capability of HARNESS_PROFILE_CAPABILITIES) {
      expect(servesHarnessCapability(s.db, s.team.id, capability)).toBe(false);
    }
  });

  test('an unknown team reads independent instead of throwing', () => {
    const s = boot();
    expect(harnessProfileModeOf(s.db, 'team-missing')).toBe('independent');
    expect(servesHarnessCapability(s.db, 'team-missing', 'skills')).toBe(false);
  });
});

describe('F2 only an opted-in team serves the capabilities it enabled', () => {
  test('unified serves the enabled capability and nothing else', () => {
    const s = boot();
    upsertHarnessProfile(s.db, s.team.id, { mode: 'unified', capabilities: ['skills'] });
    expect(servesHarnessCapability(s.db, s.team.id, 'skills')).toBe(true);
    expect(servesHarnessCapability(s.db, s.team.id, 'mcpDefinitions')).toBe(false);
    expect(servesHarnessCapability(s.db, s.team.id, 'instructions')).toBe(false);
  });

  test('paused serves nothing even with capabilities enabled', () => {
    const s = boot();
    upsertHarnessProfile(s.db, s.team.id, {
      mode: 'unified',
      capabilities: [...HARNESS_PROFILE_CAPABILITIES],
    });
    upsertHarnessProfile(s.db, s.team.id, { mode: 'paused' });
    for (const capability of HARNESS_PROFILE_CAPABILITIES) {
      expect(servesHarnessCapability(s.db, s.team.id, capability)).toBe(false);
    }
  });

  test('independent serves nothing even with capabilities enabled', () => {
    const s = boot();
    upsertHarnessProfile(s.db, s.team.id, {
      mode: 'independent',
      capabilities: ['skills'],
    });
    expect(servesHarnessCapability(s.db, s.team.id, 'skills')).toBe(false);
  });

  test('upsert keeps one row per team and bumps the version', () => {
    const s = boot();
    const first = upsertHarnessProfile(s.db, s.team.id, { mode: 'unified' });
    const second = upsertHarnessProfile(s.db, s.team.id, { capabilities: ['packages'] });
    const rows = s.db
      .select()
      .from(harnessProfileTable)
      .where(eq(harnessProfileTable.teamId, s.team.id))
      .all();
    expect(rows).toHaveLength(1);
    expect(second.version).toBe(first.version + 1);
    expect(second.mode).toBe('unified');
    expect(second.capabilities).toEqual(['packages']);
  });
});

describe('F5 the profile has no slot for a secret value', () => {
  test('the patch body rejects a key it does not declare', () => {
    expect(
      patchHarnessProfileBodySchema.safeParse({ mode: 'unified', authToken: 'sk-live-abc' })
        .success,
    ).toBe(false);
    expect(
      patchHarnessProfileBodySchema.safeParse({ mcp: { env: { TOKEN: 'sk-live-abc' } } }).success,
    ).toBe(false);
  });

  test('an empty patch is rejected', () => {
    expect(patchHarnessProfileBodySchema.safeParse({}).success).toBe(false);
  });

  test('an unknown mode and an unknown capability are rejected', () => {
    expect(patchHarnessProfileBodySchema.safeParse({ mode: 'enabled' }).success).toBe(false);
    expect(patchHarnessProfileBodySchema.safeParse({ capabilities: ['secrets'] }).success).toBe(
      false,
    );
    expect(patchHarnessProfileBodySchema.safeParse({ targets: ['gemini'] }).success).toBe(false);
  });
});
