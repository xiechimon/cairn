import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ComputerCall, infoTaskDir } from '@cairn/shared';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { desc, eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { startCoordinator } from '../src/coordinator/index.js';
import { attachment, build, chiefMessage, message, step, todo } from '../src/db/schema.js';
import { ensureChief } from '../src/services/chief.js';
import { executeChiefTool } from '../src/services/chief-tools.js';
import { setCoordinatorInServer } from '../src/services/coordinator-context.js';
import { dropComputerWaiters, receiveComputerFrames } from '../src/services/machine-computer.js';
import { createProvider } from '../src/services/providers.js';
import { refuseRestrictedTurnTool } from '../src/services/report-turn.js';
import { bootServer, insertMachine, req, seedRoute, type TestServer } from './helpers.js';

const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cf' +
    'c0f01f00050001ff89993d1d0000000049454e44ae426082',
  'hex',
);

const disposables: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const dispose of disposables.splice(0)) await dispose();
  dropComputerWaiters();
  setCoordinatorInServer(false);
});

function fakeVmComputer(s: TestServer, machineId: string) {
  const files = new Map<string, Buffer>();
  const calls: ComputerCall[] = [];
  const answer = (call: ComputerCall): { text: string; exitCode?: number } => {
    const params = call.params as { command?: string; path?: string; content?: string };
    if (call.tool === 'write_file') {
      files.set(String(params.path), Buffer.from(String(params.content)));
      return { text: 'wrote' };
    }
    if (call.tool === 'read_file') {
      return { text: 'computer error: file is not valid UTF-8', exitCode: 1 };
    }
    const command = params.command ?? '';
    const listing = /^cd '([^']+\/deliverables)'/.exec(command);
    if (listing !== null) {
      const root = listing[1] ?? '';
      return {
        text: [...files.entries()]
          .filter(([path]) => path.startsWith(`${root}/`))
          .map(([path, bytes]) => `${path.slice(root.length + 1)}\t${bytes.length}\n`)
          .join(''),
      };
    }
    const size = /^test -f '([^']+)' && wc -c/.exec(command);
    if (size !== null) {
      const file = files.get(size[1] ?? '');
      return file === undefined ? { text: '', exitCode: 1 } : { text: String(file.length) };
    }
    const chunk = /^dd if='([^']+)' bs=(\d+) skip=(\d+)/.exec(command);
    if (chunk !== null) {
      const file = files.get(chunk[1] ?? '') ?? Buffer.alloc(0);
      const bs = Number(chunk[2]);
      const skip = Number(chunk[3]);
      return { text: file.subarray(skip * bs, (skip + 1) * bs).toString('base64') };
    }
    return { text: '' };
  };
  s.machineHub.subscribeMachine(s.team.id, machineId, (event) => {
    if (event.type !== 'computer') return;
    calls.push(event.call);
    const result = answer(event.call);
    queueMicrotask(() =>
      receiveComputerFrames(s.db, s.hub, machineId, event.call.callId, [
        {
          kind: 'done',
          seq: 1,
          text: result.text,
          ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
        },
      ]),
    );
  });
  return { calls, files };
}

async function runExportTurn(
  responses: (
    dir: string,
    vm: ReturnType<typeof fakeVmComputer>,
  ) => Parameters<ReturnType<typeof fauxProvider>['setResponses']>[0],
) {
  setCoordinatorInServer(true);
  const s = bootServer({ githubFetch: async () => new Response('[]') });
  disposables.push(() => s.dispose());
  const vmId = insertMachine(s, {
    name: 'vm-host',
    capabilities: {
      mcpServers: [],
      skills: [],
      computer: true,
      browser: true,
      computerKind: 'vm',
    },
  });
  createProvider(
    { db: s.db, box: s.secretBox },
    {
      teamId: s.team.id,
      body: {
        providerId: 'stub',
        label: 'Stub',
        baseUrl: 'http://127.0.0.1:9',
        api: 'openai-completions',
        apiKey: 'sk-stub-secret-key-0123456789',
        models: [{ id: 'm', name: 'm' }],
      },
      createdBy: s.user.id,
    },
  );
  seedRoute(s, 'session', { provider: 'stub', modelId: 'm' });
  const vm = fakeVmComputer(s, vmId);
  const projectRes = await req(s.app, 'POST', '/api/projects', { name: 'export-vm' });
  const projectId = ((await projectRes.json()) as { id: string }).id;
  const todoRes = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    title: '导出简历为 PNG 图片',
    spec: '导出简历成 PNG 发给我。',
    output: 'info',
  });
  const todoId = ((await todoRes.json()) as { id: string }).id;
  const started = await req(s.app, 'POST', `/api/projects/${projectId}/builds`, {
    todoIds: [todoId],
  });
  expect(started.status).toBe(201);
  const buildId = ((await started.json()) as { builds: { id: string }[] }).builds[0]!.id;
  const dir = infoTaskDir(buildId);

  const faux = fauxProvider({
    provider: 'stub',
    models: [{ id: 'm', input: ['text', 'image'], contextWindow: 200_000 }],
    tokensPerSecond: 1e9,
  });
  faux.setResponses(responses(dir, vm));
  const storageDir = makeTestTempDir('info-export-runner-');
  disposables.push(() => {
    releaseTestTempDir(storageDir);
  });
  const coordinator = startCoordinator({
    machine: {
      db: s.db,
      hub: s.hub,
      machineHub: s.machineHub,
      box: s.secretBox,
      user: s.user,
      vapidKeys: s.vapidKeys,
      reposDir: s.reposDir,
      attachmentsDir: s.attachmentsDir,
      skillsDir: s.skillsDir,
      convHub: s.convHub,
    },
    storageDir,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    heartbeatMs: 1_000,
    tickMs: 3_600_000,
    stopPollMs: 50,
    fixedProviders: [faux.provider],
  });
  disposables.push(() => coordinator.close());
  coordinator.tick();
  await coordinator.idle();
  return { s, vm, projectId, todoId, buildId, dir };
}

