import { describe, expect, test } from 'vitest';
import { createSecret, listSecrets, openSecretValues } from '../src/services/secrets.js';
import { H, registerChiefHarness, relay } from './chief-harness.js';

registerChiefHarness();

const deps = () => ({ db: H.s.db, box: H.s.secretBox });

function openedValue(id: string, projectId: string | null): string | undefined {
  return Object.values(openSecretValues(deps(), H.teamId, [id], projectId))[0];
}

describe('the Coordinator secret tools respect secret scope (D74 P5)', () => {
  test('the model cannot overwrite, shadow or delete a browser password', async () => {
    const saved = createSecret(deps(), {
      teamId: H.teamId,
      name: 'LOGIN',
      value: 'synthetic-password',
      delivery: 'browser',
      browserOrigin: 'https://login.example.com',
    });
    for (const projectId of [undefined, H.projectId]) {
      await expect(
        relay('set_secret', { name: 'LOGIN', value: 'changed', projectId }),
      ).rejects.toThrow(/settings/);
      await expect(relay('delete_secrets', { names: ['LOGIN'], projectId })).rejects.toThrow(
        /settings/,
      );
    }
    await expect(relay('delete_secrets', { names: [saved.id] })).rejects.toThrow(/settings/);
    expect(openSecretValues(deps(), H.teamId, [saved.id], null)).toEqual({});
  });

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

  const policy = {
    origin: 'https://api.example.com',
    header: 'Authorization',
    template: 'Bearer {secret}',
  };

  test('set_secret refuses to change an http secret', async () => {
    const http = createSecret(deps(), {
      teamId: H.teamId,
      name: 'TOKEN',
      value: 'owner-value',
      delivery: 'http',
      http: policy,
    });
    await expect(relay('set_secret', { name: 'TOKEN', value: 'model-value' })).rejects.toThrow(
      /settings/,
    );
    expect(listSecrets(deps(), H.teamId)).toEqual([
      expect.objectContaining({ id: http.id, delivery: 'http', policyRevision: 1 }),
    ]);
  });

  test('set_secret refuses a project row that would shadow an http team secret', async () => {
    createSecret(deps(), {
      teamId: H.teamId,
      name: 'TOKEN',
      value: 'owner-value',
      delivery: 'http',
      http: policy,
    });
    await expect(
      relay('set_secret', { name: 'TOKEN', value: 'model-value', projectId: H.projectId }),
    ).rejects.toThrow(/settings/);
    expect(listSecrets(deps(), H.teamId)).toHaveLength(1);
  });

  test('set_secret refuses a team row that an http project secret would shadow', async () => {
    createSecret(deps(), {
      teamId: H.teamId,
      name: 'TOKEN',
      value: 'owner-value',
      projectId: H.projectId,
      delivery: 'http',
      http: policy,
    });
    await expect(relay('set_secret', { name: 'TOKEN', value: 'model-value' })).rejects.toThrow(
      /settings/,
    );
    expect(listSecrets(deps(), H.teamId)).toHaveLength(1);
  });

  test('set_secret still creates and updates plaintext secrets', async () => {
    const created = (await relay('set_secret', { name: 'PLAIN', value: 'a' })) as {
      delivery: string;
    };
    expect(created.delivery).toBe('plaintext');
  });
});
