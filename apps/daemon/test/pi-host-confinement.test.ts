import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { StepEvent } from '@cairn/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { createSessionConfiner } from '../src/backend/confine-session.js';
import { createPiBackend } from '../src/backend/pi.js';
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
    const backend = createPiBackend({
      agentDir: join(runnerHome, 'homes', 'pi'),
      sessionDir: join(runnerHome, 'chat-sessions'),
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
        models: [{ id: 'scripted', name: 'Scripted' }],
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
  }, 120_000);
});
