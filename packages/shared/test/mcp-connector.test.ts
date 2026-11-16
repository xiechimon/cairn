import { describe, expect, it } from 'vitest';
import { mcpConnectorSecretValues } from '../src/records/mcp-connector.js';

function redact(text: string, values: string[]): string {
  return values.reduce((out, value) => out.split(value).join('[REDACTED]'), text);
}

describe('mcpConnectorSecretValues', () => {
  it('redacts credentials, their bearer token and JSON-escaped form, never catalog options or short values', () => {
    expect(
      mcpConnectorSecretValues({
        Authorization: 'Bearer tok-1234567',
        'X-Key': 'ab"cd\\efgh',
        'x-mcp-readonly': 'true',
        'X-MCP-Toolsets': 'repos,issues,pull_requests',
        'X-Api-Version': '2',
      }).sort(),
    ).toEqual(['Bearer tok-1234567', 'ab"cd\\efgh', 'ab\\"cd\\\\efgh', 'tok-1234567'].sort());
  });

  it('lists the escaped form first so a value ending in a backslash leaves valid JSON', () => {
    const line = JSON.stringify({ text: 'saw abcdefgh\\ here' });
    const out = redact(line, mcpConnectorSecretValues({ 'X-Key': 'abcdefgh\\' }));
    expect(JSON.parse(out)).toEqual({ text: 'saw [REDACTED] here' });
  });
});
