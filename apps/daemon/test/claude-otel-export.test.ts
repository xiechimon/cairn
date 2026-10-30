import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { SessionOpts, StepEvent } from '@cairn/shared';
import { type OtlpTracesRequest, parseOtlpTarget, stepOtelContext } from '@cairn/shared/otel';
import { afterEach, expect, test, vi } from 'vitest';
import { createClaudeCodeBackend } from '../src/backend/claude-code.js';

const secret = `sk-ant-oat01-${'synthetic'.repeat(8)}`;
const cli = `
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
Object.assign(process.env, JSON.parse(readFileSync('.claude/settings.json', 'utf8')).env);
const settings = process.argv.indexOf('--settings');
if (settings >= 0) Object.assign(process.env, JSON.parse(process.argv[settings + 1]).env);
const input = createInterface({ input: process.stdin });
for await (const line of input) {
  const message = JSON.parse(line);
  if (message.type === 'control_request') {
    send({ type: 'control_response', response: {
      subtype: 'success', request_id: message.request_id, response: { commands: [] }
    } });
  }
  if (message.type !== 'user') continue;
  writeFileSync(process.env.TEST_ENV_FILE, JSON.stringify(process.env));
  const result = execFileSync(process.execPath, ['-e',
    'process.stdout.write(' + JSON.stringify(process.env.TEST_TOOL_OUTPUT) + ')'
  ], { encoding: 'utf8' });
  if (process.env.CLAUDE_CODE_ENABLE_TELEMETRY === '1' &&
      process.env.OTEL_SDK_DISABLED !== 'true') {
    const endpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT + '/v1/traces';
    await fetch(endpoint, { method: 'POST', body: JSON.stringify({ tool_output: result }) });
  }
  send({ type: 'assistant', message: { role: 'assistant', content: [
    { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: process.env.TEST_TOOL_OUTPUT } }
  ] } });
  send({ type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [
    { type: 'tool_result', tool_use_id: 'tool-1', content: result, is_error: false }
  ] } });
  if (process.env.TEST_COMPLETION === 'crash') throw new Error('Synthetic CLI crash');
  if (process.env.TEST_COMPLETION !== 'eof') {
    send({ type: 'result', subtype: process.env.TEST_COMPLETION,
      is_error: process.env.TEST_COMPLETION !== 'success', errors: ['Synthetic CLI failure'] });
  }
  break;
}
input.close();
`;

afterEach(() => vi.unstubAllEnvs());

