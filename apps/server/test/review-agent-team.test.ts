import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  build as buildTable,
  routingRule as routingRuleTable,
  step as stepTable,
  team as teamTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { newRecordId } from '../src/lib/ids.js';
import { bootServer, postProject, req, seedRoute, type TestServer } from './helpers.js';

const servers: TestServer[] = [];
afterAll(() => {
  for (const s of servers) s.dispose();
});

async function world() {
  const s = bootServer();
  servers.push(s);
  const projectId = await postProject(s.app, 'review-team');
  s.db
    .insert(teamTable)
    .values({ ...s.db.select().from(teamTable).get()!, id: 'team-other', name: 'other' })
    .run();
  s.db
    .insert(todoTable)
    .values({
      id: 'todo-review-team',
      teamId: s.team.id,
      projectId,
      seqNum: 1,
      title: 'review team check',
      spec: '',
      phase: 'confirm',
      phaseAt: 1,
      latestBuildId: 'build-review-team',
    })
    .run();
  s.db
    .insert(buildTable)
    .values({
      id: 'build-review-team',
      todoId: 'todo-review-team',
      withPlan: true,
      triggerSource: 'user',
      createdAt: 1,
    })
    .run();
  return s;
}

function reviewSteps(s: TestServer) {
  return s.db
    .select()
    .from(stepTable)
    .where(eq(stepTable.buildId, 'build-review-team'))
    .all()
    .filter((row) => row.kind === 'review');
}

describe('the review request only uses the review routing rule of the task team', () => {
  test('a review rule of another team does not count: 400 and no review step', async () => {
    const s = await world();
    s.db
      .insert(routingRuleTable)
      .values({
        id: newRecordId(),
        teamId: 'team-other',
        use: 'review',
        provider: 'stub-gw',
        modelId: 'm',
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    const res = await req(s.app, 'POST', '/api/builds/build-review-team/steps', {
      action: 'review',
    });
    expect(res.status).toBe(400);
    expect(reviewSteps(s)).toHaveLength(0);
  });

  test('no review rule at all is 400', async () => {
    const s = await world();
    const res = await req(s.app, 'POST', '/api/builds/build-review-team/steps', {
      action: 'review',
    });
    expect(res.status).toBe(400);
  });

  test('a review rule of the task team is accepted', async () => {
    const s = await world();
    seedRoute(s, 'review', { provider: 'stub-gw', modelId: 'm' });
    const res = await req(s.app, 'POST', '/api/builds/build-review-team/steps', {
      action: 'review',
    });
    expect(res.status).toBe(202);
    expect(reviewSteps(s)).toHaveLength(1);
  });
});
