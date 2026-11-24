import { join } from 'node:path';
import type { McpServerEntry } from '@earendil-works/pi-coding-agent';
import {
  type JsonRpcMessage,
  StdioTransport,
  StreamableHttpTransport,
} from '@earendil-works/pi-mcp';
import { afterEach, expect, test, vi } from 'vitest';
import { redactingMcpTransports, resolveMcpConfigValue } from '../src/backend/mcp-log-redaction.js';
import { credentialRedactor } from '../src/credential-output.js';

const SECRET = 'mcp-config-credential-4a91';
const transports: StdioTransport[] = [];

afterEach(() => {
  for (const transport of transports.splice(0)) void transport.close();
  vi.unstubAllEnvs();
});

function entry(config: McpServerEntry['config']): McpServerEntry {
  return { name: 'leaky', config, source: 'extension' };
}

test('env templates resolve like pi config values', () => {
  vi.stubEnv('MCP_TEST_TOKEN', SECRET);
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the ${...} here is the config reference under test, not a JS template
  expect(resolveMcpConfigValue('Bearer ${MCP_TEST_TOKEN}', 'header')).toBe(`Bearer ${SECRET}`);
  expect(resolveMcpConfigValue('$MCP_TEST_TOKEN', 'header')).toBe(SECRET);
  expect(resolveMcpConfigValue('$$MCP_TEST_TOKEN', 'header')).toBe('$MCP_TEST_TOKEN');
  expect(resolveMcpConfigValue('$!MCP_TEST_TOKEN', 'header')).toBe('!MCP_TEST_TOKEN');
  expect(resolveMcpConfigValue('plain $ and $9 value', 'header')).toBe('plain $ and $9 value');
});

test('a missing environment variable or a shell command value fails loudly', () => {
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the ${...} here is the config reference under test, not a JS template
  expect(() => resolveMcpConfigValue('${MCP_TEST_MISSING}', 'header')).toThrow(
    /Failed to resolve header from environment variable: MCP_TEST_MISSING/,
  );
  expect(() => resolveMcpConfigValue('!gh auth token', 'header')).toThrow(
    /does not run shell commands/,
  );
});

test('a literal value that happens to contain $ never echoes a fragment of itself', () => {
  expect(() => resolveMcpConfigValue('p@ss$word123', 'header')).toThrow(
    /^Failed to resolve header:/,
  );
  expect(() => resolveMcpConfigValue('p@ss$word123', 'header')).not.toThrow(/word123/);
});

test('a stdio server keeps pi default transport options and redacts only its log messages', async () => {
  vi.stubEnv('MCP_TEST_TOKEN', SECRET);
  const script = `
const write = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
write({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'error', data: 'rejected ' + process.env.MCP_FIXTURE_TOKEN } });
write({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'value ' + process.env.MCP_FIXTURE_TOKEN }] } });
setInterval(() => {}, 60000);
`;
  const factory = redactingMcpTransports(credentialRedactor(SECRET));
  const transport = factory(
    entry({
      command: process.execPath,
      args: ['-e', script],
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the ${...} here is the config reference under test, not a JS template
      env: { MCP_FIXTURE_TOKEN: '${MCP_TEST_TOKEN}' },
    }),
    '/tmp',
    undefined,
  );
  expect(transport).toBeInstanceOf(StdioTransport);
  if (!(transport instanceof StdioTransport)) throw new Error('expected a stdio transport');
  transports.push(transport);
  expect(transport.options.command).toBe(process.execPath);
  expect(transport.options.env?.MCP_FIXTURE_TOKEN).toBe(SECRET);
  expect(transport.options.env?.CAIRN_TOKEN).toBeUndefined();
  expect(transport.options.cwd).toBe('/tmp');
  const seen: JsonRpcMessage[] = [];
  transport.onMessage((message) => {
    seen.push(message);
  });
  await transport.start();
  await vi.waitFor(() => expect(seen.length).toBe(2), { timeout: 15_000 });
  const [notification, response] = seen;
  expect(JSON.stringify(notification)).not.toContain(SECRET);
  expect(JSON.stringify(notification)).toContain('[REDACTED]');
  expect(JSON.stringify(response)).toContain(SECRET);
});

test('an http server resolves headers and keeps its auth provider', () => {
  vi.stubEnv('MCP_TEST_TOKEN', SECRET);
  const authProvider = { name: 'cairn', authorize: async () => ({}) } as never;
  const transport = redactingMcpTransports(credentialRedactor(SECRET))(
    entry({
      url: 'https://mcp.test/s/mcp',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the ${...} here is the config reference under test, not a JS template
      headers: { Authorization: 'Bearer ${MCP_TEST_TOKEN}' },
    }),
    '/tmp',
    authProvider,
  );
  expect(transport).toBeInstanceOf(StreamableHttpTransport);
  if (!(transport instanceof StreamableHttpTransport))
    throw new Error('expected an http transport');
  expect(transport.options.headers).toEqual({ Authorization: `Bearer ${SECRET}` });
  expect(transport.options.authProvider).toBe(authProvider);
  const seen: JsonRpcMessage[] = [];
  transport.onMessage((message) => {
    seen.push(message);
  });
  (transport as unknown as { emitMessage(message: JsonRpcMessage): void }).emitMessage({
    jsonrpc: '2.0',
    method: 'notifications/message',
    params: { level: 'error', data: `upstream rejected token ${SECRET}` },
  });
  (transport as unknown as { emitMessage(message: JsonRpcMessage): void }).emitMessage({
    jsonrpc: '2.0',
    id: 1,
    result: { content: [{ type: 'text', text: `value ${SECRET}` }] },
  });
  expect(JSON.stringify(seen[0])).not.toContain(SECRET);
  expect(JSON.stringify(seen[0])).toContain('[REDACTED]');
  expect(JSON.stringify(seen[1])).toContain(SECRET);
});

test('a stdio server without env keeps the working directory of the session', () => {
  const transport = redactingMcpTransports((value) => value)(
    entry({ command: 'npx', args: ['-y', 'server'] }),
    '/work/tree',
    undefined,
  );
  if (!(transport instanceof StdioTransport)) throw new Error('expected a stdio transport');
  transports.push(transport);
  expect(transport.options.cwd).toBe(join('/work/tree'));
  expect(transport.options.env?.PATH).toBe(process.env.PATH);
  expect(transport.options.env?.HOME).toBe(process.env.HOME);
  expect(transport.options.env?.CAIRN_TOKEN).toBeUndefined();
});
