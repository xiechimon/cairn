import { eq } from 'drizzle-orm';
import { project as projectTable } from '../../../apps/server/src/db/schema.js';
import { api } from '../../test/helpers.js';
import { type SeededWorld, type Stack, seedRepoContent } from '../chief-dispatch/stack.mts';
import { DEFAULT_PROJECT_NAME, ROUTING_PROJECTS } from './projects.mts';

export async function seedRoutingProjects(
  stack: Stack,
  world: Pick<SeededWorld, 'projectId'>,
): Promise<Record<string, string>> {
  const { server } = stack;
  const idsByName: Record<string, string> = {};
  for (const p of ROUTING_PROJECTS) {
    let id = world.projectId;
    if (p.name !== DEFAULT_PROJECT_NAME) {
      const res = await api(server.url, 'POST', '/api/projects', {
        name: p.name,
        teamId: server.teamId,
        repoKind: 'hosted',
      });
      if (res.status !== 201) throw new Error(`建 ${p.name} 失败: ${res.status}`);
      id = (res.body as { id: string }).id;
      seedRepoContent(stack, id, p.name, p.seedDir);
    }
    server.db
      .update(projectTable)
      .set({ description: p.description })
      .where(eq(projectTable.id, id))
      .run();
    idsByName[p.name] = id;
  }
  return idsByName;
}
