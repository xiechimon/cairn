import { once } from 'node:events';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { SessionOpts, StepEvent } from '@cairn/shared';
import { parseOtlpTarget, stepOtelContext } from '@cairn/shared/otel';
import { afterEach, expect, test, vi } from 'vitest';
import { createClaudeCodeBackend } from '../src/backend/claude-code.js';
import { flushDaemonOtel, shutdownDaemonOtel } from '../src/backend/otel.js';
import { testTempDir } from './test-temp-dir.js';

interface OtlpTracesRequest {
  resourceSpans: {
    scopeSpans: {
      spans: {
        name: string;
        traceId: string;
        parentSpanId?: string;
        attributes: { key: string; value: unknown }[];
      }[];
    }[];
  }[];
}

const secret = `sk-ant-oat01-${'synthetic'.repeat(8)}`;
const cli = `
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
const userSettings = process.env.CLAUDE_CONFIG_DIR + '/settings.json';
if (existsSync(userSettings)) Object.assign(process.env, JSON.parse(readFileSync(userSettings, 'utf8')).env);
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
  if (process.env.ENABLE_BETA_TRACING_DETAILED && process.env.BETA_TRACING_ENDPOINT) {
    await fetch(process.env.BETA_TRACING_ENDPOINT + '/beta/v1/traces', {
      method: 'POST', body: JSON.stringify({ tool_output: result }),
    });
  }
  const generation = Number(process.env.TEST_GENERATIONS) > 0;
  const stream = (event) => send({ type: 'stream_event', parent_tool_use_id: null, event });
  if (generation) {
    stream({ type: 'message_start', message: {
      id: 'model-call-1', model: 'resolved-model', role: 'assistant', content: [],
      usage: { input_tokens: 7, output_tokens: 1, cache_read_input_tokens: 11, cache_creation_input_tokens: 13 }
    } });
    send({ type: 'assistant', parent_tool_use_id: null, message: {
      id: 'model-call-1', model: 'resolved-model', role: 'assistant',
      content: [{ type: 'thinking', thinking: 'Check the synthetic tool.' }],
      usage: { input_tokens: 7, output_tokens: 1 }
    } });
  }
  send({ type: 'assistant', message: { role: 'assistant', content: [
    { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: process.env.TEST_TOOL_OUTPUT } }
  ], ...(generation ? { id: 'model-call-1', model: 'resolved-model' } : {}) } });
  if (generation) {
    stream({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 17 } });
    stream({ type: 'message_stop' });
  }
  send({ type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [
    { type: 'tool_result', tool_use_id: 'tool-1', content: result, is_error: false }
  ] } });
  if (generation) {
    stream({ type: 'message_start', message: {
      id: 'model-call-2', model: 'resolved-model', role: 'assistant', content: [],
      usage: { input_tokens: 19, output_tokens: 1, cache_read_input_tokens: 23, cache_creation_input_tokens: 29 }
    } });
    send({ type: 'assistant', parent_tool_use_id: null, message: {
      id: 'model-call-2', model: 'resolved-model', role: 'assistant',
      content: [{ type: 'text', text: result }], usage: { input_tokens: 19, output_tokens: 1 }
    } });
    stream({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 31 } });
    stream({ type: 'message_stop' });
  }
  if (generation && process.env.OTEL_SDK_DISABLED !== 'true') {
    const attribute = ([key, value]) => ({ key, value: typeof value === 'number'
      ? { intValue: value } : typeof value === 'boolean' ? { boolValue: value } : { stringValue: value } });
    const post = (signal, body) => fetch(process.env.OTEL_EXPORTER_OTLP_ENDPOINT + '/v1/' + signal,
      { method: 'POST', body: JSON.stringify(body) });
    const logs = (values) => ({ resourceLogs: [{ scopeLogs: [{ logRecords: values.map(
      (value) => ({ attributes: Object.entries(value).map(attribute) })
    ) }] }] });
    const count = Number(process.env.TEST_GENERATIONS);
    const requests = [];
    const responses = [];
    const native = [];
    for (let index = 0; index < count; index++) {
      const summary = index === 2;
      const source = summary ? 'compact' : 'sdk';
      requests.push({ 'event.name': 'api_request_body', request_body_id: 'body-' + index,
        query_source: source, body: JSON.stringify({ model: 'native-request-model',
          system: 'Synthetic CLI system.', messages: [{ role: 'user', content: summary
            ? 'PRIVATE_SUMMARY_INPUT' : 'Run the synthetic tool.' },
            ...(index === 1 ? [{ role: 'user', content: result }] : [])] }) });
      responses.push({ 'event.name': 'api_response_body', request_body_id: 'body-' + index,
        request_id: 'req-' + index, query_source: source,
        body: JSON.stringify({ model: 'resolved-model', role: 'assistant', content: [{ type: 'text',
          text: summary ? 'PRIVATE_SUMMARY_OUTPUT' : index === 0 ? 'Check the synthetic tool.' : result }] }) });
      native.push({ name: 'claude_code.llm_request', spanId: 'native-' + index,
        startTimeUnixNano: String(1700000000000000000 + index * 1000000000),
        endTimeUnixNano: String(1700000000500000000 + index * 1000000000),
        attributes: Object.entries({ model: 'native-request-model', request_id: 'req-' + index,
          input_tokens: index === 0 ? 7 : 19, cache_read_tokens: index === 0 ? 11 : 23,
          cache_creation_tokens: index === 0 ? 13 : 29, output_tokens: index === 0 ? 17 : 31,
          success: true, stop_reason: index === 0 ? 'tool_use' : 'end_turn' }).map(attribute) });
    }
    const traces = { resourceSpans: [{ scopeSpans: [{ spans: native }] }] };
    await post('traces', traces);
    await post('logs', logs(responses.reverse()));
    await post('logs', logs(requests.reverse()));
    await post('traces', traces);
  }
  if (process.env.TEST_COMPLETION === 'crash') throw new Error('Synthetic CLI crash');
  if (process.env.TEST_COMPLETION !== 'eof') {
    send({ type: 'result', subtype: process.env.TEST_COMPLETION,
      is_error: process.env.TEST_COMPLETION !== 'success', errors: ['Synthetic CLI failure'] });
  }
  break;
}
input.close();
`;

