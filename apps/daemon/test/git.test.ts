// git.ts 凭证注入单测（02 §8 per-step 凭证不落盘 + credential.helper 空值重置
// 契约）。功能面用真 `git credential fill` 复现：全局 helper 返回陈旧密码时，
// gitCredentialEnv 的空值重置使内联 fresh 密码胜出——平台无关回归护栏
// （integration demo 仅在带 osxkeychain 的 macOS 才自然复现该叠加）。
// #1225 machine 凭据路（票失败方式 1/2/4 的原语半）：
//   1. 两路都试过仍失败 → 合并错误点名两路（integration + machine），不静默
//   2. 来源/降级事件面永不携带 token 值（onFallback 只回传 git 原文）
//   3. machine 路不重置 credential.helper（与 integration 路互为反面）
//   4. machine 路不碰代理变量（mea HTTP_PROXY/NO_PROXY 语义与现网一致）
//   5. auth 失败 = 确定性失败：withGitNetRetries 不再对它烧 6s 重试预算

import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import {
  type GitFallbackReason,
  gitCredentialEnv,
  gitPrim,
  isGitAuthFailure,
  machineGitEnv,
  runGit,
  runGitOk,
  withGitCredentialFallback,
  withGitNetRetries,
} from '../src/git.js';

const CRED = { username: 'git', password: 'pacman_fresh_token_123' };

/** 票 #1225 现象段原文（mea 2026-10-11 实测 push 失败 stderr）。 */
const MEA_AUTH_FAILURE =
  'remote: Invalid username or token. Password authentication is not supported.\n' +
  "fatal: Authentication failed for 'https://github.com/xiechimon/pacman.git/'";

describe('gitCredentialEnv — per-step 凭证 env 注入（02 §8 不落盘）', () => {
  test('前置空值 credential.helper 重置系统/全局 helper 列表', () => {
    // 父环境显式为空：断言的是无继承 GIT_CONFIG_* 时的形状（#1460 起父环境
    // 自带条目时整体后移，见下一 describe）。
    const env = gitCredentialEnv(CRED, {});
    // 重置条目须在首位：空值清空此前系统级/全局累积的全部 helper（如
    // osxkeychain），否则同主机陈旧（已撤销）token 被优先命中 → auth 失败，
    // 且成功轮会回写钥匙串（凭证落盘面，破 02 §8 不落盘纪律）。
    expect(env.GIT_CONFIG_COUNT).toBe('2');
    expect(env.GIT_CONFIG_KEY_0).toBe('credential.helper');
    expect(env.GIT_CONFIG_VALUE_0).toBe('');
    // 本步唯一凭证来源 = 内联 helper（echo username/password）。
    expect(env.GIT_CONFIG_KEY_1).toBe('credential.helper');
    expect(env.GIT_CONFIG_VALUE_1).toContain(`username=${CRED.username}`);
    expect(env.GIT_CONFIG_VALUE_1).toContain(`password=${CRED.password}`);
    // 交互提示关闭（无 tty 挂起护栏）。
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
  });

  test('空值重置使内联凭证压过全局 helper（真 git credential fill）', () => {
    const home = mkdtempSync(join(tmpdir(), 'pacman-git-cred-'));
    // 全局 helper（绝对路径）恒返回 STALE——等价 osxkeychain 命中陈旧凭证。
    const staleHelper = join(home, 'stale-helper.sh');
    writeFileSync(staleHelper, '#!/bin/sh\necho username=git\necho password=STALE_REVOKED\n');
    chmodSync(staleHelper, 0o755);
    writeFileSync(join(home, '.gitconfig'), `[credential]\n\thelper = ${staleHelper}\n`);

    const res = spawnSync('git', ['credential', 'fill'], {
      input: 'protocol=http\nhost=127.0.0.1:1\n\n',
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: home,
        GIT_CONFIG_NOSYSTEM: '1', // 隔离 Xcode 系统 gitconfig（同样含 osxkeychain）
        ...gitCredentialEnv(CRED),
      },
    });
    const out = res.stdout ?? '';
    // 内联 fresh 凭证胜出；陈旧全局 helper 被空值重置清除，不参与填充。
    expect(out).toContain(`password=${CRED.password}`);
    expect(out).not.toContain('STALE_REVOKED');
  });
});

