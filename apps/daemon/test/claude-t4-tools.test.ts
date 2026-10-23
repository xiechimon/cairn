// claude-code T4 工具面（#647）：JSON Schema → zod 转换、host 工具 handler
// 语义、McpEndpoint 映射。失败方式先于实现固化（票面 2/3/4/5/6/8）：
//   2. 转换漂移（type/required/description 丢）→ z.toJSONSchema 回投对拍
//   3. 词表外形态静默降级 → fail-closed throw（enum/顶层数组/坏 properties）
//   4. relay 名漂移（MCP 前缀名发 relay）→ handler 钉 def.name 裸名
//   5. 传输/执行错误抛断回合 → 工具结果文本 + isError
//   6. mcpServers 映射错（字段对调/残缺）→ 纯函数映射对拍 + 残缺 throw
//   8. remoteTools 无 relay 静默丢 → fail-closed throw

import type { LocalToolDef, RemoteToolDef } from '@cairn/shared';
import { CHIEF_REMOTE_TOOLS } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { buildHostTools, mapMcpEndpoint, parametersToShape } from '../src/backend/claude-code.js';

const byName = (name: string): RemoteToolDef => {
  const hit = CHIEF_REMOTE_TOOLS.find((t) => t.name === name);
  if (!hit) throw new Error(`chief tool ${name} not found`);
  return hit;
};

/** noUncheckedIndexedAccess 下的取值帮手（索引访问恒带 undefined 支）。 */
function must<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`missing ${label}`);
  return value;
}

/** parameters → shape → z.toJSONSchema 回投（转换保真度的判定面）。 */
function roundTrip(parameters: unknown): Record<string, unknown> {
  const shape = parametersToShape(parameters, 'probe');
  return z.toJSONSchema(z.object(shape)) as Record<string, unknown>;
}

describe('parametersToShape（失败方式 2/3）', () => {
  test('chief docs 工具：type/required/description 回投保真', () => {
    const json = roundTrip(byName('docs').parameters);
    const props = json.properties as Record<string, Record<string, unknown>>;
    expect(json.type).toBe('object');
    expect(json.required).toEqual(['projectId', 'paths']);
    expect(props.projectId).toMatchObject({ type: 'string', description: 'Project id.' });
    const paths = must(props.paths, 'paths');
    expect(paths).toMatchObject({
      type: 'array',
      description: expect.stringContaining('batch'),
    });
    expect((paths.items as Record<string, unknown>).type).toBe('string');
    expect(props.ref).toMatchObject({
      type: 'string',
      description: 'Optional git ref; defaults to the default branch.',
    });
  });

  test('嵌套 object（create_skill files：源 schema 无嵌套 required → 全 optional）', () => {
    const json = roundTrip(byName('create_skill').parameters);
    const props = json.properties as Record<string, Record<string, unknown>>;
    expect(json.required).toEqual(['name', 'description', 'files']);
    const files = props.files as Record<string, unknown>;
    const items = files.items as Record<string, unknown>;
    expect(items.type).toBe('object');
    expect(items.required).toBeUndefined(); // 源 schema 的 files 条目无 required
    const itemProps = items.properties as Record<string, Record<string, unknown>>;
    expect(itemProps.path).toMatchObject({
      type: 'string',
      description: 'File path inside the skill folder.',
    });
  });

  test('boolean/number 档（set_remote_shell enabled / set_wake at）', () => {
    const shell = roundTrip(byName('set_remote_shell').parameters);
    const enabled = must(
      (shell.properties as Record<string, Record<string, unknown>>).enabled,
      'enabled',
    );
    expect(enabled.type).toBe('boolean');
    const wake = roundTrip(byName('set_wake').parameters);
    const at = must((wake.properties as Record<string, Record<string, unknown>>).at, 'at');
    expect(at.type).toBe('number');
  });

  test('空参工具：parameters 缺省 = shape {}', () => {
    expect(parametersToShape(undefined, 'agents')).toEqual({});
    expect(parametersToShape(null, 'agents')).toEqual({});
  });

  test('词表外 type（enum）fail-closed', () => {
    expect(() =>
      parametersToShape(
        { type: 'object', properties: { kind: { type: 'string', enum: ['a'] } } },
        'x',
      ),
    ).toThrow(/keys \[enum\] not in vocabulary.*fail-closed/);
  });

  test('顶层非 object schema fail-closed', () => {
    expect(() => parametersToShape({ type: 'string' }, 'x')).toThrow(/must be an object schema/);
    expect(() => parametersToShape(['nope'], 'x')).toThrow(/must be an object schema/);
  });

  test('properties 非 object fail-closed', () => {
    expect(() => parametersToShape({ type: 'object', properties: 'nope' }, 'x')).toThrow(
      /properties must be an object/,
    );
  });

  test('required 非字符串数组 fail-closed', () => {
    expect(() => parametersToShape({ type: 'object', properties: {}, required: [1] }, 'x')).toThrow(
      /required must be string/,
    );
  });
});

