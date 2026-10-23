// 上线序列 canon + server 迁移诊断（#1128 自 machine-loop.test.ts 拆分；共享 harness 收编位
// = ./machine-loop-harness.ts，每个测试自 boot 自停）。

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { boot, FakeMachineApi, waitFor } from './machine-loop-harness.js';

describe('上线序列 canon（02 §5.4/r3 §1.5）', () => {
  test('未注册 → enroll → 全序列行序', async () => {
    const { handle, api, lines, paths } = await boot({});
    await waitFor(() => lines.some((l) => l.includes('[wake] push channel connected')));
    expect(lines[0]).toBe('Loading pi runtime…');
    expect(lines).toContain('Enrolled in team team-1 (machine m1)'); // r3 §1.2 行形
    expect(lines.some((l) => l === 'Online (machineId=m1); polling http://server')).toBe(true);
    expect(lines).toContain('[recover] no pending steps found');
    expect(lines).toContain('[wake] push channel connected');
    // 行序 = canon 序（recover 在 Online 后、wake 在 recover 后）。
    const idx = (s: string) => lines.findIndex((l) => l.includes(s));
    expect(idx('Loading pi runtime')).toBeLessThan(idx('Online (machineId'));
    expect(idx('Online (machineId')).toBeLessThan(idx('[recover]'));
    expect(idx('[recover]')).toBeLessThan(idx('[wake] push channel connected'));
    // enroll 落 machine.json（02 §5.3）。
    expect(existsSync(paths.machineJson)).toBe(true);
    expect(JSON.parse(readFileSync(paths.machineJson, 'utf8')).machineId).toBe('m1');
    expect(api.calls[0]).toBe('enroll:team-1');
    // #707：enroll 即带本机模型上报（installed/hostname/models 形状不断言
    // 内容——读的是测试机真实 ~/.claude，只钉上报动作与形状）。
    const enrollBody = api.enrollBodies[0] as { claudeCode?: unknown };
    const report = enrollBody.claudeCode as {
      installed: boolean;
      hostname: string;
      models: unknown[];
    };
    expect(typeof report.installed).toBe('boolean');
    expect(typeof report.hostname).toBe('string');
    expect(report.hostname).not.toBe('');
    expect(Array.isArray(report.models)).toBe(true);
    // presence 首跳同样带上报。
    await waitFor(() => api.presenceBodies.length > 0);
    expect((api.presenceBodies[0] as { claudeCode?: unknown }).claudeCode !== undefined).toBe(true);
    // #1251：enroll/presence 同带机器能力清单（形状断言——真探针读测试机
    // 真实 ~/.claude.json / 技能目录，内容不断言；内容级钉桩见下一用例）。
    const caps = (enrollBody as { capabilities?: unknown }).capabilities as {
      mcpServers: unknown;
      skills: unknown;
    };
    expect(Array.isArray(caps.mcpServers)).toBe(true);
    expect(Array.isArray(caps.skills)).toBe(true);
    expect((api.presenceBodies[0] as { capabilities?: unknown }).capabilities !== undefined).toBe(
      true,
    );
    await handle.stop();
    await handle.done;
    expect(lines).toContain('[machine] Shutting down…'); // r3 §1.5 退出行
  });

  test('#1251 能力清单随 enroll 与每拍 presence 上行（注入桩钉内容）', async () => {
    const { handle, api } = await boot({
      capabilitiesProbe: () => ({ mcpServers: ['figma'], skills: ['verify-cairn'] }),
    });
    await waitFor(() => api.presenceBodies.length > 0);
    expect((api.enrollBodies[0] as { capabilities?: unknown }).capabilities).toEqual({
      mcpServers: ['figma'],
      skills: ['verify-cairn'],
    });
    expect((api.presenceBodies[0] as { capabilities?: unknown }).capabilities).toEqual({
      mcpServers: ['figma'],
      skills: ['verify-cairn'],
    });
    await handle.stop();
    await handle.done;
  });

  test('stop(cause) 退出行带原因后缀（#691：信号名可考）', async () => {
    const { handle, lines } = await boot({});
    await waitFor(() => lines.some((l) => l.includes('[wake] push channel connected')));
    await handle.stop('SIGTERM');
    await handle.done;
    expect(lines).toContain('[machine] Shutting down… (SIGTERM)');
  });
});

describe('server 迁移诊断（#519 控制面搬家：machine.json 注册时 serverUrl 与现配置不一致）', () => {
  test('失败方式：旧 machine.json + 新 CAIRN_SERVER → 启动即警告行（含两地址与再注册指引），照常上线', async () => {
    const api = new FakeMachineApi();
    const { handle, lines } = await boot({
      api,
      preEnrolled: { serverUrl: 'http://old-host:8787' },
    });
    await waitFor(() =>
      lines.some((l) => l.includes('Online (machineId=m-old); polling http://server')),
    );
    // 警告行：[machine] 前缀、含新旧两个地址、含 re-enroll 指引。
    const warn = lines.find((l) => l.includes('[machine]') && l.includes('re-enroll'));
    expect(warn).toBeDefined();
    expect(warn).toContain('http://old-host:8787');
    expect(warn).toContain('http://server');
    // 既有注册被沿用（不重复 enroll），轮询继续走配置地址。
    expect(api.calls).not.toContain('enroll:team-1');
    await handle.stop();
    await handle.done;
  });

  test('一致（或未注册）→ 无该警告行', async () => {
    const api = new FakeMachineApi();
    const { handle, lines } = await boot({ api, preEnrolled: { serverUrl: 'http://server' } });
    await waitFor(() => lines.some((l) => l.includes('Online (machineId=m-old)')));
    expect(lines.some((l) => l.includes('re-enroll'))).toBe(false);
    await handle.stop();
    await handle.done;
  });
});