// —— #1460 父环境自带 GIT_CONFIG_*（容器 / CI 的代理、CA 配置）——————
//   1. 父环境 n 条合法条目 → 原样保留，重置与 helper 落在 n、n+1，COUNT=n+2
//   2. 父环境无 GIT_CONFIG_* → 形状不变（COUNT=2，helper 在 1）
//   3. 父环境 COUNT 非十进制整数，或 0..n-1 缺 KEY / VALUE → git 在父环境下
//      本就报错，退回从 0 写（与修复前相同），凭证调用照常
//   4. 父环境条目里的 credential.helper 被其后的空值重置清掉：内联 helper
//      仍是唯一凭证来源
//   5. 生产组合（runGit 合并 process.env）走默认父环境 = process.env

/** process.env 去掉继承的 GIT_CONFIG_*（云端容器自带三条代理配置）。 */
const envWithoutGitConfig = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_CONFIG_')));

describe('gitCredentialEnv — 追加在父环境的 GIT_CONFIG_* 之后（#1460）', () => {
  const PARENT: NodeJS.ProcessEnv = {
    GIT_CONFIG_COUNT: '3',
    GIT_CONFIG_KEY_0: 'http.proxy',
    GIT_CONFIG_VALUE_0: 'http://127.0.0.1:3128',
    GIT_CONFIG_KEY_1: 'http.sslCAInfo',
    GIT_CONFIG_VALUE_1: '/etc/ssl/proxy-ca.crt',
    GIT_CONFIG_KEY_2: 'credential.helper',
    GIT_CONFIG_VALUE_2: 'store',
  };

  test('失败方式 1：父环境 3 条原样保留，重置与 helper 落在 3、4，COUNT=5', () => {
    // 调用方的合并形：{ ...父环境, ...gitCredentialEnv(cred) }。
    const env = { ...PARENT, ...gitCredentialEnv(CRED, PARENT) };
    expect(env.GIT_CONFIG_COUNT).toBe('5');
    for (const i of [0, 1, 2]) {
      expect(env[`GIT_CONFIG_KEY_${i}`]).toBe(PARENT[`GIT_CONFIG_KEY_${i}`]);
      expect(env[`GIT_CONFIG_VALUE_${i}`]).toBe(PARENT[`GIT_CONFIG_VALUE_${i}`]);
    }
    expect(env.GIT_CONFIG_KEY_3).toBe('credential.helper');
    expect(env.GIT_CONFIG_VALUE_3).toBe('');
    expect(env.GIT_CONFIG_KEY_4).toBe('credential.helper');
    expect(env.GIT_CONFIG_VALUE_4).toContain(`password=${CRED.password}`);
  });

  test('失败方式 2：父环境无 GIT_CONFIG_* → COUNT=2，重置在 0、helper 在 1', () => {
    const env = gitCredentialEnv(CRED, { PATH: '/usr/bin', HOME: '/home/x' });
    expect(env.GIT_CONFIG_COUNT).toBe('2');
    expect(env.GIT_CONFIG_VALUE_0).toBe('');
    expect(env.GIT_CONFIG_VALUE_1).toContain(`password=${CRED.password}`);
    expect(Object.keys(env).filter((k) => k.startsWith('GIT_CONFIG_'))).toHaveLength(5);
  });

  test.each<[string, NodeJS.ProcessEnv]>([
    ['非数字', { GIT_CONFIG_COUNT: 'abc' }],
    ['负数', { GIT_CONFIG_COUNT: '-1' }],
    ['尾随字符', { GIT_CONFIG_COUNT: '1x', GIT_CONFIG_KEY_0: 'a.b', GIT_CONFIG_VALUE_0: 'c' }],
    ['缺 KEY', { GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'a.b', GIT_CONFIG_VALUE_0: 'c' }],
    ['缺 VALUE', { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'a.b' }],
  ])('失败方式 3：父环境 COUNT %s → 退回从 0 写（COUNT=2）', (_label, parent) => {
    const env = { ...parent, ...gitCredentialEnv(CRED, parent) };
    expect(env.GIT_CONFIG_COUNT).toBe('2');
    expect(env.GIT_CONFIG_KEY_0).toBe('credential.helper');
    expect(env.GIT_CONFIG_VALUE_0).toBe('');
    expect(env.GIT_CONFIG_VALUE_1).toContain(`password=${CRED.password}`);
  });

  test('失败方式 1/4：真 git——父环境的键仍生效，父环境的 credential.helper 被重置', () => {
    const home = mkdtempSync(join(tmpdir(), 'pacman-git-cred-parent-'));
    const staleHelper = join(home, 'stale-helper.sh');
    writeFileSync(staleHelper, '#!/bin/sh\necho username=git\necho password=STALE_REVOKED\n');
    chmodSync(staleHelper, 0o755);
    const parent: NodeJS.ProcessEnv = {
      ...envWithoutGitConfig(),
      HOME: home,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'pacman.probe',
      GIT_CONFIG_VALUE_0: 'kept',
      GIT_CONFIG_KEY_1: 'credential.helper',
      GIT_CONFIG_VALUE_1: staleHelper,
    };
    const env = { ...parent, ...gitCredentialEnv(CRED, parent) };

    const probe = spawnSync('git', ['config', '--get', 'pacman.probe'], { encoding: 'utf8', env });
    expect(probe.stdout.trim()).toBe('kept');

    const fill = spawnSync('git', ['credential', 'fill'], {
      input: 'protocol=http\nhost=127.0.0.1:1\n\n',
      encoding: 'utf8',
      env,
    });
    expect(fill.stdout).toContain(`password=${CRED.password}`);
    expect(fill.stdout).not.toContain('STALE_REVOKED');
  });

  test('失败方式 5：runGit 组合——默认父环境 = process.env，进程自带的键仍生效', async () => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('GIT_CONFIG_')) vi.stubEnv(k, undefined);
    }
    vi.stubEnv('GIT_CONFIG_COUNT', '1');
    vi.stubEnv('GIT_CONFIG_KEY_0', 'pacman.probe');
    vi.stubEnv('GIT_CONFIG_VALUE_0', 'kept');
    try {
      const env = gitCredentialEnv(CRED);
      expect(env.GIT_CONFIG_COUNT).toBe('3');
      const out = await runGitOk(['config', '--get', 'pacman.probe'], { env });
      expect(out).toBe('kept');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

// —— #1225 machine 凭据路原语（Multica repocache gitEnv 同律：完整环境 +
// TTY 守卫，服务端零分发时执行机自己的 credential helper 生效）——————

describe('machineGitEnv — 执行机本机凭据 env（#1225 兜底路）', () => {
  test('只设 TTY 守卫：不重置 credential.helper、不碰代理变量（票失败方式 3/4）', () => {
    const env = machineGitEnv();
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
    // 不带 GIT_CONFIG_*——机器自己的 helper 列表（osxkeychain/store/gh）原样生效；
    // gitCredentialEnv 的空值重置是 integration 路独有语义，machine 路是它的反面。
    expect(Object.keys(env).some((k) => k.startsWith('GIT_CONFIG_'))).toBe(false);
    // 代理变量零触碰：mea 的 HTTP_PROXY=127.0.0.1:7890 与 tailnet NO_PROXY
    // 语义只由进程环境传递（runGit 合并 process.env），本函数不改写。
    const proxyKeys = Object.keys(env).filter((k) => /_proxy$/i.test(k) || /^no_proxy$/i.test(k));
    expect(proxyKeys).toEqual([]);
    // 对照：integration 路同样不碰代理（两路代理语义一致，谁都不许改）。
    const integrationKeys = Object.keys(gitCredentialEnv(CRED)).filter(
      (k) => /_proxy$/i.test(k) || /^no_proxy$/i.test(k),
    );
    expect(integrationKeys).toEqual([]);
  });

  test('machine 路下全局 helper 正常应答（真 git credential fill，与重置测试互为反面）', () => {
    const home = mkdtempSync(join(tmpdir(), 'pacman-git-machine-'));
    const machineHelper = join(home, 'machine-helper.sh');
    writeFileSync(machineHelper, '#!/bin/sh\necho username=git\necho password=MACHINE_OWN_TOKEN\n');
    chmodSync(machineHelper, 0o755);
    writeFileSync(join(home, '.gitconfig'), `[credential]\n\thelper = ${machineHelper}\n`);

    const res = spawnSync('git', ['credential', 'fill'], {
      input: 'protocol=http\nhost=127.0.0.1:1\n\n',
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: home,
        GIT_CONFIG_NOSYSTEM: '1',
        ...machineGitEnv(),
      },
    });
    // machine 路没有空值重置 → 全局 helper 是凭据来源（执行机自己的凭据生效）。
    expect(res.stdout ?? '').toContain('password=MACHINE_OWN_TOKEN');
  });
});

describe('isGitAuthFailure — 认证失败判定（降级触发器）', () => {
  test('认证失败原文 → true（mea 实测原文 / 无凭据 / 401 族）', () => {
    expect(isGitAuthFailure(MEA_AUTH_FAILURE)).toBe(true);
    expect(
      isGitAuthFailure(
        "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
      ),
    ).toBe(true);
    expect(
      isGitAuthFailure('error: RPC failed; HTTP 401 curl 22 The requested URL returned error: 401'),
    ).toBe(true);
    expect(
      isGitAuthFailure('remote: HTTP Basic: Access denied\nfatal: Authentication failed'),
    ).toBe(true);
  });

  test('非认证失败 → false（不降级：网络/5xx/404/403/冲突/超时）', () => {
    expect(
      isGitAuthFailure(
        'fatal: unable to access: Failed to connect to github.com port 443: Connection refused',
      ),
    ).toBe(false);
    expect(
      isGitAuthFailure('error: RPC failed; HTTP 502 curl 22 The requested URL returned error: 502'),
    ).toBe(false);
    expect(isGitAuthFailure('remote: Permission to o/r.git denied to user')).toBe(false);
    expect(isGitAuthFailure('fatal: repository not found')).toBe(false);
    expect(isGitAuthFailure('merge conflict against origin/main (aborted)')).toBe(false);
    expect(isGitAuthFailure('git fetch timed out after 480000ms')).toBe(false);
  });
});

describe('withGitNetRetries — auth 失败确定性短路（#1225：401 重试不翻红）', () => {
  test('auth 失败不烧重试预算（单次即抛）', async () => {
    const op = vi.fn(async () => {
      throw new Error(MEA_AUTH_FAILURE);
    });
    await expect(withGitNetRetries(op)).rejects.toThrow('Invalid username or token');
    expect(op).toHaveBeenCalledTimes(1);
  });

  test('网络失败照旧重试（既有语义不变）', { timeout: 15_000 }, async () => {
    let calls = 0;
    const op = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error('Connection refused');
    });
    await expect(withGitNetRetries(op)).resolves.toBeUndefined();
    expect(op).toHaveBeenCalledTimes(3);
  });
});

