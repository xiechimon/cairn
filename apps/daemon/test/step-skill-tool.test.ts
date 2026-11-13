import { describe, expect, it } from 'vitest';
import { sessionInjectedSkills, stepMcpEndpoints } from '../src/step-skill-tool.js';

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
});
