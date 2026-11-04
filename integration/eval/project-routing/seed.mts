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
      if (res.status !== 201) throw new Error(`creating project ${p.name} failed: ${res.status}`);
      id = (res.body as { id: string }).id;
      seedRepoContent(stack, id, p.name, p.seedDir);
    }
    const described = await api(server.url, 'PATCH', `/api/projects/${id}`, {
      description: p.description,
    });
    if (described.status !== 200)
      throw new Error(`setting the description of ${p.name} failed: ${described.status}`);
    idsByName[p.name] = id;
  }
  return idsByName;
}
