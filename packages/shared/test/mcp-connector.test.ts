import { describe, expect, it } from 'vitest';
import { mcpConnectorSecretValues } from '../src/records/mcp-connector.js';

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
});
