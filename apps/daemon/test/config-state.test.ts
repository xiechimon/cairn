import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BRAND,
  DEVICE_ID_PATTERN,
  ENV_VARS,
  MACHINE_TOKEN_PATTERN,
  WORKSPACE_HOOK_TIMEOUT_MS,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { DEFAULT_SERVER_URL, loadDaemonConfig, WorkspacesDirError } from '../src/config.js';
import {
  ensureStateDirs,
  forgetMachine,
  loadDaemonJson,
  loadMachineJson,
  loadOrCreateDeviceJson,
  recordSession,
  resolveSessionFile,
  saveMachineJson,
  statePaths,
  writeDaemonJson,
} from '../src/state.js';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'cairn-cfg-'));
}

describe('loadDaemonConfig (Settings seam precedence)', () => {
  test('defaults: CAIRN_SERVER defaults to DEFAULT_SERVER_URL, hostname name, ~/.cairn home', () => {
    const cfg = loadDaemonConfig({}, {});
    expect(cfg.serverUrl).toBe(DEFAULT_SERVER_URL);
    expect(cfg.home.endsWith(BRAND.homeDirName)).toBe(true);
    expect(cfg.workspacesDir).toBe(join(cfg.home, 'workspaces'));
    expect(cfg.foreground).toBe(false);
  });

  test('env layer: the CAIRN_* five-item vocabulary (r3 §1.1 observed under the original TDS_* names, same shape at the replacement phase)', () => {
    const home = tmp();
    const cfg = loadDaemonConfig(
      {},
      {
        [ENV_VARS.server]: 'http://10.0.0.2:9999/',
        [ENV_VARS.apiKey]: 'cairn_key',
        [ENV_VARS.team]: 'team-1',
        [ENV_VARS.home]: home,
      },
    );
    expect(cfg.serverUrl).toBe('http://10.0.0.2:9999');
    expect(cfg.apiKey).toBe('cairn_key');
    expect(cfg.teamId).toBe('team-1');
    expect(cfg.home).toBe(home);
  });

  test('explicit args > env', () => {
    const cfg = loadDaemonConfig(
      { serverUrl: 'http://explicit:1', name: 'explicit-name' },
      { [ENV_VARS.server]: 'http://env:2' },
    );
    expect(cfg.serverUrl).toBe('http://explicit:1');
    expect(cfg.name).toBe('explicit-name');
  });

  test('skillsDir (spec 14/#371): default = ~/.agents/skills; env overrides; explicit args > env', () => {
    const cfg = loadDaemonConfig({}, {});
    expect(cfg.skillsDir).toBe(join(homedir(), '.agents', 'skills'));

    const envDir = tmp();
    const viaEnv = loadDaemonConfig({}, { [ENV_VARS.skillsDir]: envDir });
    expect(viaEnv.skillsDir).toBe(envDir);

    const explicitDir = tmp();
    const viaInput = loadDaemonConfig({ skillsDir: explicitDir }, { [ENV_VARS.skillsDir]: envDir });
    expect(viaInput.skillsDir).toBe(explicitDir);
  });

  test('skillsDir pointing at a missing directory = non-fatal (empty skills set degraded by the scan layer, config does not throw)', () => {
    const missing = join(tmp(), 'no-such-skills-dir');
    expect(() => loadDaemonConfig({ skillsDir: missing }, {})).not.toThrow();
    expect(loadDaemonConfig({ skillsDir: missing }, {}).skillsDir).toBe(missing);
  });

  test('workspaces-dir guardrail: the parent directory must already exist (r3 §1.1 canon)', () => {
    const home = tmp();
    expect(() => loadDaemonConfig({ workspacesDir: join(home, 'ws') }, {})).not.toThrow();
    expect(() => loadDaemonConfig({ workspacesDir: join(home, 'missing', 'ws') }, {})).toThrow(
      WorkspacesDirError,
    );
  });

  test('mcpConfigPath default = ~/.claude.json', () => {
    const cfg = loadDaemonConfig({}, {});
    expect(cfg.mcpConfigPath).toBe(join(homedir(), '.claude.json'));
  });

  test('mcpConfigPath env override (CAIRN_MCP_CONFIG)', () => {
    const cfg = loadDaemonConfig({}, { [ENV_VARS.mcpConfig]: '/tmp/custom-claude.json' });
    expect(cfg.mcpConfigPath).toBe('/tmp/custom-claude.json');
  });

  test('mcpConfigPath explicit args > env', () => {
    const cfg = loadDaemonConfig(
      { mcpConfigPath: '/explicit-claude.json' },
      { [ENV_VARS.mcpConfig]: '/env-claude.json' },
    );
    expect(cfg.mcpConfigPath).toBe('/explicit-claude.json');
  });
});

