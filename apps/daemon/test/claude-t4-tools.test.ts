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

function must<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`missing ${label}`);
  return value;
}

function roundTrip(parameters: unknown): Record<string, unknown> {
  const shape = parametersToShape(parameters, 'probe');
  return z.toJSONSchema(z.object(shape)) as Record<string, unknown>;
}

describe('parametersToShape (failure modes 2/3)', () => {
  test('chief docs tool: type/required/description round-trip faithfully', () => {
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

  test('nested object (create_skill files: source schema has no nested required → all optional)', () => {
    const json = roundTrip(byName('create_skill').parameters);
    const props = json.properties as Record<string, Record<string, unknown>>;
    expect(json.required).toEqual(['name', 'description', 'files']);
    const files = props.files as Record<string, unknown>;
    const items = files.items as Record<string, unknown>;
    expect(items.type).toBe('object');
    expect(items.required).toBeUndefined();
    const itemProps = items.properties as Record<string, Record<string, unknown>>;
    expect(itemProps.path).toMatchObject({
      type: 'string',
      description: 'File path inside the skill folder.',
    });
  });

  test('boolean/number slots (run_builds withPlan / set_wake at)', () => {
    const builds = roundTrip(byName('run_builds').parameters);
    const withPlan = must(
      (builds.properties as Record<string, Record<string, unknown>>).withPlan,
      'withPlan',
    );
    expect(withPlan.type).toBe('boolean');
    const wake = roundTrip(byName('set_wake').parameters);
    const at = must((wake.properties as Record<string, Record<string, unknown>>).at, 'at');
    expect(at.type).toBe('number');
  });

  test('no-arg tool: parameters default = shape {}', () => {
    expect(parametersToShape(undefined, 'agents')).toEqual({});
    expect(parametersToShape(null, 'agents')).toEqual({});
  });

  test('type outside the vocabulary (enum) fails closed', () => {
    expect(() =>
      parametersToShape(
        { type: 'object', properties: { kind: { type: 'string', enum: ['a'] } } },
        'x',
      ),
    ).toThrow(/keys \[enum\] not in vocabulary.*fail-closed/);
  });

  test('top-level non-object schema fails closed', () => {
    expect(() => parametersToShape({ type: 'string' }, 'x')).toThrow(/must be an object schema/);
    expect(() => parametersToShape(['nope'], 'x')).toThrow(/must be an object schema/);
  });

  test('non-object properties fails closed', () => {
    expect(() => parametersToShape({ type: 'object', properties: 'nope' }, 'x')).toThrow(
      /properties must be an object/,
    );
  });

  test('non-string-array required fails closed', () => {
    expect(() => parametersToShape({ type: 'object', properties: {}, required: [1] }, 'x')).toThrow(
      /required must be string/,
    );
  });
});

describe('buildHostTools (failure modes 4/5/8)', () => {
  test('remoteTools without relay = fail-closed (never silently dropped)', () => {
    expect(() => buildHostTools({ remoteTools: [byName('projects')], localTools: [] })).toThrow(
      /remoteTools require executeRemoteTool/,
    );
  });

  test('relay receives bare names (def.name, no mcp__cairn__ prefix) + result text returned', async () => {
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

  test('relay rejection → tool result text + isError (no throw, turn continues)', async () => {
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

  test('localTools go through def.execute + failures become result text', async () => {
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

  test('full chief vocabulary converts with zero throws (vocabulary completeness regression — count floats with the vocabulary single source)', () => {
    const relay = async () => 'ok';
    const tools = buildHostTools({ remoteTools: CHIEF_REMOTE_TOOLS, relay, localTools: [] });
    expect(tools).toHaveLength(CHIEF_REMOTE_TOOLS.length);
    const names = new Set(tools.map((t) => t.name));
    for (const def of CHIEF_REMOTE_TOOLS) expect(names.has(def.name)).toBe(true);
  });
});

describe('mapMcpEndpoint (failure mode 6)', () => {
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

  test('incomplete endpoint fails closed: http without url / stdio without command', () => {
    expect(() => mapMcpEndpoint({ slug: 'x', transport: 'http' })).toThrow(
      /http transport requires url/,
    );
    expect(() => mapMcpEndpoint({ slug: 'x', transport: 'stdio' })).toThrow(
      /stdio transport requires command/,
    );
  });
});
