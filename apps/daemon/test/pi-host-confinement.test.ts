import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { StepEvent } from '@cairn/shared';
import { COORDINATOR_COMPACT_AT } from '@cairn/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { createSessionConfiner } from '../src/backend/confine-session.js';
import { createPiBackend } from '../src/backend/pi.js';
import { openPiHostSession } from '../src/backend/pi-host-client.js';
import { testTempDir } from './test-temp-dir.js';

const SENTINEL = 'PI-HOST-SENTINEL-OWNER-TOKEN';

interface Scripted {
  name: string;
  args: Record<string, unknown>;
}

function chunk(delta: Record<string, unknown>, finish: string | null) {
  return `data: ${JSON.stringify({
    id: 'c1',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'scripted',
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`;
}

function modelResponse(call: Scripted | undefined, index: number): string {
  const body = call
    ? chunk(
        {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: `call_${index}`,
              type: 'function',
              function: { name: call.name, arguments: JSON.stringify(call.args) },
            },
          ],
        },
        null,
      ) + chunk({}, 'tool_calls')
    : chunk({ role: 'assistant', content: 'finished' }, null) + chunk({}, 'stop');
  const usage = `data: ${JSON.stringify({
    id: 'c1',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'scripted',
    choices: [],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
  })}\n\n`;
  return `${body}${usage}data: [DONE]\n\n`;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const parts: Buffer[] = [];
  for await (const part of request) parts.push(part as Buffer);
  return Buffer.concat(parts).toString('utf8');
}

function scriptedModel(script: Scripted[]) {
  const bodies: string[] = [];
  const server: Server = createServer(async (request, response) => {
    bodies.push(await readBody(request));
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const index = bodies.length - 1;
    response.end(modelResponse(script[index], index));
  });
  return { bodies, server };
}

async function drainEvents(events: AsyncIterable<StepEvent>): Promise<StepEvent[]> {
  const out: StepEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise((resolve) => server.close(resolve));
});

const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