describe('#1149 environment hook timeout (hookTimeoutMs, same Settings seam precedence)', () => {
  test('default = WORKSPACE_HOOK_TIMEOUT_MS (20min, pinned on the ticket)', () => {
    const cfg = loadDaemonConfig({}, {});
    expect(cfg.hookTimeoutMs).toBe(WORKSPACE_HOOK_TIMEOUT_MS);
  });
  test('env override (CAIRN_HOOK_TIMEOUT_MS)', () => {
    const cfg = loadDaemonConfig({}, { [ENV_VARS.hookTimeoutMs]: '45000' });
    expect(cfg.hookTimeoutMs).toBe(45_000);
  });
  test('explicit args > env', () => {
    const cfg = loadDaemonConfig({ hookTimeoutMs: 60_000 }, { [ENV_VARS.hookTimeoutMs]: '45000' });
    expect(cfg.hookTimeoutMs).toBe(60_000);
  });
  test('env non-positive-integer (0/negative/NaN/float) = ignored, default used (silent default fallback)', () => {
    for (const bad of ['0', '-5', 'abc', '1.5']) {
      const cfg = loadDaemonConfig({}, { [ENV_VARS.hookTimeoutMs]: bad });
      expect(cfg.hookTimeoutMs).toBe(WORKSPACE_HOOK_TIMEOUT_MS);
    }
  });
});

describe('local state layout (02 §5.3)', () => {
  test('ensureStateDirs creates home + outbox/chat-sessions/agent-runtime/workspaces', () => {
    const home = join(tmp(), 'cairn-home');
    const paths = statePaths(home);
    ensureStateDirs(paths);
    for (const dir of [
      paths.home,
      paths.outboxDir,
      paths.chatSessionsDir,
      paths.agentRuntimeDir,
      paths.workspacesDir,
    ]) {
      expect(existsSync(dir), dir).toBe(true);
    }
  });

  test('machine.json shape validation: bad token refused (64hex, r3 §1.3)', () => {
    const paths = statePaths(tmp());
    ensureStateDirs(paths);
    writeFileSync(
      paths.machineJson,
      JSON.stringify({ machineId: 'm', token: 'short', teamId: 't', serverUrl: 'u' }),
    );
    expect(loadMachineJson(paths)).toBeNull();
    const good = {
      machineId: 'm1',
      token: 'a'.repeat(64),
      teamId: 'team-1',
      serverUrl: 'http://x',
    };
    expect(MACHINE_TOKEN_PATTERN.test(good.token)).toBe(true);
    saveMachineJson(paths, good);
    expect(loadMachineJson(paths)).toEqual(good);
    expect(forgetMachine(paths)).toBe(true);
    expect(loadMachineJson(paths)).toBeNull();
    expect(forgetMachine(paths)).toBe(false);
  });

  test('device.json 32hex generated and stable (r3 §1.3 device fingerprint)', () => {
    const paths = statePaths(tmp());
    ensureStateDirs(paths);
    const d1 = loadOrCreateDeviceJson(paths);
    expect(DEVICE_ID_PATTERN.test(d1.deviceId)).toBe(true);
    const d2 = loadOrCreateDeviceJson(paths);
    expect(d2.deviceId).toBe(d1.deviceId);
  });

  test('daemon.json {pid,startedAt,runner:"cli"}（r3 §1.3）', () => {
    const paths = statePaths(tmp());
    ensureStateDirs(paths);
    writeDaemonJson(paths, { pid: 4242, startedAt: 1, runner: 'cli' });
    expect(loadDaemonJson(paths)).toEqual({ pid: 4242, startedAt: 1, runner: 'cli' });
  });

  test('chat-sessions index: sessionId → sessionFile (continueSession resolution key)', () => {
    const paths = statePaths(tmp());
    ensureStateDirs(paths);
    recordSession(paths, 'sess-1', '/x/sessions/sess-1.jsonl');
    expect(resolveSessionFile(paths, 'sess-1')).toBe('/x/sessions/sess-1.jsonl');
    expect(resolveSessionFile(paths, 'nope')).toBeNull();
  });
});
