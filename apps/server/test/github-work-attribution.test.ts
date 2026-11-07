import { expect, test, vi } from 'vitest';
import { build, githubConnection, message, project, todo } from '../src/db/schema.js';
import type { FetchLike } from '../src/lib/github.js';
import { type AppToken, registerAppToken } from '../src/lib/github-token.js';
import {
  humanWorkIdentity,
  reconcileWorkAttribution,
} from '../src/services/github-work-attribution.js';
import { bootServer } from './helpers.js';

test.each(['human', 'autonomous', 'author', 'requested', 'reviewed', 'schedule', 'intake'])(
  'review attribution is idempotent: %s',
  async (scenario) => {
    const s = bootServer();
    try {
      s.db.insert(project).values({ id: 'p', teamId: s.team.id, name: 'p' }).run();
      s.db
        .insert(todo)
        .values({
          id: 't',
          teamId: s.team.id,
          projectId: 'p',
          title: 't',
          phaseAt: 1,
          seqNum: 1,
          createdBy: scenario === 'autonomous' ? null : s.user.id,
          sourceKind: scenario === 'intake' ? 'research-intake' : null,
        })
        .run();
      s.db
        .insert(build)
        .values({
          id: 'b',
          todoId: 't',
          withPlan: false,
          triggerSource: scenario === 'schedule' ? 'schedule' : 'user',
          createdAt: 1,
        })
        .run();
      s.db
        .insert(githubConnection)
        .values({
          teamId: s.team.id,
          login: 'human',
          githubUserId: 12,
          githubName: 'Human',
          accessTokenCipher: 'unused',
          scope: 'repo',
          createdAt: 1,
        })
        .run();
      const token = 'attribution-fixture' as AppToken;
      registerAppToken(token, Date.now() + 3600000, (inner) => inner, 'cairnwright');
      let requested = scenario === 'requested';
      const writes: string[] = [];
      const fetch = vi.fn<FetchLike>(async (url, init) => {
        if (init?.method === 'POST') {
          writes.push(String(url));
          requested = true;
        }
        const data = String(url).includes('/reviews?')
          ? scenario === 'reviewed'
            ? [{ user: { login: 'human' } }]
            : []
          : String(url).includes('/commits')
            ? [{ sha: 'abc', commit: { message: 'missing trailer' } }]
            : {
                user: { login: scenario === 'author' ? 'human' : 'cairnwright[bot]' },
                requested_reviewers: requested ? [{ login: 'human' }] : [],
              };
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => data,
          text: async () => '',
        };
      });
      const deps = s.svc;
      const target = {
        teamId: s.team.id,
        threadId: 't',
        buildId: 'b',
        owner: 'o',
        repo: 'r',
        prNumber: 1,
      };
      expect(
        humanWorkIdentity(
          s.db,
          s.db.select().from(todo).get()!,
          scenario === 'schedule' ? 'schedule' : 'user',
        )?.login ?? null,
      ).toBe(['autonomous', 'schedule', 'intake'].includes(scenario) ? null : 'human');
      await reconcileWorkAttribution(deps, fetch, token, target, 'abc', 1);
      requested = false;
      await reconcileWorkAttribution(deps, fetch, token, target, 'abc', 2);
      expect(writes).toHaveLength(scenario === 'human' ? 1 : 0);
      const notices = s.db
        .select()
        .from(message)
        .all()
        .filter((row) => row.id.startsWith('pr-coauthor:'));
      expect(notices).toHaveLength(['autonomous', 'schedule', 'intake'].includes(scenario) ? 0 : 1);
      if (notices.length) expect(String(notices[0]?.content)).toContain('abc');
    } finally {
      s.dispose();
    }
  },
);