describe.runIf(process.platform === 'darwin')('pi session confinement on macOS', () => {
  test('a Pi session cannot read or write Cairn state with file tools, Bash or a script it wrote', async () => {
    const root = realpathSync(testTempDir('pi-host-'));
    const home = join(root, 'user');
    const serverHome = join(root, 'support', 'home');
    const runnerHome = join(root, 'support', 'runner');
    const worktree = join(runnerHome, 'workspaces', 'a');
    const temp = join(root, 'tmp-user', 'T');
    const agentDir = join(runnerHome, 'homes', 'pi');
    const sessionDir = join(runnerHome, 'chat-sessions');
    for (const path of [home, serverHome, worktree, temp, join(runnerHome, 'skills')])
      mkdirSync(path, { recursive: true });
    const token = join(serverHome, 'token');
    writeFileSync(token, SENTINEL);
    writeFileSync(join(runnerHome, 'machine.json'), SENTINEL);
    const escapeFile = join(root, 'escape');
    const probe = join(worktree, 'probe.sh');
    const homeNote = join(home, 'projects', 'notes.txt');
    mkdirSync(join(home, 'projects'), { recursive: true });
    writeFileSync(homeNote, 'notes outside the worktree');
    const script: Scripted[] = [
      { name: 'read', args: { path: token } },
      { name: 'edit', args: { path: token, edits: [{ oldText: 'PI-HOST', newText: 'changed' }] } },
      { name: 'bash', args: { command: `cat '${token}'` } },
      {
        name: 'bash',
        args: { command: `printf 'cat %s\\n' '${token}' > '${probe}'; sh '${probe}'` },
      },
      { name: 'bash', args: { command: `echo escaped > '${escapeFile}'` } },
      { name: 'write', args: { path: join(worktree, 'inside.txt'), content: 'allowed' } },
      { name: 'read', args: { path: homeNote } },
    ];
    const model = scriptedModel(script);
    servers.push(model.server);
    await new Promise<void>((resolve) => model.server.listen(0, '127.0.0.1', resolve));
    const { port } = model.server.address() as AddressInfo;
    const confine = createSessionConfiner({
      daemonHome: runnerHome,
      extraDeniedRoots: [serverHome],
      readable: [join(runnerHome, 'skills')],
      handoffDirectories: [],
      serverUrl: 'http://127.0.0.1:1',
      platform: 'darwin',
      home,
      environment: { TMPDIR: temp },
    });
    const backend = createPiBackend({
      agentDir,
      sessionDir,
      skills: { skillsDir: join(runnerHome, 'skills'), cwd: runnerHome },
      ...(confine !== null ? { confine } : {}),
      hostLaunch: () => ({ command: process.execPath, args: ['--import', tsx, cli, 'pi-host'] }),
    } as Parameters<typeof createPiBackend>[0]);
    const handle = await backend.createSession({
      cwd: worktree,
      provider: {
        kind: 'http',
        providerId: 'scripted',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        api: 'openai-completions',
        apiKey: 'scripted-key',
        models: [{ id: 'scripted', name: 'Scripted' }],
      },
      modelId: 'scripted',
      prompt: 'probe',
    });
    const events: StepEvent[] = [];
    for await (const event of handle.events) events.push(event);
    expect(events.at(-1)?.type).toBe('done');
    expect(model.bodies.length).toBe(script.length + 1);
    const results = (
      JSON.parse(model.bodies.at(-1) ?? '{}') as { messages: { role: string; content: unknown }[] }
    ).messages
      .filter((message) => message.role === 'tool')
      .map((message) => JSON.stringify(message.content));
    expect(results).toHaveLength(script.length);
    for (const denied of results.slice(0, -2)) expect(denied).toMatch(/not permitted/i);
    expect(results.at(-2)).not.toMatch(/not permitted|folder-grant/i);
    expect(results.at(-1)).toContain('notes outside the worktree');
    for (const body of model.bodies) expect(body).not.toContain(SENTINEL);
    expect(existsSync(escapeFile)).toBe(false);
    expect(readFileSync(token, 'utf8')).toBe(SENTINEL);
    expect(readFileSync(join(worktree, 'inside.txt'), 'utf8')).toBe('allowed');
  }, 120_000);

  test('a resumed Pi session keeps working under the profile and appends to its transcript', async () => {
    const root = realpathSync(testTempDir('pi-host-resume-'));
    const home = join(root, 'user');
    const runnerHome = join(root, 'support', 'runner');
    const worktree = join(runnerHome, 'workspaces', 'a');
    const temp = join(root, 'tmp-user', 'T');
    for (const path of [home, worktree, temp, join(runnerHome, 'skills')])
      mkdirSync(path, { recursive: true });
    const model = scriptedModel([]);
    servers.push(model.server);
    await new Promise<void>((resolve) => model.server.listen(0, '127.0.0.1', resolve));
    const { port } = model.server.address() as AddressInfo;
    const confine = createSessionConfiner({
      daemonHome: runnerHome,
      extraDeniedRoots: [],
      readable: [join(runnerHome, 'skills')],
      handoffDirectories: [],
      serverUrl: 'http://127.0.0.1:1',
      platform: 'darwin',
      home,
      environment: { TMPDIR: temp },
    });
    const files = new Map<string, string>();
    const sessionDir = join(runnerHome, 'chat-sessions');
    const backend = createPiBackend({
      agentDir: join(runnerHome, 'homes', 'pi'),
      sessionDir,
      skills: { skillsDir: join(runnerHome, 'skills'), cwd: runnerHome },
      onSession: (id, file) => {
        if (file !== undefined) files.set(id, file);
      },
      resolveSessionFile: (id) => files.get(id) ?? null,
      ...(confine !== null ? { confine } : {}),
      hostLaunch: () => ({ command: process.execPath, args: ['--import', tsx, cli, 'pi-host'] }),
    });
    const options = {
      cwd: worktree,
      provider: {
        kind: 'http' as const,
        providerId: 'scripted',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        api: 'openai-completions' as const,
        apiKey: 'scripted-key',
        models: [{ id: 'scripted', name: 'Scripted', contextWindow: 1_000_000 }],
      },
      modelId: 'scripted',
    };
    const first = await backend.createSession({ ...options, prompt: 'one' });
    expect((await drainEvents(first.events)).at(-1)?.type).toBe('done');
    const file = files.get(first.sessionId) as string;
    const before = readFileSync(file, 'utf8').length;
    const second = await backend.continueSession(first.sessionId, { ...options, prompt: 'two' });
    const events = await drainEvents(second.events);
    expect(events.filter((event) => event.type === 'error')).toEqual([]);
    expect(events.at(-1)?.type).toBe('done');
    expect(readFileSync(file, 'utf8').length).toBeGreaterThan(before);

    const templates = readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const header = templates.find((entry) => entry.type === 'session') as Record<string, unknown>;
    const templateFor = (role: string): Record<string, unknown> => {
      const entry = templates.find(
        (candidate) =>
          candidate.type === 'message' &&
          (candidate.message as { role?: string } | undefined)?.role === role,
      );
      if (entry === undefined) throw new Error(`no ${role} message in the transcript`);
      return entry.message as Record<string, unknown>;
    };
    const userTemplate = templateFor('user');
    const assistantTemplate = templateFor('assistant');
    const filler = 'x'.repeat(5_000);
    const cappedTranscript = (totalTokens: number): string => {
      const id = `capped-${totalTokens}`;
      const path = join(sessionDir, `${id}.jsonl`);
      const lines = [JSON.stringify(header)];
      let parentId: string | null = null;
      for (let turn = 0; turn < 30; turn++) {
        const userId = `cap-user-${turn}`;
        lines.push(
          JSON.stringify({
            type: 'message',
            id: userId,
            parentId,
            timestamp: new Date(turn * 2).toISOString(),
            message: {
              ...userTemplate,
              content: [{ type: 'text', text: `${filler} turn ${turn}` }],
              timestamp: turn * 2,
            },
          }),
        );
        const assistantId = `cap-assistant-${turn}`;
        const usage = assistantTemplate.usage as Record<string, number>;
        lines.push(
          JSON.stringify({
            type: 'message',
            id: assistantId,
            parentId: userId,
            timestamp: new Date(turn * 2 + 1).toISOString(),
            message: {
              ...assistantTemplate,
              content: [{ type: 'text', text: `${filler} reply ${turn}` }],
              usage: { ...usage, totalTokens: turn === 29 ? totalTokens : usage.totalTokens },
              timestamp: turn * 2 + 1,
            },
          }),
        );
        parentId = assistantId;
      }
      writeFileSync(path, `${lines.join('\n')}\n`);
      files.set(id, path);
      return id;
    };
    const resumeCapped = async (totalTokens: number): Promise<StepEvent[]> => {
      const capped = await backend.continueSession(cappedTranscript(totalTokens), {
        ...options,
        compactAt: COORDINATOR_COMPACT_AT,
        prompt: 'capped',
      });
      return drainEvents(capped.events);
    };

    const atPoint = await resumeCapped(COORDINATOR_COMPACT_AT);
    expect(atPoint.some((event) => event.type === 'compaction_start')).toBe(true);
    expect(atPoint.at(-1)?.type).toBe('done');
    const beforePoint = await resumeCapped(COORDINATOR_COMPACT_AT - 1);
    expect(beforePoint.some((event) => event.type === 'compaction_start')).toBe(false);
    expect(beforePoint.at(-1)?.type).toBe('done');
  }, 300_000);

  test('a resume file replaced by a symlink is refused instead of exposing its target', async () => {
    const root = realpathSync(testTempDir('pi-host-resume-link-'));
    const home = join(root, 'user');
    const runnerHome = join(root, 'support', 'runner');
    const worktree = join(runnerHome, 'workspaces', 'a');
    const temp = join(root, 'tmp-user', 'T');
    const sessionDir = join(runnerHome, 'chat-sessions');
    const pivot = join(root, 'pivot');
    for (const path of [home, worktree, temp, sessionDir, pivot])
      mkdirSync(path, { recursive: true });
    const resumeFile = join(sessionDir, 'session.jsonl');
    writeFileSync(join(pivot, 'session.jsonl'), 'x');
    symlinkSync(join(pivot, 'session.jsonl'), resumeFile);
    const confine = createSessionConfiner({
      daemonHome: runnerHome,
      extraDeniedRoots: [],
      readable: [],
      handoffDirectories: [],
      serverUrl: 'http://127.0.0.1:1',
      platform: 'darwin',
      home,
      environment: { TMPDIR: temp },
    });
    await expect(
      openPiHostSession({
        backend: { agentDir: join(runnerHome, 'homes', 'pi'), sessionDir },
        confine: confine as NonNullable<typeof confine>,
        launch: { command: '/bin/true', args: [] },
        opts: {
          cwd: worktree,
          env: {},
          provider: { kind: 'http', providerId: 'x' },
          modelId: 'm',
        },
        resumeFile,
      } as Parameters<typeof openPiHostSession>[0]),
    ).rejects.toThrow('Pi session confinement failed: Unsafe confinement symlink');
  });
});
