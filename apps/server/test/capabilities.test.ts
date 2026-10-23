// 能力读面（XMON-16 / #499 B3 裁决 A）：GET /api/capabilities = daemon 引擎
// 能力词表送 web 的那一条读面。此处钉的是读面契约——web 面消费它的那一半
// 在 apps/web（只读行渲染）。真值单源 = shared `THINKING_LEVELS`；本文件
// 只断言读面把那份词表原样送出来，不复算词表（七档期望值写成字面量，
// 来源 = 上游 pi-agent-core 的 ThinkingLevel 联合）。

import { capabilitiesResponseSchema } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { bootServer, req } from './helpers.js';

describe('GET /api/capabilities（能力读面）', () => {
  test('200 + 封套形状，档位 = pi 七档有序原样', async () => {
    const s = bootServer();
    const res = await req(s.app, 'GET', '/api/capabilities');
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(capabilitiesResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toEqual({
      thinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    });
  });

  test('队无关读面：不带 team 参数也答（能力是引擎的事实，不随团队分叉）', async () => {
    const s = bootServer();
    const res = await req(s.app, 'GET', '/api/capabilities');
    expect(res.status).toBe(200); // 无 requireTeam 闸
  });
});