describe('withGitCredentialFallback — 凭据序 integration 先行、machine 兜底（#1225）', () => {
  /** 记录每次调用收到的 cred 的 op 桩。 */
  function opStub(script: (cred: typeof CRED | null, call: number) => Promise<void> | void): {
    op: (cred: typeof CRED | null) => Promise<void>;
    calls: (typeof CRED | null)[];
  } {
    const calls: (typeof CRED | null)[] = [];
    return {
      op: async (cred) => {
        calls.push(cred);
        await script(cred, calls.length);
      },
      calls,
    };
  }

  test('integration 成功 → 单次调用，来源 integration（集成有效时行为不变）', async () => {
    const { op, calls } = opStub(() => {});
    const source = await withGitCredentialFallback(op, CRED, {
      what: 'push',
      allowMachineFallback: true,
    });
    expect(source).toBe('integration');
    expect(calls).toEqual([CRED]);
  });

  test('integration auth 失败 → machine 兜底成功，来源 machine，onFallback 收 git 原文', async () => {
    const { op, calls } = opStub((cred) => {
      if (cred !== null) throw new Error(MEA_AUTH_FAILURE);
    });
    const reasons: GitFallbackReason[] = [];
    const source = await withGitCredentialFallback(op, CRED, {
      what: 'push',
      allowMachineFallback: true,
      onFallback: (r) => reasons.push(r),
    });
    expect(source).toBe('machine');
    expect(calls).toEqual([CRED, null]);
    // 降级原因是 git 原文（不含凭据值——失败方式 2：token 永不进事件面）。
    expect(reasons).toEqual([MEA_AUTH_FAILURE]);
    expect(String(reasons[0])).not.toContain(CRED.password);
  });

  test('两路都 auth 失败 → 合并错误点名两路（票失败方式 1：不许静默）', async () => {
    const { op, calls } = opStub((cred) => {
      if (cred !== null) throw new Error(MEA_AUTH_FAILURE);
      throw new Error("fatal: could not read Username for 'https://github.com'");
    });
    const err = await withGitCredentialFallback(op, CRED, {
      what: 'push',
      allowMachineFallback: true,
    }).catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect(String(err)).toContain('push');
    expect(String(err)).toContain('per-step token');
    expect(String(err)).toContain('Invalid username or token');
    expect(String(err)).toContain('machine credentials');
    expect(String(err)).toContain('could not read Username');
    expect(calls).toEqual([CRED, null]);
  });

  test('非 auth 失败 → 原错误直抛，不降级（网络抖动不吃凭据序）', async () => {
    const { op, calls } = opStub(() => {
      throw new Error('Connection refused');
    });
    await expect(
      withGitCredentialFallback(op, CRED, { what: 'push', allowMachineFallback: true }),
    ).rejects.toThrow('Connection refused');
    expect(calls).toEqual([CRED]);
  });

  test('allowMachineFallback=false（hosted）→ auth 失败也不降级，单次调用（票失败方式 3）', async () => {
    const { op, calls } = opStub((cred) => {
      if (cred !== null) throw new Error(MEA_AUTH_FAILURE);
    });
    await expect(
      withGitCredentialFallback(op, CRED, { what: 'push', allowMachineFallback: false }),
    ).rejects.toThrow('Invalid username or token');
    expect(calls).toEqual([CRED]);
  });

  test('cred null（无 per-step token）→ 直接 machine 路，单次调用', async () => {
    const { op, calls } = opStub(() => {});
    const source = await withGitCredentialFallback(op, null, {
      what: 'push',
      allowMachineFallback: true,
    });
    expect(source).toBe('machine');
    expect(calls).toEqual([null]);
  });
});

