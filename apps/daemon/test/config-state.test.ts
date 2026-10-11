// Settings 缝最小层（优先级 = 显式入参 > env > 默认值）+ 本地状态布局
// （02 §5.3/r3 §1.3 形状；zod 单源 = shared machine/device/daemonJsonSchema）。

import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BRAND,
  DEVICE_ID_PATTERN,
  ENV_VARS,
  MACHINE_TOKEN_PATTERN,
  WORKSPACE_HOOK_TIMEOUT_MS,
} from '@pacman/shared';
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
  return mkdtempSync(join(tmpdir(), 'pacman-cfg-'));
}

describe('loadDaemonConfig（Settings 缝优先级）', () => {
  test('defaults: PACMAN_SERVER 缺省=DEFAULT_SERVER_URL, hostname name, ~/.pacman home', () => {
    const cfg = loadDaemonConfig({}, {});
    expect(cfg.serverUrl).toBe(DEFAULT_SERVER_URL);
    expect(cfg.home.endsWith(BRAND.homeDirName)).toBe(true);
    expect(cfg.workspacesDir).toBe(join(cfg.home, 'workspaces'));
    expect(cfg.foreground).toBe(false);
  });

  test('env 层：PACMAN_* 五件词表（r3 §1.1 观测原名 TDS_*，替换相位同形）', () => {
    const home = tmp();
    const cfg = loadDaemonConfig(
      {},
      {
        [ENV_VARS.server]: 'http://10.0.0.2:9999/',
        [ENV_VARS.apiKey]: 'pacman_key',
        [ENV_VARS.team]: 'team-1',
        [ENV_VARS.home]: home,
      },
    );
    expect(cfg.serverUrl).toBe('http://10.0.0.2:9999'); // 尾斜杠归一
    expect(cfg.apiKey).toBe('pacman_key');
    expect(cfg.teamId).toBe('team-1');
    expect(cfg.home).toBe(home);
  });

  test('显式入参 > env', () => {
    const cfg = loadDaemonConfig(
      { serverUrl: 'http://explicit:1', name: 'explicit-name' },
      { [ENV_VARS.server]: 'http://env:2' },
    );
    expect(cfg.serverUrl).toBe('http://explicit:1');
    expect(cfg.name).toBe('explicit-name');
  });

  test('skillsDir（spec 14/#371）：缺省 = ~/.agents/skills；env 覆盖；显式入参 > env', () => {
    const cfg = loadDaemonConfig({}, {});
    expect(cfg.skillsDir).toBe(join(homedir(), '.agents', 'skills'));

    const envDir = tmp();
    const viaEnv = loadDaemonConfig({}, { [ENV_VARS.skillsDir]: envDir });
    expect(viaEnv.skillsDir).toBe(envDir);

    const explicitDir = tmp();
    const viaInput = loadDaemonConfig({ skillsDir: explicitDir }, { [ENV_VARS.skillsDir]: envDir });
    expect(viaInput.skillsDir).toBe(explicitDir);
  });

  test('skillsDir 指向不存在目录 = 非致命（空 skills 集由扫描层降级，config 不抛）', () => {
    const missing = join(tmp(), 'no-such-skills-dir');
    expect(() => loadDaemonConfig({ skillsDir: missing }, {})).not.toThrow();
    expect(loadDaemonConfig({ skillsDir: missing }, {}).skillsDir).toBe(missing);
  });

  test('workspaces-dir 护栏：父目录必须已存在（r3 §1.1 canon）', () => {
    const home = tmp();
    // 父目录存在 → OK。
    expect(() => loadDaemonConfig({ workspacesDir: join(home, 'ws') }, {})).not.toThrow();
    // 父目录不存在 → 拒绝启动而非落到启动盘。
    expect(() => loadDaemonConfig({ workspacesDir: join(home, 'missing', 'ws') }, {})).toThrow(
      WorkspacesDirError,
    );
  });

  // spec 13（#368）：daemon 读本机 MCP config 的路径槽——优先级同律
  // （显式入参 > env > 默认值），默认 = ~/.claude.json。
  test('mcpConfigPath 默认 = ~/.claude.json', () => {
    const cfg = loadDaemonConfig({}, {});
    expect(cfg.mcpConfigPath).toBe(join(homedir(), '.claude.json'));
  });

  test('mcpConfigPath env 覆盖（PACMAN_MCP_CONFIG）', () => {
    const cfg = loadDaemonConfig({}, { [ENV_VARS.mcpConfig]: '/tmp/custom-claude.json' });
    expect(cfg.mcpConfigPath).toBe('/tmp/custom-claude.json');
  });

  test('mcpConfigPath 显式入参 > env', () => {
    const cfg = loadDaemonConfig(
      { mcpConfigPath: '/explicit-claude.json' },
      { [ENV_VARS.mcpConfig]: '/env-claude.json' },
    );
    expect(cfg.mcpConfigPath).toBe('/explicit-claude.json');
  });
});

describe('#1149 环境钩子超时（hookTimeoutMs，Settings 缝优先级同律）', () => {
  test('缺省 = WORKSPACE_HOOK_TIMEOUT_MS（20min，票面钉死）', () => {
    const cfg = loadDaemonConfig({}, {});
    expect(cfg.hookTimeoutMs).toBe(WORKSPACE_HOOK_TIMEOUT_MS);
  });
  test('env 覆盖（PACMAN_HOOK_TIMEOUT_MS）', () => {
    const cfg = loadDaemonConfig({}, { [ENV_VARS.hookTimeoutMs]: '45000' });
    expect(cfg.hookTimeoutMs).toBe(45_000);
  });
  test('显式入参 > env', () => {
    const cfg = loadDaemonConfig({ hookTimeoutMs: 60_000 }, { [ENV_VARS.hookTimeoutMs]: '45000' });
    expect(cfg.hookTimeoutMs).toBe(60_000);
  });
  test('env 非正整数（0/负/NaN/浮点）= 忽略，用缺省（静默回缺省面）', () => {
    for (const bad of ['0', '-5', 'abc', '1.5']) {
      const cfg = loadDaemonConfig({}, { [ENV_VARS.hookTimeoutMs]: bad });
      expect(cfg.hookTimeoutMs).toBe(WORKSPACE_HOOK_TIMEOUT_MS);
    }
  });
});

describe('本地状态布局（02 §5.3）', () => {
  test('ensureStateDirs 建齐 home + outbox/chat-sessions/agent-runtime/workspaces', () => {
    const home = join(tmp(), 'pacman-home');
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

  test('machine.json 形状校验：坏 token 拒读（64hex，r3 §1.3）', () => {
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
    expect(forgetMachine(paths)).toBe(true); // logout 只 Forget 本机（02 §5.2）
    expect(loadMachineJson(paths)).toBeNull();
    expect(forgetMachine(paths)).toBe(false);
  });

  test('device.json 32hex 生成且稳定（r3 §1.3 设备指纹）', () => {
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

  test('chat-sessions 索引：sessionId → sessionFile（continueSession 解析键）', () => {
    const paths = statePaths(tmp());
    ensureStateDirs(paths);
    recordSession(paths, 'sess-1', '/x/sessions/sess-1.jsonl');
    expect(resolveSessionFile(paths, 'sess-1')).toBe('/x/sessions/sess-1.jsonl');
    expect(resolveSessionFile(paths, 'nope')).toBeNull();
  });
});
