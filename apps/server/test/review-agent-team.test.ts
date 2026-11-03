import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  step as stepTable,
  team as teamTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { bootServer, postProject, req, type TestServer } from './helpers.js';

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
    .insert(agentTable)
    .values([
      { id: 'agent-own', teamId: s.team.id, displayName: 'own', provider: 'stub-gw', modelId: 'm' },
      {
        id: 'agent-foreign',
        teamId: 'team-other',
        displayName: 'foreign',
        provider: 'stub-gw',
        modelId: 'm',
      },
    ])
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
      assignment: { plan: null, build: { agentId: 'agent-own' } },
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

describe('the review request only accepts a reviewer from the task team', () => {
  test('an agent id from another team is 404 and enqueues no review step', async () => {
    const s = await world();
    const res = await req(s.app, 'POST', '/api/builds/build-review-team/steps', {
      action: 'review',
      agentId: 'agent-foreign',
    });
    expect(res.status).toBe(404);
    expect(reviewSteps(s)).toHaveLength(0);
  });

  test('an unknown agent id is 404', async () => {
    const s = await world();
    const res = await req(s.app, 'POST', '/api/builds/build-review-team/steps', {
      action: 'review',
      agentId: 'agent-missing',
    });
    expect(res.status).toBe(404);
  });

  test('an agent of the task team is accepted', async () => {
    const s = await world();
    const res = await req(s.app, 'POST', '/api/builds/build-review-team/steps', {
      action: 'review',
      agentId: 'agent-own',
    });
    expect(res.status).toBe(202);
    expect(reviewSteps(s)).toHaveLength(1);
  });
});