describe('runGit — 信号终止不当作成功（#1329）', () => {
  // hash-object --stdin 要等 stdin 关闭才返回；超时后被 SIGTERM 杀掉，退出码为 null。
  const STDIN_BLOCKED = { timeoutMs: 200 };

  test('runGit 保留 null 退出码（信号终止），不映射为 0', async () => {
    const r = await runGit(['hash-object', '--stdin'], STDIN_BLOCKED);
    expect(r.code).toBeNull();
  });

  test('runGitOk 对信号终止抛错，错误文案点名信号', async () => {
    await expect(runGitOk(['hash-object', '--stdin'], STDIN_BLOCKED)).rejects.toThrow(
      'failed (signal SIGTERM)',
    );
  });
});

// #1316：git 2.43 的 reset 把 `--end-of-options` 留在 argv 里（PARSE_OPT_KEEP_DASHDASH），
// verify_filename 对 `-` 开头直接退出 128，checkpoint 恢复到不了目标提交。
// 选项形 revision（`--soft`）也不能被当成 reset 的模式旗标吃掉。

function gitOk(dir: string, args: string[]): string {
  const res = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(res.stderr || res.stdout || `git ${args[0]} failed`);
  }
  return (res.stdout ?? '').trim();
}

function dirtyRepo(objectFormat?: 'sha256'): { dir: string; sha: string } {
  const dir = mkdtempSync(join(tmpdir(), 'pacman-reset-hard-'));
  const init = ['init', '-b', 'main'];
  if (objectFormat) init.push('--object-format=sha256');
  gitOk(dir, init);
  gitOk(dir, ['config', 'user.email', 't@example.com']);
  gitOk(dir, ['config', 'user.name', 't']);
  writeFileSync(join(dir, 'README.md'), 'seed\n');
  gitOk(dir, ['add', 'README.md']);
  gitOk(dir, ['commit', '-m', 'seed']);
  const sha = gitOk(dir, ['rev-parse', 'HEAD']);
  writeFileSync(join(dir, 'README.md'), 'corrupted\n');
  return { dir, sha };
}

describe('resetHard — git 2.43 拒绝 reset --end-of-options（#1316）', () => {
  test('跟踪文件恢复到目标提交', async () => {
    const { dir, sha } = dirtyRepo();
    await gitPrim.resetHard(dir, sha);
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toBe('seed\n');
    expect(gitOk(dir, ['rev-parse', 'HEAD'])).toBe(sha);
  });

  test('sha256 对象 id 同样恢复', async () => {
    const { dir, sha } = dirtyRepo('sha256');
    expect(sha).toMatch(/^[0-9a-f]{64}$/);
    await gitPrim.resetHard(dir, sha);
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toBe('seed\n');
    expect(gitOk(dir, ['rev-parse', 'HEAD'])).toBe(sha);
  });

  test('选项形 revision 不改工作区', async () => {
    const { dir } = dirtyRepo();
    await expect(gitPrim.resetHard(dir, '--soft')).rejects.toThrow();
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toBe('corrupted\n');
  });

  test('不存在的 revision 不改工作区', async () => {
    const { dir } = dirtyRepo();
    await expect(gitPrim.resetHard(dir, 'does-not-exist')).rejects.toThrow();
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toBe('corrupted\n');
  });
});
