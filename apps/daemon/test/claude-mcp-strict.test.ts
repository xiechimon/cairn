import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createSdkMcpServer, query, type SpawnedProcess } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, test } from 'vitest';
import {
  buildClaudeSdkOptions,
  type ClaudeSdkOptionParts,
  mapMcpEndpoint,
} from '../src/backend/claude-code.js';

type McpRecord = ClaudeSdkOptionParts['mcpServers'];

function parts(over: Partial<ClaudeSdkOptionParts> = {}): ClaudeSdkOptionParts {
  return {
    cwd: '/tmp/cairn-mcp-strict-wt',
    modelId: 'glm-5.3',
    resumeId: null,
    sessionId: 'sess-1307',
    disallowedTools: ['AskUserQuestion'],
    mcpServers: {},
    abortController: new AbortController(),
    ...over,
  };
}

function withSeam(): McpRecord {
  return { cairn: { type: 'http', url: 'https://example.invalid/mcp' } };
}

function fakeProcess(): SpawnedProcess {
  const stdout = new PassThrough();
  const stdin = new PassThrough();
  const emitter = new EventEmitter();
  let killed = false;
  let exitCode: number | null = null;
  const proc: SpawnedProcess = {
    stdin,
    stdout,
    get killed() {
      return killed;
    },
    get exitCode() {
      return exitCode;
    },
    signalCode: null,
    kill() {
      killed = true;
      return true;
    },
    on(event, listener) {
      emitter.on(event, listener);
      return proc;
    },
    once(event, listener) {
      emitter.once(event, listener);
      return proc;
    },
    off(event, listener) {
      emitter.off(event, listener);
      return proc;
    },
  };
  queueMicrotask(() => {
    exitCode = 0;
    stdout.end();
    emitter.emit('exit', 0, null);
  });
  return proc;
}

async function spawnArgs(input: ClaudeSdkOptionParts): Promise<{
  options: ReturnType<typeof buildClaudeSdkOptions>;
  args: string[];
}> {
  const options = buildClaudeSdkOptions(input);
  let args: string[] | null = null;
  const q = query({
    prompt: 'ping',
    options: {
      ...options,
      spawnClaudeCodeProcess: (spawn) => {
        args = spawn.args;
        return fakeProcess();
      },
    },
  });
  for await (const message of q) {
    void message;
  }
  if (args === null) throw new Error('claude was not spawned');
  return { options, args };
}

function mcpConfig(args: string[]): string | null {
  const index = args.indexOf('--mcp-config');
  if (index < 0) return null;
  return args[index + 1] ?? null;
}

describe('buildClaudeSdkOptions three states (#1307 failure modes 1/2)', () => {
  test('managed empty: mcpServers key always sent under strictMcpConfig (empty record {} no exception) + strict lock', () => {
    const opts = buildClaudeSdkOptions(parts({ mcpServers: {}, strictMcpConfig: true }));
    expect('mcpServers' in opts).toBe(true);
    expect(opts.mcpServers).toEqual({});
    expect(opts.strictMcpConfig).toBe(true);
  });

  test('managed non-empty: managed set passed through verbatim + strict lock (host seam inside the set)', () => {
    const record = withSeam();
    const opts = buildClaudeSdkOptions(parts({ mcpServers: record, strictMcpConfig: true }));
    expect(opts.mcpServers).toBe(record);
    expect(opts.strictMcpConfig).toBe(true);
  });
});

describe('buildClaudeSdkOptions inherit state (#1307 failure modes 3/4: escape hatch + zero regression)', () => {
  test('default (inherit) + empty record: neither mcpServers nor strictMcpConfig key sent', () => {
    const opts = buildClaudeSdkOptions(parts({ mcpServers: {} }));
    expect('mcpServers' in opts).toBe(false);
    expect('strictMcpConfig' in opts).toBe(false);
  });

  test('default (inherit) + non-empty record: mcpServers key sent (host seam alive), strict key not sent', () => {
    const record = withSeam();
    const opts = buildClaudeSdkOptions(parts({ mcpServers: record }));
    expect(opts.mcpServers).toBe(record);
    expect('strictMcpConfig' in opts).toBe(false);
  });
});