describe('buildHostTools（失败方式 4/5/8）', () => {
  test('remoteTools 无 relay = fail-closed（不静默丢）', () => {
    expect(() => buildHostTools({ remoteTools: [byName('projects')], localTools: [] })).toThrow(
      /remoteTools require executeRemoteTool/,
    );
  });

  test('relay 收裸名（def.name，非 mcp__cairn__ 前缀）+ 结果文本回投', async () => {
    const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
    const tools = buildHostTools({
      remoteTools: [byName('projects')],
      relay: async (name, params) => {
        calls.push({ name, params });
        return '{"projects":[]}';
      },
      localTools: [],
    });
    const first = must(tools[0], 'tools[0]');
    expect(first.name).toBe('projects');
    const result = await first.handler({ teamId: 't1' }, undefined);
    expect(calls).toEqual([{ name: 'projects', params: { teamId: 't1' } }]);
    expect(result).toEqual({ content: [{ type: 'text', text: '{"projects":[]}' }] });
  });

  test('relay 拒绝 → 工具结果文本 + isError（不抛断回合）', async () => {
    const tools = buildHostTools({
      remoteTools: [byName('run_builds')],
      relay: async () => {
        throw new Error('HTTP 403 not authorized');
      },
      localTools: [],
    });
    const first = must(tools[0], 'tools[0]');
    const result = await first.handler({ todoIds: ['x'] }, undefined);
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: 'run_builds rejected: HTTP 403 not authorized' },
    ]);
  });

  test('localTools 走 def.execute + 失败转结果文本', async () => {
    const local: LocalToolDef = {
      name: 'remote_shell',
      description: 'Run a shell command.',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command'],
      },
      execute: async (params) => `ran: ${String(params.command)}`,
    };
    const tools = buildHostTools({ remoteTools: [], localTools: [local] });
    const ok = await must(tools[0], 'tools[0]').handler({ command: 'pnpm test' }, undefined);
    expect(ok).toEqual({ content: [{ type: 'text', text: 'ran: pnpm test' }] });

    const bad: LocalToolDef = {
      ...local,
      execute: async () => {
        throw new Error('precheck failed');
      },
    };
    const badTools = buildHostTools({ remoteTools: [], localTools: [bad] });
    const err = await must(badTools[0], 'badTools[0]').handler({ command: 'x' }, undefined);
    expect(err.isError).toBe(true);
    expect(err.content).toEqual([{ type: 'text', text: 'remote_shell failed: precheck failed' }]);
  });

  test('chief 词表全量转换零抛（词表完整性回归——数量随词表单源浮动）', () => {
    const relay = async () => 'ok';
    const tools = buildHostTools({ remoteTools: CHIEF_REMOTE_TOOLS, relay, localTools: [] });
    // 数量判定钉 CHIEF_REMOTE_TOOLS 单源（词表会增删——#649 加 model 候选读
    // 工具即从 50 → 51；写死字面量会把词表演进误报成本票回归）。
    expect(tools).toHaveLength(CHIEF_REMOTE_TOOLS.length);
    const names = new Set(tools.map((t) => t.name));
    for (const def of CHIEF_REMOTE_TOOLS) expect(names.has(def.name)).toBe(true);
  });
});

describe('mapMcpEndpoint（失败方式 6）', () => {
  test('http → SDK http config（url/headers/alwaysLoad）', () => {
    const cfg = mapMcpEndpoint({
      slug: 'ctx',
      transport: 'http',
      url: 'https://mcp.example/sse',
      headers: { authorization: 'Bearer x' },
    });
    expect(cfg).toEqual({
      type: 'http',
      url: 'https://mcp.example/sse',
      headers: { authorization: 'Bearer x' },
      alwaysLoad: true,
    });
  });

  test('stdio → SDK stdio config（command/args/env）', () => {
    const cfg = mapMcpEndpoint({
      slug: 'ctx',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { A: '1' },
    });
    expect(cfg).toEqual({
      type: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { A: '1' },
      alwaysLoad: true,
    });
  });

  test('残缺端点 fail-closed：http 无 url / stdio 无 command', () => {
    expect(() => mapMcpEndpoint({ slug: 'x', transport: 'http' })).toThrow(
      /http transport requires url/,
    );
    expect(() => mapMcpEndpoint({ slug: 'x', transport: 'stdio' })).toThrow(
      /stdio transport requires command/,
    );
  });
});
