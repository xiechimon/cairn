import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const scenario = process.argv[2] ?? 'complete';
const devin = scenario.startsWith('devin');
const gate = scenario.endsWith('gate');
const ask = scenario === 'ask-gate';
const gateWaiters = new Map();
let mode = null;
let sessionMeta = null;
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
  if (method === undefined && gateWaiters.has(id)) {
    gateWaiters.get(id)(result);
    gateWaiters.delete(id);
    continue;
  }
  if (method === 'initialize') {
    if (scenario === 'hang-init') continue;
    send({
      id,
      result: {
        protocolVersion: scenario === 'bad-version' ? 99 : params.protocolVersion,
        agentCapabilities: {
          mcpCapabilities: { http: true },
          loadSession: scenario === 'load' || devin,
          sessionCapabilities: scenario === 'resume' ? { resume: {} } : {},
          promptCapabilities: { image: scenario === 'image' || devin },
        },
        authMethods: [],
        ...(devin ? { _meta: { 'cognition.ai/midTurnPrompts': true } } : {}),
      },
    });
  } else if (['session/new', 'session/load', 'session/resume'].includes(method)) {
    if (method !== 'session/new') {
      update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'history' } });
    }
    host = params.mcpServers[0];
    sessionMeta = params._meta ?? null;
    send({
      id,
      result: {
        sessionId,
        modes: {
          currentModeId: ask ? 'default' : gate ? (devin ? 'bypass' : 'full-access') : 'read-only',
          availableModes: ask
            ? [{ id: 'default', name: 'Default' }]
            : gate
            ? devin
              ? [
                  { id: 'bypass', name: 'Bypass' },
                  { id: 'normal', name: 'Normal' },
                ]
              : [
                  { id: 'full-access', name: 'Full access' },
                  { id: 'read-only', name: 'Read only' },
                ]
            : devin
              ? [{ id: 'bypass', name: 'Bypass' }]
              : [{ id: 'full-access', name: 'Full access' }],
        },
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
                  options: devin
                    ? [
                        { value: 'stub-model', name: 'Stub Model' },
                        {
                          value: 'swe-2-high',
                          name: 'SWE-2',
                          _meta: { 'cognition.ai/supportsImages': true },
                        },
                        { value: 'swe-2-flash-medium', name: 'SWE-2 Flash' },
                        { value: 'swe-2-high', name: 'SWE-2 renamed' },
                        {
                          group: 'legacy',
                          name: 'Legacy',
                          options: [
                            { value: 'adaptive', name: '' },
                            { value: '', name: 'Empty value' },
                          ],
                        },
                      ]
                    : [{ value: 'stub-model', name: 'Stub' }],
                },
              ],
      },
    });
  } else if (method === 'session/set_mode') {
    if (!gate && params.modeId !== (devin ? 'bypass' : 'full-access')) throw new Error('Wrong mode');
    mode = params.modeId;
    send({ id, result: {} });
  } else if (method === 'session/set_config_option') {
    if (params.value !== 'stub-model') throw new Error('Wrong model');
    configured = true;
    send({ id, result: { configOptions: [] } });
  } else if (method === 'session/prompt') {
    if (!configured) throw new Error('Model was not configured before prompting');
    const text = params.prompt.find((block) => block.type === 'text')?.text ?? '';
    if (scenario === 'devin-steer' && text.includes('steer-now')) {
      send({ id: pending, result: { stopReason: 'interrupted' } });
      update({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'steered' },
      });
      send({ id, result: { stopReason: 'end_turn' } });
      continue;
    }
    if (!params.prompt.some((block) => block.type === 'text' && block.text.includes('Hello'))) {
      throw new Error('Prompt text was dropped');
    }
    if (scenario === 'devin-steer') {
      pending = id;
      update({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'counting' },
      });
      continue;
    }
    if (scenario === 'devin') {
      update({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Hello ' },
      });
      update({
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'child thinking' },
        _meta: { 'cognition.ai/subagent_context': { parentAgentId: 'agent-7' } },
      });
      update({
        sessionUpdate: 'tool_call',
        toolCallId: 'sub-1',
        title: 'Tool',
        kind: 'execute',
        rawInput: {},
        _meta: {
          'cognition.ai/subagent_started': { title: 'Research', agentId: 'agent-7' },
          'cognition.ai/subagent_context': { parentAgentId: 'root' },
        },
      });
      update({
        sessionUpdate: 'tool_call',
        toolCallId: 'child-1',
        title: 'Tool',
        kind: 'execute',
        rawInput: { cmd: 'ls' },
        _meta: {
          'cognition.ai/subagent_context': { parentAgentId: 'agent-7' },
          'cognition.ai/inferenceToolName': 'Bash',
        },
      });
      update({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'child-1',
        status: 'completed',
        rawOutput: 'files',
        _meta: { 'cognition.ai/subagent_context': { parentAgentId: 'agent-7' } },
      });
      update({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'sub-1',
        _meta: {
          'cognition.ai/subagent_completed': { success: true, summary: 'done research' },
        },
      });
      update({
        sessionUpdate: 'usage_update',
        used: 50,
        size: 1000,
        _meta: {
          'cognition.ai/inputTokens': 40,
          'cognition.ai/outputTokens': 10,
          'cognition.ai/cachedReadTokens': 3,
          'cognition.ai/cachedWriteTokens': 2,
        },
      });
      send({ id, result: { stopReason: 'end_turn' } });
      continue;
    }
    if (gate) {
      const calls = JSON.parse(text.slice(text.indexOf('[')));
      const startMode = mode ?? (ask ? 'default' : devin ? 'bypass' : 'full-access');
      void (async () => {
        const outcomes = { __mode: startMode, __disallowed: sessionMeta?.claudeCode?.options?.disallowedTools ?? null };
        const executed = [];
        for (const [index, call] of calls.entries()) {
          const { hostTool, exec, ...toolCall } = call;
          update({ sessionUpdate: 'tool_call', status: 'pending', ...toolCall });
          const blocked = (sessionMeta?.claudeCode?.options?.disallowedTools ?? []).includes(call.title);
          if (blocked) {
            outcomes[call.toolCallId] = 'blocked-by-config';
            update({ sessionUpdate: 'tool_call_update', toolCallId: call.toolCallId, status: 'failed', rawOutput: 'disallowed' });
            continue;
          }
          if (startMode === 'bypass' || startMode === 'full-access') {
            if (exec) executed.push(call.toolCallId);
            outcomes[call.toolCallId] = 'no-prompt';
            update({ sessionUpdate: 'tool_call_update', toolCallId: call.toolCallId, status: 'completed', rawOutput: 'ran' });
            continue;
          }
          const requestId = `gate-${index}`;
          const answered = new Promise((resolve) => gateWaiters.set(requestId, resolve));
          send({
            id: requestId,
            method: 'session/request_permission',
            params: {
              sessionId,
              toolCall,
              options: [
                { optionId: 'always', name: 'Always', kind: 'allow_always' },
                { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
                { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
              ],
            },
          });
          const answer = await answered;
          const picked = answer.outcome.outcome === 'selected' ? answer.outcome.optionId : 'cancelled';
          outcomes[call.toolCallId] = picked;
          if (picked !== 'allow') continue;
          if (exec) executed.push(call.toolCallId);
          if (hostTool) {
            const rpc = (method, params = {}) =>
              fetch(host.url, {
                method: 'POST',
                headers: {
                  'content-type': 'application/json',
                  accept: 'application/json, text/event-stream',
                  ...Object.fromEntries(host.headers.map(({ name, value }) => [name, value])),
                },
                body: JSON.stringify({ jsonrpc: '2.0', id: 'host', method, params }),
              }).then((response) => response.json());
            await rpc('initialize', {
              protocolVersion: '2025-11-25',
              capabilities: {},
              clientInfo: { name: 'fake-acp', version: '1' },
            });
            const called = await rpc('tools/call', { name: hostTool, arguments: {} });
            outcomes[`${call.toolCallId}:tool`] = called.result.content[0].text;
          }
          update({ sessionUpdate: 'tool_call_update', toolCallId: call.toolCallId, status: 'completed', rawOutput: 'ok' });
        }
        outcomes.__executed = executed;
        update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: JSON.stringify(outcomes) } });
        send({ id, result: { stopReason: 'end_turn' } });
      })();
      continue;
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
