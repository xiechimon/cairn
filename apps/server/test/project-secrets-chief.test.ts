import { describe, expect, test } from 'vitest';
import { createSecret, listSecrets, openSecretValues } from '../src/services/secrets.js';
import { H, registerChiefHarness, relay } from './chief-harness.js';

registerChiefHarness();

const deps = () => ({ db: H.s.db, box: H.s.secretBox });

function openedValue(id: string, projectId: string | null): string | undefined {
  return Object.values(openSecretValues(deps(), H.teamId, [id], projectId))[0];
}

describe('the Coordinator secret tools respect secret scope (D74 P5)', () => {
  test('set_secret without a project writes the team secret even when a project secret has the name', async () => {
    const projectSecret = createSecret(deps(), {
      teamId: H.teamId,
      name: 'TOKEN',
      value: 'project-value',
      projectId: H.projectId,
    });
    const team = (await relay('set_secret', { name: 'TOKEN', value: 'team-value' })) as {
      id: string;
      projectId: string | null;
    };
    expect(team.projectId).toBeNull();
    expect(team.id).not.toBe(projectSecret.id);
    expect(openedValue(projectSecret.id, H.projectId)).toBe('project-value');
    await relay('set_secret', { name: 'TOKEN', value: 'rotated', projectId: H.projectId });
    expect(openedValue(projectSecret.id, H.projectId)).toBe('rotated');
    expect(openedValue(team.id, null)).toBe('team-value');
  });

  test('delete_secrets by name removes only the secret of the named scope', async () => {
    const projectSecret = createSecret(deps(), {
      teamId: H.teamId,
      name: 'TOKEN',
      value: 'project-value',
      projectId: H.projectId,
    });
    const team = createSecret(deps(), { teamId: H.teamId, name: 'TOKEN', value: 'team-value' });
    expect(await relay('delete_secrets', { names: ['TOKEN'] })).toEqual({ deleted: ['TOKEN'] });
    expect(listSecrets(deps(), H.teamId).map((row) => row.id)).toEqual([projectSecret.id]);
    await relay('delete_secrets', { names: ['TOKEN'], projectId: H.projectId });
    expect(listSecrets(deps(), H.teamId)).toEqual([]);
    expect(team.id).not.toBe(projectSecret.id);
  });
});