describe('info export image deliverables and inspection', () => {
  test('collects PNG deliverables, reads image via read_file, serves inline, exposes in gate wake, and delivers to chat', async () => {
    let readToolResult = '';
    const { s, todoId, buildId } = await runExportTurn((dir, vm) => [
      () => {
        vm.files.set(`${dir}/deliverables/images/resume_p1.png`, TINY_PNG);
        vm.files.set(`${dir}/deliverables/page2.png`, TINY_PNG);
        vm.files.set(`${dir}/deliverables/pages/preview.html`, Buffer.from('<p>ok</p>'));
        return fauxAssistantMessage(
          [
            fauxToolCall('write_file', { path: `${dir}/report.md`, content: '# Exported\nOK' }),
            fauxToolCall('read_file', { path: `${dir}/deliverables/images/resume_p1.png` }),
          ],
          { stopReason: 'toolUse' },
        );
      },
      (context) => {
        readToolResult = JSON.stringify(context.messages.filter((m) => m.role === 'toolResult'));
        return fauxAssistantMessage([fauxToolCall('submit_report', { path: `${dir}/report.md` })], {
          stopReason: 'toolUse',
        });
      },
      () => fauxAssistantMessage('已检查并导出两张图片。'),
    ]);

    const buildRow = s.db.select().from(build).where(eq(build.id, buildId)).get();
    expect(buildRow?.errorMessage ?? null).toBeNull();
    expect(s.db.select().from(todo).where(eq(todo.id, todoId)).get()?.phase).toBe('review');
    expect(readToolResult).toContain('"type":"image"');
    expect(readToolResult).toContain(TINY_PNG.toString('base64'));

    const delivMsg = s.db
      .select()
      .from(message)
      .where(eq(message.id, `deliverables-${buildId}`))
      .get();
    expect(delivMsg).toBeDefined();
    const parsed = JSON.parse(String(delivMsg?.content ?? '{}')) as {
      items: { attachmentId: string; kind: string; name: string; attachmentToken: string }[];
    };
    expect(parsed.items.map((i) => [i.name, i.kind])).toEqual(
      expect.arrayContaining([
        ['resume_p1.png', 'image'],
        ['page2.png', 'image'],
        ['preview.html', 'page'],
      ]),
    );

    const pngItem = parsed.items.find((i) => i.name === 'resume_p1.png')!;
    const htmlItem = parsed.items.find((i) => i.name === 'preview.html')!;
    const pngRes = await req(s.app, 'GET', `/api/attachments/${pngItem.attachmentId}`);
    expect(pngRes.status).toBe(200);
    expect(pngRes.headers.get('content-type')).toBe('image/png');
    expect(pngRes.headers.get('content-disposition')).toBe('inline');
    expect(pngRes.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'");
    expect(pngRes.headers.get('x-content-type-options')).toBe('nosniff');

    const htmlRes = await req(s.app, 'GET', `/api/attachments/${htmlItem.attachmentId}`);
    expect(htmlRes.status).toBe(200);
    expect(htmlRes.headers.get('content-disposition')).toMatch(/^attachment/);

    const gateStep = s.db
      .select()
      .from(step)
      .where(eq(step.kind, 'chief'))
      .orderBy(desc(step.createdAt))
      .get();
    expect(gateStep?.prompt).toContain(pngItem.attachmentId);
    expect(gateStep?.prompt).toContain(pngItem.attachmentToken);

    expect(() =>
      refuseRestrictedTurnTool(s.db, gateStep?.prompt ?? null, 'attachment', {
        attachmentId: pngItem.attachmentId,
      }),
    ).not.toThrow();

    const chiefRow = ensureChief(s.svc, s.team.id);
    const threadId = gateStep!.buildId;
    const ctx = {
      teamId: s.team.id,
      userId: s.user.id,
      chiefId: chiefRow.id,
      threadId,
      chiefAgentId: null,
      conversationId: threadId,
      turnPrompt: gateStep?.prompt ?? null,
    };
    const deps = {
      ...s.svc,
      attachmentsDir: s.attachmentsDir,
      reposDir: s.reposDir,
      box: s.secretBox,
    };
    const attResult = await executeChiefTool(deps, ctx, 'attachment', {
      attachmentId: pngItem.attachmentId,
    });
    expect(JSON.parse(attResult)).toMatchObject({
      id: pngItem.attachmentId,
      fileName: 'resume_p1.png',
      mimeType: 'image/png',
      encoding: 'base64',
      attachmentToken: pngItem.attachmentToken,
    });

    await executeChiefTool(deps, ctx, 'notify_user', {
      provenance: `report:${todoId}`,
      message: `简历已导出为 PNG：\n\n${pngItem.attachmentToken}`,
    });
    const posted = s.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.threadId, threadId))
      .orderBy(desc(chiefMessage.createdAt))
      .get();
    expect(posted?.content).toContain(pngItem.attachmentToken);
    const stored = s.db
      .select()
      .from(attachment)
      .where(eq(attachment.id, pngItem.attachmentId))
      .get();
    expect(readFileSync(join(s.attachmentsDir, stored!.storageKey))).toEqual(TINY_PNG);
  });
});
