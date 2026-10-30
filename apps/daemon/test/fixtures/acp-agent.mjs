import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const scenario = process.argv[2] ?? 'complete';
const sessionId = 'acp-session-2290';
const send = (value) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...value })}\n`);
const update = (value, id = sessionId) =>
  send({ method: 'session/update', params: { sessionId: id, update: value } });
let pending;
let host;
let configured = false;
if (['ignore-term', 'descendant'].includes(scenario)) process.on('SIGTERM', () => {});

for await (const line of createInterface({ input: process.stdin })) {
  const { id, method, params, result } = JSON.parse(line);
  if (method === 'initialize') {
    if (scenario === 'hang-init') continue;
    send({
      id,
      result: {
        protocolVersion: scenario === 'bad-version' ? 99 : params.protocolVersion,
        agentCapabilities: {
          mcpCapabilities: { http: true },
          loadSession: scenario === 'load',
          sessionCapabilities: scenario === 'resume' ? { resume: {} } : {},
          promptCapabilities: { image: scenario === 'image' },
        },
        authMethods: [],
      },
    });
  } else if (['session/new', 'session/load', 'session/resume'].includes(method)) {
    if (method !== 'session/new') {
      update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'history' } });
    }
    host = params.mcpServers[0];
    send({
      id,
      result: {
        sessionId,
        configOptions:
          scenario === 'no-model'
            ? []
            : [
                {
                  id: 'model',
                  name: 'Model',
                  category: 'model',
                  type: 'select',
                  currentValue: 'other',
                  options: [{ value: 'stub-model', name: 'Stub' }],
                },
              ],
      },
    });
  } else if (method === 'session/set_config_option') {
    if (params.value !== 'stub-model') throw new Error('Wrong model');
    configured = true;
    send({ id, result: { configOptions: [] } });
  } else if (method === 'session/prompt') {
    if (!configured) throw new Error('Model was not configured before prompting');
    if (!params.prompt.some((block) => block.type === 'text' && block.text.includes('Hello'))) {
      throw new Error('Prompt text was dropped');
    }
    if (scenario === 'host-tools') {
      const request = async (method, params = {}, authorized = true) => {
        const response = await fetch(host.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            ...(authorized
              ? Object.fromEntries(host.headers.map(({ name, value }) => [name, value]))
              : {}),
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 'host', method, params }),
        });
        if (!authorized) {
          if (response.status !== 401) throw new Error('MCP accepts unauthenticated requests');
          return;
        }
        return response.json();
      };
      await request('tools/list', {}, false);
      await request('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'fake-acp', version: '1' },
      });
      const listed = await request('tools/list');
      if (listed.result.tools.length !== 2) throw new Error('Host tools missing');
      for (const name of ['remote', 'local']) {
        const called = await request('tools/call', { name, arguments: { text: 'input' } });
        if (called.result.content[0].text !== `${name} output`)
          throw new Error('Host tool result lost');
      }
      const unknown = await request('tools/call', { name: 'unknown' });
      if (!unknown.error) throw new Error('Undeclared tool was allowed');
    }
    if (scenario === 'descendant') {
      const descendant = spawn(
        process.execPath,
        [
          '-e',
          "process.on('SIGTERM', () => {}); process.stdout.write('ready'); setInterval(() => {}, 1000)",
        ],
        { stdio: ['ignore', 'pipe', 'ignore'] },
      );
      await new Promise((resolve) => descendant.stdout.once('data', resolve));
      pending = id;
      update({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: String(descendant.pid) },
      });
      continue;
    }
    if (['cancel', 'ignore-cancel', 'ignore-term'].includes(scenario)) {
      pending = id;
      update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'started' } });
      continue;
    }
    if (['permission', 'permission-allow'].includes(scenario)) {
      pending = id;
      send({
        id: 'permission',
        method: 'session/request_permission',
        params: {
          sessionId,
          toolCall: { toolCallId: 'read-1', title: 'Read' },
          options: [
            { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
            { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
          ],
        },
      });
      continue;
    }
    if (
      scenario === 'image' &&
      !params.prompt.some((b) => b.type === 'image' && b.data === 'aA==')
    ) {
      throw new Error('Image was dropped');
    }
    update(
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'foreign' } },
      'other-session',
    );
    update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Thinking' } });
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello ' } });
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Thread' } });
    if (scenario === 'crash') process.exit(7);
    update({
      sessionUpdate: 'tool_call',
      toolCallId: 'read-1',
      title: 'Read',
      kind: 'read',
      rawInput: { path: 'README.md' },
      status: 'pending',
    });
    update({ sessionUpdate: 'tool_call_update', toolCallId: 'read-1', status: 'in_progress' });
    if (scenario === 'partial-tool')
      update({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'read-1',
        content: [{ type: 'content', content: { type: 'text', text: 'partial output' } }],
        rawOutput: 'partial output',
      });
    if (scenario !== 'unfinished')
      update({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'read-1',
        status: scenario === 'tool-failed' ? 'failed' : 'completed',
        ...(!['partial-tool', 'empty-tool'].includes(scenario)
          ? { rawOutput: 'file content' }
          : {}),
      });
    update({ sessionUpdate: 'usage_update', used: 50, size: 1000 });
    send({
      id,
      result: {
        stopReason:
          scenario === 'agent-cancelled'
            ? 'cancelled'
            : ['refusal', 'max_tokens', 'max_turn_requests'].includes(scenario)
              ? scenario
              : 'end_turn',
      },
    });
  } else if (
    method === 'session/cancel' &&
    !['ignore-cancel', 'ignore-term', 'descendant'].includes(scenario)
  ) {
    send({ id: pending, result: { stopReason: 'cancelled' } });
  } else if (id === 'permission') {
    send({
      id: pending,
      result: {
        stopReason:
          result.outcome.optionId === (scenario === 'permission-allow' ? 'allow' : 'deny')
            ? 'end_turn'
            : 'refusal',
      },
    });
  }
}
