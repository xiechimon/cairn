import { describe, expect, it } from 'vitest';
import {
  AGENT_TOOL_SWITCHES,
  CHIEF_TOOL_NAMES,
  DB_TABLES,
  MACHINE_CUSTOM_TOOLS,
  MACHINE_WIRE_EXTENSIONS,
  PROTECTED_PATH_GLOBS,
  WEB_REST_ENDPOINTS,
} from '../src/index.js';

describe('retired zero-use features (#1796)', () => {
  it('keeps schedules and drops whats_new, webhook_token, and shell_command', () => {
    expect(DB_TABLES).toContain('schedule');
    expect(DB_TABLES).not.toContain('whats_new');
    expect(DB_TABLES).not.toContain('webhook_token');
    expect(DB_TABLES).not.toContain('shell_command');
  });

  it('drops the whats-new route and every webhook route from the web vocabulary', () => {
    const paths = WEB_REST_ENDPOINTS.map((endpoint) => endpoint.path);
    expect(paths).not.toContain('/api/whats-new');
    expect(paths.some((path) => path.includes('webhook'))).toBe(false);
  });

  it('drops remote shell from agent switches, chief tools, machine wire, and custom tools', () => {
    expect([...AGENT_TOOL_SWITCHES]).not.toContain('远程 shell');
    expect(CHIEF_TOOL_NAMES).not.toContain('set_remote_shell');
    expect([...MACHINE_CUSTOM_TOOLS]).toEqual(['web_fetch', 'push_branch']);
    expect(MACHINE_WIRE_EXTENSIONS.some((endpoint) => endpoint.path.includes('/shell'))).toBe(
      false,
    );
  });

  it('drops the deleted files from the protected-path list and keeps the remaining machine surfaces', () => {
    expect(PROTECTED_PATH_GLOBS).not.toContain('apps/server/src/services/webhook-tokens.ts');
    expect(PROTECTED_PATH_GLOBS).not.toContain('apps/daemon/src/shell-channel.ts');
    expect(PROTECTED_PATH_GLOBS).not.toContain('apps/server/src/routes-webhook.ts');
    expect(PROTECTED_PATH_GLOBS).toContain('apps/server/src/routes-machine.ts');
    expect(PROTECTED_PATH_GLOBS).toContain('apps/server/src/services/machine*.ts');
    expect(PROTECTED_PATH_GLOBS).toContain('apps/daemon/src/machine-client.ts');
    expect(PROTECTED_PATH_GLOBS).toContain('apps/daemon/src/backend/command-gate.ts');
  });
});
