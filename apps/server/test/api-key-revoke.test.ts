import { describe, expect, test } from 'vitest';
import { createApiKey } from '../src/services/api-keys.js';
import { bootServer, req, type TestServer } from './helpers.js';

async function issueKey(s: TestServer, name: string): Promise<{ id: string; plaintext: string }> {
  const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/api-keys`, {
    name,
    gitAccess: true,
    mcpAccess: true,
    machineAccess: true,
    toolGrants: { read: [], write: [] },
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; plaintext: string };
}

function mcpInitialize(s: TestServer, key: string) {
  return s.app.request('/api/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'revoke-probe', version: '0' },
      },
    }),
  });
}

function gitInfoRefs(s: TestServer, repoName: string, key: string) {
  return s.app.request(`/git/${s.team.id}/${repoName}/info/refs?service=git-upload-pack`, {
    headers: { authorization: `Basic ${Buffer.from(`git:${key}`).toString('base64')}` },
  });
}

function enroll(s: TestServer, key: string) {
  return s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ teamId: s.team.id, name: 'revoke-probe-runner' }),
  });
}

describe('deleting an API key revokes it on every path that accepts API keys', () => {
  test('MCP, git hosting and machine enrollment refuse the key right after the delete call', async () => {
    const s = bootServer();
    try {
      const project = await req(s.app, 'POST', '/api/projects', {
        name: 'revoke-probe',
        repoKind: 'hosted',
      });
      expect(project.status).toBe(201);
      const { repoName } = (await project.json()) as { repoName: string };
      const revoked = await issueKey(s, 'LEAKED_KEY');
      const kept = await issueKey(s, 'KEPT_KEY');

      expect((await mcpInitialize(s, revoked.plaintext)).status).toBe(200);
      expect((await gitInfoRefs(s, repoName, revoked.plaintext)).status).toBe(200);
      expect((await enroll(s, revoked.plaintext)).status).toBe(200);

      const deleted = await req(s.app, 'DELETE', `/api/teams/${s.team.id}/api-keys/${revoked.id}`);
      expect(deleted.status).toBe(204);

      expect((await mcpInitialize(s, revoked.plaintext)).status).toBe(401);
      expect((await gitInfoRefs(s, repoName, revoked.plaintext)).status).toBe(401);
      expect((await enroll(s, revoked.plaintext)).status).toBe(401);

      expect((await mcpInitialize(s, kept.plaintext)).status).toBe(200);
      expect((await gitInfoRefs(s, repoName, kept.plaintext)).status).toBe(200);

      const listed = (await (
        await req(s.app, 'GET', `/api/teams/${s.team.id}/api-keys`)
      ).json()) as { id: string }[];
      expect(listed.map((key) => key.id)).toEqual([kept.id]);
    } finally {
      s.dispose();
    }
  });

  test('a key of another team, an unknown id and a step git key cannot be deleted through the route', async () => {
    const s = bootServer();
    try {
      const unknown = await req(s.app, 'DELETE', `/api/teams/${s.team.id}/api-keys/nope`);
      expect(unknown.status).toBe(404);
      const foreignTeam = await req(s.app, 'DELETE', `/api/teams/other-team/api-keys/nope`);
      expect(foreignTeam.status).toBe(404);
      const stepKey = createApiKey(s, {
        teamId: s.team.id,
        name: 'git-step-running-step',
        gitAccess: true,
        mcpAccess: false,
        toolGrants: { read: [], write: [] },
      });
      const stepDelete = await req(
        s.app,
        'DELETE',
        `/api/teams/${s.team.id}/api-keys/${stepKey.id}`,
      );
      expect(stepDelete.status).toBe(404);
    } finally {
      s.dispose();
    }
  });
});