afterEach(async () => {
  vi.unstubAllEnvs();
  await shutdownDaemonOtel();
});

async function runCli(
  completion: string,
  configured = true,
  status = 200,
  token = secret,
  generations = 0,
  credentialKey = 'CLAUDE_CODE_OAUTH_TOKEN',
  stepSecrets: readonly string[] = [],
) {
  const directory = testTempDir('cairn-claude-otel-');
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
  mkdirSync(join(directory, 'config'));
  writeFileSync(
    join(directory, 'config', 'settings.json'),
    JSON.stringify({
      env: { ENABLE_BETA_TRACING_DETAILED: '1', BETA_TRACING_ENDPOINT: endpoint },
    }),
  );
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
  vi.stubEnv('ENABLE_BETA_TRACING_DETAILED', '1');
  vi.stubEnv('BETA_TRACING_ENDPOINT', endpoint);
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
      TEST_TOOL_OUTPUT: `Tool output: ${token}${stepSecrets.length > 0 ? ` ${stepSecrets.join(' ')}` : ''}`,
      TEST_COMPLETION: completion,
      TEST_GENERATIONS: String(generations),
      [credentialKey]: token,
      CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1',
      CLAUDE_CODE_ENABLE_TELEMETRY: '1',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${endpoint}/v1/traces`,
      OTEL_LOGS_EXPORTER: 'otlp',
    },
    ...(stepSecrets.length > 0 ? { secrets: () => stepSecrets } : {}),
    ...(configured ? { telemetry } : {}),
  };
  const handle = await createClaudeCodeBackend({ executablePath }).createSession(opts);
  try {
    const events: StepEvent[] = [];
    for await (const event of handle.events) events.push(event);
    if (configured)
      await vi.waitFor(() => {
        if (generations > 0) {
          const spans = requests.flatMap((request) =>
            (JSON.parse(request.body) as OtlpTracesRequest).resourceSpans.flatMap((resource) =>
              resource.scopeSpans.flatMap((scope) => scope.spans),
            ),
          );
          expect(spans.filter((span) => span.name.startsWith('chat '))).toHaveLength(generations);
        } else expect(requests).toHaveLength(1);
      });
    return {
      requests,
      events,
      telemetry,
      childEnv: JSON.parse(readFileSync(envFile, 'utf8')) as Record<string, string>,
      completedBeforeResponse: !responseSent,
    };
  } finally {
    await handle.stop();
    await flushDaemonOtel();
    collector.closeAllConnections();
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
    expect(childEnv.CLAUDE_CODE_ENABLE_TELEMETRY).toBe('1');
    expect(childEnv.OTEL_SDK_DISABLED).toBe('false');
    expect(childEnv.OTEL_EXPORTER_OTLP_ENDPOINT).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9-]+$/);
    expect(childEnv.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT).toBe(
      `${childEnv.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`,
    );
    expect(childEnv.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT).toBe(
      `${childEnv.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/logs`,
    );
    expect(childEnv.OTEL_EXPORTER_OTLP_HEADERS).toBe('');
    expect(childEnv.BETA_TRACING_ENDPOINT).toBe('');
    expect(childEnv.ENABLE_BETA_TRACING_DETAILED).toBe('0');
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
  const { requests, events } = await runCli('success', true, 500);
  expect(requests).toHaveLength(1);
  expect(requests[0]!.body).not.toContain(secret);
  expect(events.at(-1)?.type).toBe('done');
});

test.each(['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'])(
  'the exact %s redactor covers native bodies outside the shared secret patterns',
  async (credentialKey) => {
    const token = 'synthetic-credential-without-a-standard-prefix';
    const { requests } = await runCli('success', true, 200, token, 2, credentialKey);
    const body = requests.map((request) => request.body).join('');
    expect(body).toContain('[REDACTED]');
    expect(body).not.toContain(token);
  },
);

test('step credentials outside the provider env are scrubbed from exported spans', async () => {
  const stepSecret = 'step-credential-plain-value-9q2w';
  const { requests } = await runCli('success', true, 200, secret, 0, 'CLAUDE_CODE_OAUTH_TOKEN', [
    stepSecret,
  ]);
  const body = requests.map((request) => request.body).join('');
  expect(body).not.toContain(stepSecret);
  expect(body).toContain('[REDACTED]');
});

test('a stalled collector cannot delay CLI session completion', async () => {
  const { completedBeforeResponse } = await runCli('success', true, 0);
  expect(completedBeforeResponse).toBe(true);
});

test.each([2, 3])(
  'native capture exports %i real calls once despite reordered batches, without summary content',
  async (count) => {
    const { requests, telemetry } = await runCli('success', true, 200, secret, count);
    const chats = requests
      .flatMap((request) =>
        (JSON.parse(request.body) as OtlpTracesRequest).resourceSpans.flatMap((resource) =>
          resource.scopeSpans.flatMap((scope) => scope.spans),
        ),
      )
      .filter((span) => span.name.startsWith('chat '));
    expect(chats).toHaveLength(count);
    for (const chat of chats) {
      expect(chat).toMatchObject({
        name: 'chat resolved-model',
        traceId: telemetry.traceId,
        parentSpanId: telemetry.stepSpanId,
      });
      const attrs = Object.fromEntries(chat.attributes.map((entry) => [entry.key, entry.value]));
      expect(attrs['gen_ai.response.model']).toEqual({ stringValue: 'resolved-model' });
      if (attrs['langfuse.observation.input'] === undefined) {
        expect(count).toBe(3);
        expect(attrs['langfuse.observation.output']).toBeUndefined();
        continue;
      }
      const first = JSON.stringify(attrs['langfuse.observation.output']).includes(
        'Check the synthetic tool.',
      );
      expect(attrs['gen_ai.usage.input_tokens']).toEqual({ intValue: first ? 31 : 71 });
      expect(attrs['gen_ai.usage.output_tokens']).toEqual({ intValue: first ? 17 : 31 });
      expect(JSON.stringify(attrs['langfuse.observation.input'])).toContain(
        'Run the synthetic tool.',
      );
      if (!first) {
        expect(JSON.stringify(attrs['langfuse.observation.input'])).toContain(
          'Tool output: [REDACTED]',
        );
      }
      expect(JSON.stringify(attrs['langfuse.observation.output'])).toContain(
        first ? 'Check the synthetic tool.' : 'Tool output: [REDACTED]',
      );
    }
    expect(requests.map((request) => request.body).join('')).not.toContain(secret);
    expect(requests.map((request) => request.body).join('')).not.toContain('PRIVATE_SUMMARY');
  },
);