describe('claude-code spawn MCP isolation (#1307, tri-state)', () => {
  test('managed empty: --strict-mcp-config, no --mcp-config, setting sources intact', async () => {
    const { options, args } = await spawnArgs(parts({ mcpServers: {}, strictMcpConfig: true }));
    expect(options.strictMcpConfig).toBe(true);
    expect(args).toContain('--strict-mcp-config');
    expect(mcpConfig(args)).toBe(null);
    expect(args).toContain('--setting-sources=user,project,local');
  });

  test('default empty: argv carries neither --strict-mcp-config nor --mcp-config', async () => {
    const { options, args } = await spawnArgs(parts({ mcpServers: {} }));
    expect('strictMcpConfig' in options).toBe(false);
    expect(args).not.toContain('--strict-mcp-config');
    expect(mcpConfig(args)).toBe(null);
    expect(args).toContain('--setting-sources=user,project,local');
  });

  test('managed, in-process cairn only: strict mode, argv does not serialize the sdk server', async () => {
    const cairn = createSdkMcpServer({ name: 'cairn', alwaysLoad: true, tools: [] });
    const { options, args } = await spawnArgs(
      parts({ mcpServers: { cairn }, strictMcpConfig: true }),
    );
    expect(options.mcpServers?.cairn).toBe(cairn);
    expect(args).toContain('--strict-mcp-config');
    expect(mcpConfig(args)).toBe(null);
  });

  test('managed, explicit stdio endpoint: --mcp-config carries only that endpoint, plus strict mode', async () => {
    const cairn = createSdkMcpServer({ name: 'cairn', alwaysLoad: true, tools: [] });
    const figma = mapMcpEndpoint({
      slug: 'figma',
      transport: 'stdio',
      command: 'figma-mcp',
      args: ['--stdio'],
    });
    const { options, args } = await spawnArgs(
      parts({ mcpServers: { cairn, figma }, strictMcpConfig: true }),
    );
    expect(options.mcpServers?.cairn).toBe(cairn);
    expect(options.mcpServers?.figma).toBe(figma);
    expect(args).toContain('--strict-mcp-config');
    expect(mcpConfig(args)).toBe(
      '{"mcpServers":{"figma":{"type":"stdio","command":"figma-mcp","args":["--stdio"],"alwaysLoad":true}}}',
    );
  });

  test('default + explicit stdio: --mcp-config present, --strict-mcp-config absent', async () => {
    const figma = mapMcpEndpoint({
      slug: 'figma',
      transport: 'stdio',
      command: 'figma-mcp',
      args: ['--stdio'],
    });
    const { options, args } = await spawnArgs(parts({ mcpServers: { figma } }));
    expect('strictMcpConfig' in options).toBe(false);
    expect(args).not.toContain('--strict-mcp-config');
    expect(mcpConfig(args)).toBe(
      '{"mcpServers":{"figma":{"type":"stdio","command":"figma-mcp","args":["--stdio"],"alwaysLoad":true}}}',
    );
  });
});

describe('claude-code remote-only sessions (#1939)', () => {
  test('no built-in tools: options carry tools [] and argv passes an empty --tools', async () => {
    const cairn = createSdkMcpServer({ name: 'cairn', alwaysLoad: true, tools: [] });
    const { options, args } = await spawnArgs(
      parts({ mcpServers: { cairn }, strictMcpConfig: true, builtinTools: [] }),
    );
    expect(options.tools).toEqual([]);
    const index = args.indexOf('--tools');
    expect(index).toBeGreaterThanOrEqual(0);
    expect(args[index + 1]).toBe('');
    expect(args).toContain('--strict-mcp-config');
  });

  test('default sessions keep the preset tool set', () => {
    expect('tools' in buildClaudeSdkOptions(parts())).toBe(false);
  });
});
