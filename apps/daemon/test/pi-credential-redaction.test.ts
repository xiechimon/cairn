import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { SessionOpts, StepEvent } from '@cairn/shared';
import { parseOtlpTarget, stepOtelContext } from '@cairn/shared/otel';
import { afterEach, expect, test, vi } from 'vitest';
import { createPiBackend, type PiBackendOpts } from '../src/backend/pi.js';
import { testTempDir } from './test-temp-dir.js';

const STEP_SECRET = 'step-credential-plain-value-7f3a';

interface CapturedSpan {
  name: string;
  attributes: { key: string; value: { stringValue?: string } }[];
}

const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function chunk(delta: Record<string, unknown>, finish: string | null) {
  return `data: ${JSON.stringify({
    id: 'c1',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'scripted',
    choices: [{ index: 0, delta, finish_reason: finish }],
    usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
  })}\n\n`;
}

function scriptedModel(script: ('tool' | 'done')[]) {
  let count = 0;
  return async (
    request: import('node:http').IncomingMessage,
    response: import('node:http').ServerResponse,
  ) => {
    for await (const _chunk of request) void _chunk;
    const step = script[count] ?? 'done';
    count += 1;
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const body =
      step === 'tool'
        ? chunk(
            {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: `call_${count}`,
                  type: 'function',
                  function: { name: 'lookup', arguments: '{}' },
                },
              ],
            },
            'tool_calls',
          )
        : chunk({ role: 'assistant', content: 'done' }, 'stop');
    response.end(`${body}data: [DONE]\n\n`);
  };
}

async function drain(events: AsyncIterable<StepEvent>): Promise<StepEvent[]> {
  const out: StepEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

const LEAKY_MCP = join(import.meta.dirname, 'fixtures', 'leaky-mcp-server.mjs');

function sessionOpts(cwd: string, baseUrl: string, extra: Partial<SessionOpts>): SessionOpts {
  return {
    cwd,
    provider: {
      kind: 'http',
      providerId: 'scripted',
      baseUrl: `${baseUrl}/v1`,
      api: 'openai-completions',
      models: [{ id: 'scripted', name: 'Scripted' }],
    },
    modelId: 'scripted',
    prompt: 'go',
    ...extra,
  };
}

test('a step credential in a tool result is scrubbed from exported spans', async () => {
  const spans: CapturedSpan[] = [];
  const collector = await listen(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString()) as {
      resourceSpans: { scopeSpans: { spans: CapturedSpan[] }[] }[];
    };
    spans.push(...body.resourceSpans.flatMap((r) => r.scopeSpans.flatMap((s) => s.spans)));
    response.end('{}');
  });
  const baseUrl = await listen(scriptedModel(['tool', 'done']));
  const directory = testTempDir('pi-cred-span-');
  const telemetry = stepOtelContext(
    'cred-build',
    'cred-step',
    parseOtlpTarget({ CAIRN_OTEL_ENDPOINT: collector })!,
  );
  const handle = await createPiBackend({
    agentDir: join(directory, 'agent'),
    sessionDir: join(directory, 'sessions'),
  }).createSession(
    sessionOpts(directory, baseUrl, {
      telemetry,
      secrets: () => [STEP_SECRET],
      remoteToolsOnly: true,
      remoteTools: [
        { name: 'lookup', description: 'Look up', parameters: { type: 'object', properties: {} } },
      ],
      executeRemoteTool: async () => `fetched ${STEP_SECRET}`,
    }),
  );
  try {
    await drain(handle.events);
    await vi.waitFor(
      () => expect(spans.some((span) => span.name.startsWith('execute_tool'))).toBe(true),
      { timeout: 15_000 },
    );
    const exported = JSON.stringify(spans);
    expect(exported).not.toContain(STEP_SECRET);
    expect(exported).toContain('[REDACTED]');
  } finally {
    await handle.stop();
  }
});

test('an MCP connect failure reaches the log callback with the step redactor applied', async () => {
  const mcp = await listen((_request, response) => {
    response.writeHead(400, { 'content-type': 'text/plain' });
    response.end(`token ${STEP_SECRET} rejected`);
  });
  const baseUrl = await listen(scriptedModel(['done']));
  const directory = testTempDir('pi-cred-mcp-');
  const lines: string[] = [];
  const backendOpts: PiBackendOpts = {
    agentDir: join(directory, 'agent'),
    sessionDir: join(directory, 'sessions'),
    onMcpLog: (line) => lines.push(line),
  };
  const handle = await createPiBackend(backendOpts).createSession(
    sessionOpts(directory, baseUrl, {
      mcpServers: [{ slug: 'leaky', transport: 'http', url: `${mcp}/mcp` }],
      secrets: () => [STEP_SECRET],
    }),
  );
  try {
    const drained = drain(handle.events);
    await vi.waitFor(() => expect(lines.some((line) => line.startsWith('leaky:'))).toBe(true), {
      timeout: 20_000,
    });
    await drained;
    const joined = lines.join('\n');
    expect(joined).not.toContain(STEP_SECRET);
    expect(joined).toContain('[REDACTED]');
  } finally {
    await handle.stop();
  }
});

test('an MCP server log message never writes the step credential to the daemon MCP log', async () => {
  const baseUrl = await listen(scriptedModel(['done']));
  const directory = testTempDir('pi-cred-mcp-log-');
  const agentDir = join(directory, 'agent');
  const handle = await createPiBackend({
    agentDir,
    sessionDir: join(directory, 'sessions'),
  }).createSession(
    sessionOpts(directory, baseUrl, {
      secrets: () => [STEP_SECRET],
      mcpServers: [
        {
          slug: 'leaky',
          transport: 'stdio',
          command: process.execPath,
          args: [LEAKY_MCP],
          env: { MCP_FIXTURE_SECRET: STEP_SECRET },
        },
      ],
    }),
  );
  try {
    await drain(handle.events);
  } finally {
    await handle.stop();
  }
  const logPath = join(agentDir, 'mcp.log');
  await vi.waitFor(() => expect(existsSync(logPath)).toBe(true), { timeout: 15_000 });
  const written = readFileSync(logPath, 'utf8');
  expect(written).toContain('[leaky]');
  expect(written).not.toContain(STEP_SECRET);
  expect(written).toContain('[REDACTED]');
});
