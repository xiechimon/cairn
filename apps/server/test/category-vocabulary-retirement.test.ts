import { execFileSync } from 'node:child_process';
import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { tag, todo, todoTag } from '../src/db/schema.js';
import { executeChiefTool } from '../src/services/chief-tools.js';
import { bootServer, postProject, req } from './helpers.js';
import { insertLegacyCategory } from './legacy-category-fixtures.js';

test.each(['plain', 'local', 'hosted', 'github'] as const)(
  '%s project creation has no category seeds or vocabulary routes',
  async (kind) => {
    const s = bootServer();
    const localPath = kind === 'local' ? makeTestTempDir('category-local-') : undefined;
    try {
      if (localPath) execFileSync('git', ['init', '-q', localPath]);
      const response = await req(s.app, 'POST', '/api/projects', {
        name: 'Vocabulary retirement',
        ...(kind === 'plain' ? {} : { kind }),
        ...(localPath ? { localPath } : {}),
        ...(kind === 'github' ? { githubRepo: 'octo/demo' } : {}),
      });
      expect(response.status).toBe(201);
      const { id } = (await response.json()) as { id: string };
      expect(s.db.select().from(tag).where(eq(tag.projectId, id)).all()).toEqual([]);
      for (const projectId of [id, 'missing-project']) {
        for (const method of ['GET', 'POST']) {
          const before = s.db.select().from(tag).all();
          const result = await req(
            s.app,
            method,
            `/api/projects/${projectId}/tags`,
            method === 'POST' ? { name: 'retired', color: '#123456' } : undefined,
          );
          expect(result.status).toBe(404);
          expect(s.db.select().from(tag).all()).toEqual(before);
        }
      }
    } finally {
      s.dispose();
      if (localPath) releaseTestTempDir(localPath);
    }
  },
);

test('retired vocabulary requests preserve legacy correction tasks and associations', async () => {
  const s = bootServer();
  try {
    const projectId = await postProject(s.app);
    const category = insertLegacyCategory(s.db, projectId, 'CoRrEcTiOn');
    const created = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
      title: 'Existing task',
      spec: 'Keep this body.',
      tagIds: [category.id],
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const snapshot = () => ({
      categories: s.db.select().from(tag).all(),
      tasks: s.db.select().from(todo).all(),
      links: s.db.select().from(todoTag).all(),
    });
    const before = snapshot();
    expect(before.tasks[0]?.correctionRequired).toBe(true);
    for (const method of ['GET', 'POST']) {
      const response = await req(
        s.app,
        method,
        `/api/projects/${projectId}/tags`,
        method === 'POST' ? { name: 'new', color: '#000000' } : undefined,
      );
      expect(response.status).toBe(404);
      expect(snapshot()).toEqual(before);
    }
    expect((await req(s.app, 'PATCH', `/api/todos/${id}`, { phase: 'done' })).status).toBe(409);
    expect(snapshot()).toEqual(before);
  } finally {
    s.dispose();
  }
});

test.each(['plain', 'hosted'])(
  'Coordinator %s project creation does not seed categories',
  async (kind) => {
    const s = bootServer();
    try {
      const result = await executeChiefTool(
        {
          ...s.svc,
          box: s.secretBox,
          reposDir: s.reposDir,
          attachmentsDir: s.attachmentsDir,
          skillsDir: s.skillsDir,
        },
        {
          teamId: s.team.id,
          userId: s.user.id,
          chiefId: 'unused-chief',
          threadId: 'unused-thread',
          chiefAgentId: null,
          conversationId: 'unused-thread',
        },
        'create_project',
        { name: 'Coordinator project', ...(kind === 'hosted' ? { repoKind: 'hosted' } : {}) },
      );
      const { id } = JSON.parse(result) as { id: string };
      expect(s.db.select().from(tag).where(eq(tag.projectId, id)).all()).toEqual([]);
    } finally {
      s.dispose();
    }
  },
);
