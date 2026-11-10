import { writeFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { updateAutonomousTodo } from '../src/services/todos.js';
import { bootServer, postProject, req } from './helpers.js';

test('observe correction provenance and compatibility before generic data retirement', async () => {
  const s = bootServer();
  try {
    const projectId = await postProject(s.app);
    const tagResponse = await req(s.app, 'POST', `/api/projects/${projectId}/tags`, {
      name: 'correction', color: '#112233',
    });
    expect(tagResponse.status).toBe(201);
    const category = await tagResponse.json() as { id: string };
    const create = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
      title: 'Legacy correction', spec: 'Preserve its evidence requirement.', tagIds: [category.id],
    });
    expect(create.status).toBe(201);
    const legacy = await create.json() as { id: string };
    const ordinaryCreate = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
      title: 'Dedicated label control', spec: 'Its label removal stays reversible.', machineId: 'ignored-field',
    });
    expect(ordinaryCreate.status).toBe(201);
    const ordinary = await ordinaryCreate.json() as { id: string };
    const ignoredPatch = await req(s.app, 'PATCH', `/api/todos/${legacy.id}`, {
      correctionRequired: false, unknownFutureField: true,
    });
    expect(ignoredPatch.status).toBe(200);
    s.db.run(sql`UPDATE project SET repoKind = 'github', githubRepo = 'octo/demo' WHERE id = ${projectId}`);
    s.db.run(sql`INSERT INTO github_label (id, projectId, name, color) VALUES ('probe-label', ${projectId}, 'correction', '#112233')`);
    const deps = { db: s.db, hub: s.hub, user: s.user };
    updateAutonomousTodo(deps, ordinary.id, { githubLabelIds: ['probe-label'] });
    expect(s.db.get(sql`SELECT correctionRequired FROM todo WHERE id = ${ordinary.id}`)).toEqual({ correctionRequired: 1 });
    updateAutonomousTodo(deps, ordinary.id, { githubLabelIds: [] });
    expect(s.db.get(sql`SELECT correctionRequired FROM todo WHERE id = ${ordinary.id}`)).toEqual({ correctionRequired: 0 });
    updateAutonomousTodo(deps, legacy.id, { githubLabelIds: [] });
    expect(s.db.get(sql`SELECT correctionRequired FROM todo WHERE id = ${legacy.id}`)).toEqual({ correctionRequired: 1 });
    const protectedDone = await req(s.app, 'PATCH', `/api/todos/${legacy.id}`, { phase: 'done' });
    expect(protectedDone.status).toBe(409);
    s.db.run(sql`DELETE FROM todo_tag WHERE todoId = ${legacy.id}`);
    updateAutonomousTodo(deps, legacy.id, { githubLabelIds: [] });
    expect(s.db.get(sql`SELECT correctionRequired FROM todo WHERE id = ${legacy.id}`)).toEqual({ correctionRequired: 0 });
    const unsafeDone = await req(s.app, 'PATCH', `/api/todos/${legacy.id}`, { phase: 'done' });
    expect(unsafeDone.status).toBe(200);
    const output = process.env.CAIRN_CUTOVER_PROBE_RESULT;
    expect(output).toBeTruthy();
    if (output !== undefined) writeFileSync(output, `${JSON.stringify({
      surface: 'isolated in-process production mutation and HTTP route entry points',
      provider: 'not exercised', github: 'not contacted',
      fixtureOnlyLegacyAssociationDeletion: true,
      intactLegacyMembership: { correctionRequired: true, completionStatus: protectedDone.status },
      naiveRetirementThenLabelReplacement: { correctionRequired: false, completionStatus: unsafeDone.status },
      dedicatedOnlyCorrectionRemovalRemainsReversible: true,
      unrelatedUnknownCreateFieldStatus: ordinaryCreate.status,
      unrelatedUnknownPatchFieldStatus: ignoredPatch.status,
      interpretation: 'negative control for the proposed future cutover, not a current ordinary API exploit',
    }, null, 2)}\n`);
  } finally {
    s.dispose();
  }
});
