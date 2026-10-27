import { CHIEF_REMOTE_TOOLS, CHIEF_TOOL_CATEGORIES, MCP_TOOL_REGISTRY } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { buildMcpFaceServer } from '../src/services/mcp-face.js';
import { bootServer } from './helpers.js';

const GITHUB_ISSUE_WRITES = [
  'add_issue_label',
  'remove_issue_label',
  'close_issue',
  'reopen_issue',
  'update_issue',
  'relabel_issue',
];

function assertNoGithubIssueWrite(names: readonly string[]): void {
  for (const name of names) {
    const looksLikeGithubIssueWrite =
      /(?:^|_)(?:label|labels)(?:$|_)/.test(name) && /issue/.test(name);
    expect(name).not.toMatch(/^(?:label|unlabel|relabel|close_issue|reopen_issue|update_issue)/);
    expect(looksLikeGithubIssueWrite).toBe(false);
    expect(GITHUB_ISSUE_WRITES).not.toContain(name);
  }
}

describe('agent and chief tool surface', () => {
  test('carries no GitHub label or issue-close write tool', () => {
    const names = CHIEF_REMOTE_TOOLS.map((t) => t.name);
    expect(names.length).toBeGreaterThan(0);
    assertNoGithubIssueWrite(names);
    for (const name of names) {
      expect(name).not.toMatch(/issue.*(?:close|label)/);
    }
  });

  test('the GitHub surface stays read-only: issues and pull_requests are read tools', () => {
    expect(CHIEF_TOOL_CATEGORIES.read).toContain('issues');
    expect(CHIEF_TOOL_CATEGORIES.read).toContain('pull_requests');
    const writeTools = Object.entries(CHIEF_TOOL_CATEGORIES)
      .filter(([category]) => category !== 'read')
      .flatMap(([, tools]) => tools);
    expect(writeTools).not.toContain('issues');
    expect(writeTools).not.toContain('pull_requests');
  });

  test('the MCP registry exposes no issue-label or issue-close tool', () => {
    const names = MCP_TOOL_REGISTRY.map((t) => t.name);
    expect(names.length).toBeGreaterThan(0);
    assertNoGithubIssueWrite(names);
    const githubTools = MCP_TOOL_REGISTRY.filter((t) =>
      ['issues', 'pull_requests', 'workflow_runs'].includes(t.name),
    );
    expect(githubTools.map((t) => t.kind)).toEqual(['read', 'read', 'read']);
  });
});

describe('the real MCP server face', () => {
  test('registers no scheduling execute tool and no GitHub issue write tool', () => {
    const s = bootServer();
    try {
      const grants = new Set(MCP_TOOL_REGISTRY.map((t) => t.grant));
      const face = buildMcpFaceServer(s.svc as never, {
        teamId: s.team.id,
        user: s.user,
        grants,
      });
      const registered = Object.keys(
        (face as unknown as { _registeredTools: Record<string, unknown> })._registeredTools,
      );
      expect(registered.length).toBeGreaterThan(0);
      expect(registered).not.toContain('execute_schedule');
      expect(registered).not.toContain('schedule_report');
      assertNoGithubIssueWrite(registered);
    } finally {
      s.dispose();
    }
  });
});