async function runCli(completion: string, configured = true, status = 200, token = secret) {
  const directory = mkdtempSync(join(tmpdir(), 'cairn-claude-otel-'));
  const executablePath = join(directory, 'cli.mjs');
  const envFile = join(directory, 'env.json');
  writeFileSync(executablePath, cli);
  const requests: { body: string; authorization?: string }[] = [];
  let responseSent = false;
  const collector = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push({
      body: Buffer.concat(chunks).toString(),
      ...(request.headers.authorization !== undefined
        ? { authorization: request.headers.authorization }
        : {}),
    });
    if (status === 0) await delay(500);
    responseSent = true;
    response.writeHead(status || 200).end('{}');
  });
  collector.listen(0, '127.0.0.1');
  await once(collector, 'listening');
  const address = collector.address();
  if (address === null || typeof address === 'string') throw new Error('No collector port');
  const endpoint = `http://127.0.0.1:${address.port}`;
  mkdirSync(join(directory, '.claude'));
  writeFileSync(
    join(directory, '.claude', 'settings.json'),
    JSON.stringify({
      env: {
        CLAUDE_CODE_ENABLE_TELEMETRY: '1',
        OTEL_SDK_DISABLED: 'false',
        OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
      },
    }),
  );
  vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', endpoint);
  vi.stubEnv('CLAUDE_CODE_ENABLE_TELEMETRY', '1');
  const telemetry = stepOtelContext(
    'synthetic-build',
    'synthetic-step',
    parseOtlpTarget({
      CAIRN_OTEL_ENDPOINT: endpoint,
      CAIRN_OTEL_HEADERS: 'authorization=synthetic-exporter-key',
    })!,
  );
  const opts: SessionOpts = {
    provider: { kind: 'api_key', providerId: 'anthropic' },
    modelId: 'synthetic-model',
    cwd: directory,
    prompt: 'Run the synthetic tool.',
    env: {
      HOME: directory,
      CLAUDE_CONFIG_DIR: join(directory, 'config'),
      TEST_ENV_FILE: envFile,
      TEST_TOOL_OUTPUT: `Tool output: ${token}`,
      TEST_COMPLETION: completion,
      CLAUDE_CODE_OAUTH_TOKEN: token,
      CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1',
      CLAUDE_CODE_ENABLE_TELEMETRY: '1',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${endpoint}/v1/traces`,
      OTEL_LOGS_EXPORTER: 'otlp',
    },
    ...(configured ? { telemetry } : {}),
  };
  const handle = await createClaudeCodeBackend({ executablePath }).createSession(opts);
  try {
    const events: StepEvent[] = [];
    for await (const event of handle.events) events.push(event);
    if (configured) await vi.waitFor(() => expect(requests).toHaveLength(1));
    return {
      requests,
      events,
      telemetry,
      childEnv: JSON.parse(readFileSync(envFile, 'utf8')) as Record<string, string>,
      completedBeforeResponse: !responseSent,
    };
  } finally {
    await handle.stop();
    await new Promise<void>((resolve, reject) =>
      collector.close((error) => (error ? reject(error) : resolve())),
    );
    rmSync(directory, { recursive: true, force: true });
  }
}

test.each(['success', 'error', 'eof', 'crash'])(
  'CLI tool output is redacted on the OTLP wire after %s',
  async (completion) => {
    const { requests, events, telemetry, childEnv } = await runCli(completion);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'toolcall_end',
        call: expect.objectContaining({ result: `Tool output: ${secret}` }),
      }),
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]!.body).toContain('[REDACTED]');
    expect(requests[0]!.body).not.toContain(secret);
    expect(requests[0]!.authorization).toBe('synthetic-exporter-key');
    const payload = JSON.parse(requests[0]!.body) as OtlpTracesRequest;
    const spans = payload.resourceSpans.flatMap((resource) =>
      resource.scopeSpans.flatMap((scope) => scope.spans),
    );
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({
      name: 'execute_tool Bash',
      traceId: telemetry.traceId,
      parentSpanId: telemetry.stepSpanId,
    });
    expect(spans[0]!.attributes).toContainEqual({
      key: 'gen_ai.tool.call.result',
      value: { stringValue: 'Tool output: [REDACTED]' },
    });
    expect(childEnv.CLAUDE_CODE_ENABLE_TELEMETRY).toBe('0');
    expect(childEnv.OTEL_SDK_DISABLED).toBe('true');
    expect(childEnv.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT).toBeUndefined();
    expect(childEnv.OTEL_EXPORTER_OTLP_HEADERS).toBeUndefined();
    expect(childEnv.CLAUDE_CODE_OAUTH_TOKEN).toBe(secret);
    expect(childEnv.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB).toBe('1');
  },
);

test('unconfigured telemetry cannot inherit a direct CLI exporter', async () => {
  const { requests, events } = await runCli('success', false);
  expect(requests).toEqual([]);
  expect(events.at(-1)?.type).toBe('done');
});

test('a failed collector does not fail the CLI session', async () => {
  const { requests, events } = await runCli('success', true, 503);
  expect(requests).toHaveLength(1);
  expect(requests[0]!.body).not.toContain(secret);
  expect(events.at(-1)?.type).toBe('done');
});

test('the exact credential redactor also covers tokens outside the shared secret patterns', async () => {
  const token = 'synthetic-credential-without-a-standard-prefix';
  const { requests } = await runCli('success', true, 200, token);
  expect(requests[0]!.body).toContain('[REDACTED]');
  expect(requests[0]!.body).not.toContain(token);
});

test('a stalled collector cannot delay CLI session completion', async () => {
  const { completedBeforeResponse } = await runCli('success', true, 0);
  expect(completedBeforeResponse).toBe(true);
});
