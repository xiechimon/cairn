import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sessionInjectedSkills, stepMcpEndpoints } from '../src/step-skill-tool.js';
import { testTempDir } from './test-temp-dir.js';

describe('sessionInjectedSkills', () => {
  it('moves the default skill to the front without duplicating it', () => {
    expect(sessionInjectedSkills({ injectedSkills: ['a', 'b', 'c'], defaultSkill: 'b' })).toEqual([
      'b',
      'a',
      'c',
    ]);
  });

  it('keeps the list when there is no default skill', () => {
    expect(sessionInjectedSkills({ injectedSkills: ['a'], defaultSkill: null })).toEqual(['a']);
    expect(sessionInjectedSkills({ injectedSkills: undefined, defaultSkill: 'b' })).toBeUndefined();
  });
});

describe('stepMcpEndpoints', () => {
  it('logs a strict empty set when the claim lists no servers', () => {
    const lines: string[] = [];
    expect(stepMcpEndpoints('/nonexistent/mcp.json', [], (line) => lines.push(line))).toEqual([]);
    expect(lines).toEqual(['managed-empty: strict MCP set (runtime config not inherited)']);
  });

  it('stays silent when the claim carries no MCP set', () => {
    const lines: string[] = [];
    expect(
      stepMcpEndpoints('/nonexistent/mcp.json', undefined, (line) => lines.push(line)),
    ).toEqual([]);
    expect(lines).toEqual([]);
  });

  it('prefers a granted connector, mounts only granted slugs, and names withheld ones', () => {
    const configPath = join(testTempDir('mcp-step-'), 'mcp.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          linear: { url: 'https://local.example/mcp' },
          files: { command: 'files-mcp' },
        },
      }),
    );
    const connector = (slug: string) => ({
      slug,
      transport: 'http' as const,
      url: `https://${slug}.example/mcp`,
      headers: { Authorization: `Bearer ${slug}-token` },
    });
    const lines: string[] = [];
    const endpoints = stepMcpEndpoints(
      configPath,
      ['Linear', 'files', 'notion', 'missing'],
      (line) => lines.push(line),
      {
        connectors: [connector('linear'), connector('github')],
        withheld: ['notion'],
      },
    );
    expect(endpoints).toEqual([
      { ...connector('linear'), slug: 'Linear' },
      { slug: 'files', transport: 'stdio', command: 'files-mcp' },
    ]);
    expect(lines).toEqual([
      `Linear: using the connector; the entry in ${configPath} is ignored`,
      'notion: reconnect it in settings — its tools are unavailable this turn',
      'missing: not in local config — its tools are unavailable this turn',
      `loaded from ${configPath}: files; from connectors: Linear`,
    ]);
    expect(lines.join('\n')).not.toContain('-token');
  });

  it('mounts no connector when the claim carries no MCP set', () => {
    const lines: string[] = [];
    expect(
      stepMcpEndpoints('/nonexistent/mcp.json', undefined, (line) => lines.push(line), {
        connectors: [{ slug: 'linear', transport: 'http', url: 'https://linear.example/mcp' }],
      }),
    ).toEqual([]);
    expect(lines).toEqual([]);
  });
});
