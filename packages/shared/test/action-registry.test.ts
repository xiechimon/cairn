import { describe, expect, test } from 'vitest';
import {
  ACTION_PROPOSAL_TTL_MS,
  CHIEF_REMOTE_TOOLS,
  MCP_TOOL_REGISTRY,
  OWNER_ONLY_EXCEPTION_IDS,
  projectDeleteAction,
  SLICE1_ACTIONS,
} from '../src/index.js';

describe('slice 1 action registry', () => {
  test('owner-only exception list is exact and no surfaced entry is owner-only', () => {
    expect([...OWNER_ONLY_EXCEPTION_IDS]).toEqual([
      'set_secret',
      'delete_secrets',
      'merge_builds',
      'rest.merge-policy',
      'rest.ship-route',
      'rest.eval-ruler',
    ]);
    expect(SLICE1_ACTIONS.filter((entry) => entry.class === 'owner-only')).toEqual([]);
    for (const entry of SLICE1_ACTIONS) {
      if (entry.class === 'owner-only') expect(entry.surfaces).toEqual([]);
    }
  });

  test('slice 1 entries are not offered on mcp or cli, and delete has no standing grant', () => {
    expect(SLICE1_ACTIONS.map((entry) => entry.surfaces)).toEqual([
      ['web', 'coordinator'],
      ['web', 'coordinator'],
      ['web', 'coordinator'],
    ]);
    expect(projectDeleteAction.standingGrant).toBe(false);
    expect(projectDeleteAction.class).toBe('confirm-once');
    expect(projectDeleteAction.inverse).toBeNull();
    expect(ACTION_PROPOSAL_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  test('delete_project is absent from MCP_TOOL_REGISTRY and CHIEF_REMOTE_TOOLS', () => {
    expect(MCP_TOOL_REGISTRY.map((entry) => entry.name)).not.toContain('delete_project');
    expect(CHIEF_REMOTE_TOOLS.map((entry) => entry.name)).not.toContain('delete_project');
    expect(CHIEF_REMOTE_TOOLS.map((entry) => entry.name)).not.toContain('archive_project');
    expect(CHIEF_REMOTE_TOOLS.map((entry) => entry.name)).not.toContain('unarchive_project');
  });
});
