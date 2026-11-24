import { once } from 'node:events';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import {
  type ComputerScreenRequest,
  chiefIdFormat,
  MCP_MIN_CLI_VERSION,
  machineTokenResponseSchema,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { expect, onTestFinished, test, vi } from 'vitest';
import WebSocket from 'ws';
import { computer, machine, mcpConnector, memoryEdit, project, step } from '../src/db/schema.js';
import { systemGitOps } from '../src/lib/git.js';
import { conditionalFeedbackFetch } from '../src/lib/github-feedback-cache.js';
import { computerScreensOf } from '../src/services/computer-screen.js';
import { executeMemoryEditTool } from '../src/services/memory-edit.js';
import { seedSessionRoute } from './helpers.js';
import { fixtureRequest, twoTeamWorld } from './team-scope-world.js';

test('screen upgrades reject an unrelated runner before admitting both owned peers', async () => {
  const { a, b, db } = await twoTeamWorld();
  for (const [owner, other] of [
    [a, b],
    [b, a],
  ] as const) {
    const computerId = `computer-${owner.teamId}`;
    db.insert(computer)
      .values({
        id: computerId,
        teamId: owner.teamId,
        machineId: owner.runnerId,
        scopeKey: `chief:${chiefIdFormat(owner.userId, owner.teamId)}`,
        providerRef: computerId,
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    const requests: ComputerScreenRequest[] = [];
    const disconnect = owner.server.machineHub.subscribeMachine(
      owner.teamId,
      owner.runnerId,
      (event) => {
        if (event.type === 'computer.screen') requests.push(event.channel);
      },
    );
    const gateway = computerScreensOf(owner.server);
    const listener = createServer();
    const sockets: WebSocket[] = [];
    gateway.attach(listener);
    try {
      listener.listen(0, '127.0.0.1');
      await once(listener, 'listening');
      const address = listener.address();
      if (address === null || typeof address === 'string') throw new Error('Missing fixture port');
      const host = `127.0.0.1:${address.port}`;
      const path = `/api/teams/${owner.teamId}/computers/${computerId}`;
      const bearer = owner.ownerToken;
      const control = await fixtureRequest(owner.server, 'POST', `${path}/control`, {
        bearer,
        body: {},
      });
      expect(control.status).toBe(201);
      const { leaseId } = (await control.json()) as { leaseId: string };
      const opened = await fixtureRequest(owner.server, 'POST', `${path}/screen`, {
        bearer,
        body: { kind: 'control', leaseId },
      });
      expect(opened.status).toBe(201);
      const viewer = (await opened.json()) as { path: string; wsProtocols: string[] };
      expect(requests).toHaveLength(1);
      const machinePath = `/api/machine/computer-screen/${requests[0]?.id}`;
      const connectRunner = (token: string) => {
        const socket = new WebSocket(`ws://${host}${machinePath}`, {
          headers: { authorization: `Bearer ${token}` },
        });
        sockets.push(socket);
        return socket;
      };
      const refused = await new Promise<number | undefined>((resolve, reject) => {
        const probe = connectRunner(other.runnerToken);
        probe.once('unexpected-response', (_request, response) => {
          response.resume();
          resolve(response.statusCode);
        });
        probe.once('upgrade', (response) => resolve(response.statusCode));
        probe.once('error', reject);
      });
      expect(refused).toBe(401);

      const runner = connectRunner(owner.runnerToken);
      const browser = new WebSocket(`ws://${host}${viewer.path}`, viewer.wsProtocols, {
        origin: `http://${host}`,
      });
      sockets.push(browser);
      await Promise.all([once(runner, 'open'), once(browser, 'open')]);
      for (const [sender, recipient, direction] of [
        [runner, browser, 'frame'],
        [browser, runner, 'input'],
      ] as const) {
        const payload = Buffer.from(`${owner.teamId}-${direction}`);
        const received = once(recipient, 'message');
        sender.send(payload);
        expect((await received)[0]).toEqual(payload);
      }
    } finally {
      gateway.close();
      disconnect();
      for (const socket of sockets) socket.terminate();
      await new Promise<void>((resolve) => listener.close(() => resolve()));
    }
  }
});

test('a claimed runner gets its own hosted repository key and granted connector', async () => {
  const { a, b, db } = await twoTeamWorld();
  const git = vi.spyOn(systemGitOps, 'httpBackend').mockResolvedValue({
    status: 200,
    headers: [],
    body: Buffer.from('fixture git response'),
  });
  onTestFinished(() => {
    git.mockRestore();
  });
  const repoName = 'fixture-shared';
  const slug = 'fixture-connector';
  for (const owner of [a, b]) {
    seedSessionRoute(owner.server, { provider: 'fixture-provider', modelId: 'fixture-model' });
    db.update(project)
      .set({ repoKind: 'hosted', repoName })
      .where(eq(project.id, owner.projectId))
      .run();
    db.update(machine)
      .set({
        latestCliVersion: MCP_MIN_CLI_VERSION,
        capabilities: { mcpServers: [], skills: [], mcpConnectors: true },
      })
      .where(eq(machine.id, owner.runnerId))
      .run();
    db.update(step)
      .set({ mcpGrant: [slug] })
      .where(eq(step.id, owner.stepId))
      .run();
    for (const name of [slug, 'ungranted']) {
      const headers = { Authorization: `Bearer fixture-${owner.teamId}-${name}` };
      db.insert(mcpConnector)
        .values({
          id: `${owner.teamId}-${name}`,
          teamId: owner.teamId,
          slug: name,
          label: name,
          url: `https://${owner.teamId}.example.invalid/${name}`,
          headerNames: Object.keys(headers),
          valuesCipher: owner.server.secretBox.seal(JSON.stringify(headers)),
          authKind: 'static',
          status: 'connected',
          createdAt: 1,
          updatedAt: 1,
        })
        .run();
    }
  }
  for (const [owner, other] of [
    [a, b],
    [b, a],
  ] as const) {
    const handoff = await fixtureRequest(
      owner.server,
      'GET',
      `/api/machine/token/${owner.stepId}`,
      {
        bearer: owner.runnerToken,
      },
    );
    expect(handoff.status).toBe(200);
    const token = machineTokenResponseSchema.parse(await handoff.json());
    expect(token.mcpConnectors).toEqual([
      {
        slug,
        transport: 'http',
        url: `https://${owner.teamId}.example.invalid/${slug}`,
        headers: { Authorization: `Bearer fixture-${owner.teamId}-${slug}` },
      },
    ]);
    if (token.git === null) throw new Error('Missing fixture hosted Git credential');
    const basic = Buffer.from(`${token.git.username}:${token.git.password}`).toString('base64');
    const readRepo = (team: typeof owner) =>
      fixtureRequest(
        team.server,
        'GET',
        `/git/${team.teamId}/${repoName}/info/refs?service=git-upload-pack`,
        {
          headers: { authorization: `Basic ${basic}` },
        },
      );
    const calls = git.mock.calls.length;
    expect((await readRepo(other)).status).toBe(404);
    expect(git).toHaveBeenCalledTimes(calls);
    const owned = await readRepo(owner);
    expect(owned.status).toBe(200);
    expect(await owned.text()).toBe('fixture git response');
    expect(git).toHaveBeenCalledTimes(calls + 1);
    expect(git).toHaveBeenLastCalledWith(
      expect.objectContaining({
        projectRoot: join(owner.server.reposDir, owner.teamId),
        pathInfo: `/${repoName}.git/info/refs`,
      }),
    );
  }
});

test('claimed steps with the same skill ID receive only their granted files and release the fixtures', async () => {
  const skillDirs: string[] = [];
  onTestFinished(async () => {
    for (const dir of skillDirs)
      await expect(access(dir)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  const { a, b } = await twoTeamWorld();
  const granted = 'fixture-shared';
  for (const owner of [a, b]) {
    skillDirs.push(owner.server.skillsDir);
    seedSessionRoute(owner.server, { skillsAllowlist: [granted] });
    for (const id of [granted, 'ungranted']) {
      const dir = join(owner.server.skillsDir, id);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'SKILL.md'), `---\nname: ${id}\n---\n\n${owner.teamId}\n`);
    }
  }
  for (const owner of [a, b]) {
    const path = `/api/machine/skills/${owner.stepId}`;
    const read = (suffix = '') =>
      fixtureRequest(owner.server, 'GET', path + suffix, { bearer: owner.runnerToken });
    const manifest = await read();
    expect(manifest.status).toBe(200);
    expect(await manifest.json()).toMatchObject({
      selection: 'whitelist',
      skills: [{ id: granted }],
    });
    expect((await read('/file?dirName=ungranted&path=SKILL.md')).status).toBe(404);
    const file = await read(`/file?dirName=${granted}&path=SKILL.md`);
    expect(file.status).toBe(200);
    expect(await file.text()).toBe(`---\nname: ${granted}\n---\n\n${owner.teamId}\n`);
  }
});

test.each([false, true])(
  'feedback cache keeps the same credentials isolated (B authorized: %s)',
  async (authorized) => {
    const { a, b } = await twoTeamWorld();
    const requests: { credential: string | undefined; validator: string | undefined }[] = [];
    const url = 'https://api.example.invalid/repos/shared/project/pulls/42';
    const cached = conditionalFeedbackFetch(async (_url, init) => {
      const credential = init?.headers?.authorization;
      const validator = init?.headers?.['if-none-match'];
      requests.push({ credential, validator });
      const owner = credential === `Bearer ${a.keyToken}` ? a : b;
      if (owner === b && !authorized) return new Response(null, { status: 403 });
      const etag = `"fixture-${owner.teamId}"`;
      if (validator === etag) return new Response(null, { status: 304 });
      return Response.json({ marker: owner.teamId }, { headers: { etag } });
    });
    const read = (token: string) => cached(url, { headers: { authorization: `Bearer ${token}` } });
    expect(await (await read(a.keyToken)).json()).toEqual({ marker: a.teamId });
    const other = await read(b.keyToken);
    expect(other.status).toBe(authorized ? 200 : 403);
    if (authorized) expect(await other.json()).toEqual({ marker: b.teamId });
    else expect(await other.text()).toBe('');
    expect(await (await read(a.keyToken)).json()).toEqual({ marker: a.teamId });
    expect(requests).toEqual([
      { credential: `Bearer ${a.keyToken}`, validator: undefined },
      { credential: `Bearer ${b.keyToken}`, validator: undefined },
      { credential: `Bearer ${a.keyToken}`, validator: '"fixture-team-a"' },
    ]);
    if (authorized) {
      expect(await (await read(b.keyToken)).json()).toEqual({ marker: b.teamId });
      expect(requests.at(-1)).toEqual({
        credential: `Bearer ${b.keyToken}`,
        validator: '"fixture-team-b"',
      });
    }
  },
);

test('independent memory edits replay and display only their own committed receipt', async () => {
  const { a, b, db } = await twoTeamWorld();
  for (const owner of [a, b]) {
    const editId = `edit-${owner.teamId}`;
    db.insert(memoryEdit)
      .values({
        id: editId,
        teamId: owner.teamId,
        userId: owner.userId,
        chiefId: owner.chiefId,
        threadId: owner.threadId,
        stepId: owner.chiefStepId,
        instruction: 'Save fixture memory',
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    const write = () =>
      executeMemoryEditTool(
        db,
        { teamId: owner.teamId, agentId: owner.userId, projectId: null },
        editId,
        'fixture-shared-call',
        'save_memory',
        { file: 'notes', content: `Fixture memory for ${owner.teamId}`, scope: 'team' },
      );
    const first = write();
    expect(first.replayed).toBe(false);
    expect(write()).toEqual({ replayed: true, output: first.output });
  }
  for (const owner of [a, b]) {
    const result = await fixtureRequest(
      owner.server,
      'GET',
      `/api/teams/${owner.teamId}/memory-edits/current`,
      {
        bearer: owner.ownerToken,
      },
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      teamId: owner.teamId,
      receipts: [
        {
          editId: `edit-${owner.teamId}`,
          callId: 'fixture-shared-call',
          after: `Fixture memory for ${owner.teamId}`,
        },
      ],
    });
  }
});
