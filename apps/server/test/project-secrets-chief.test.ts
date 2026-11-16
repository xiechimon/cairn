import { describe, expect, test } from 'vitest';
import { proposeAction } from '../src/services/action-proposals.js';
import { BROWSER_PASSWORD_ACTION } from '../src/services/browser-passwords.js';
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
    });
    proposeAction(H.s.db, {
      teamId: H.teamId,
      actionId: BROWSER_PASSWORD_ACTION,
      targetId: saved.id,
      input: {
        secretId: saved.id,
        revision: 1,
        origin: 'https://login.example.com',
        machineId: 'browser-host',
      },
      threadId: H.threadId,
      scopeProjectId: null,
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

  test('set_secret turns an env into a secret and never echoes a value; list_secrets carries none', async () => {
    const env = createSecret(deps(), {
      teamId: H.teamId,
      name: 'PUBLIC_URL',
      value: 'stored-sentinel-91c2',
      kind: 'env',
    });
    expect(JSON.stringify(await relay('secrets', {}))).not.toContain('stored-sentinel-91c2');
    const result = await relay('set_secret', { name: 'PUBLIC_URL', value: 'tool-sentinel-4d7e' });
    expect(result).toMatchObject({ id: env.id, kind: 'secret' });
    expect(JSON.stringify(result)).not.toContain('tool-sentinel-4d7e');
    expect(openedValue(env.id, null)).toBe('tool-sentinel-4d7e');
    const created = await relay('set_secret', { name: 'NEW_ONE', value: 'tool-sentinel-4d7e' });
    expect(created).toMatchObject({ kind: 'secret' });
    expect(JSON.stringify(created)).not.toContain('tool-sentinel-4d7e');
  });

  test('set_secret refuses names that do not look like MY_KEY, mail. names included', async () => {
    createSecret(deps(), { teamId: H.teamId, name: 'mail.gmail.refresh', value: 'v' });
    for (const name of ['lower', 'mail.gmail.refresh', 'MAIL.NEW']) {
      await expect(relay('set_secret', { name, value: 'v' })).rejects.toMatchObject({
        status: 400,
      });
    }
  });
});
