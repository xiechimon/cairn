// #1204 返工降级注入的组合形状（buildReworkFallbackPrompt 单源）：
// continue 步续接失败回退新会话时的首轮 prompt = 任务文本 + 续轮指令 + 降级
// 上下文（方案全文 + 全部历史返工意见）。失败方式（先于实现固化）：
//  1. 全量组合的分段形状：任务文本/指令/上下文三段以空行分隔，方案与意见
//     各自成段、意见逐条编号——形状钉死（daemon 测试按 contains 消费，此
//     处钉精确串）。
//  2. planText null → 方案段缺席（无空段残留）。
//  3. feedbacks 空 → 意见段缺席。
//  4. 两段皆空 → 纯 #720 组合形状（任务文本 + 指令，零降级噪音）。

import { describe, expect, test } from 'vitest';
import { buildReworkFallbackPrompt } from '../src/records/prompts.js';

const TASK = '返工探针\n\n写一行探针';
const INSTRUCTION = '用户在审核关口请求修改。修改反馈：「改掉按钮文案」。';
const PLAN = '# 方案 v1\n\n- Context: 探针';

describe('#1204 buildReworkFallbackPrompt（返工降级注入组合）', () => {
  test('全量：任务文本 + 指令 + 方案段 + 意见段（逐条编号），空行分段', () => {
    const out = buildReworkFallbackPrompt({
      taskText: TASK,
      instruction: INSTRUCTION,
      planText: PLAN,
      feedbacks: ['第一条返工意见', '第二条返工意见'],
    });
    expect(out).toBe(
      `${TASK}\n\n${INSTRUCTION}\n\n原会话不可复用，已用新会话重跑。以下是本会话的既有事实，新会话无前轮记忆，凭此重建：\n\n当前方案（plan.md 全文）：\n${PLAN}\n\n历史返工意见（按时间序，全部）：\n1. 第一条返工意见\n2. 第二条返工意见`,
    );
  });

  test('planText null → 方案段缺席', () => {
    const out = buildReworkFallbackPrompt({
      taskText: TASK,
      instruction: INSTRUCTION,
      planText: null,
      feedbacks: ['意见一'],
    });
    expect(out).not.toContain('plan.md');
    expect(out).toContain('历史返工意见');
  });

  test('feedbacks 空 → 意见段缺席', () => {
    const out = buildReworkFallbackPrompt({
      taskText: TASK,
      instruction: INSTRUCTION,
      planText: PLAN,
      feedbacks: [],
    });
    expect(out).toContain('当前方案（plan.md 全文）');
    expect(out).not.toContain('历史返工意见');
  });

  test('两段皆空 → 纯 #720 组合形状（零降级噪音）', () => {
    const out = buildReworkFallbackPrompt({
      taskText: TASK,
      instruction: INSTRUCTION,
      planText: null,
      feedbacks: [],
    });
    expect(out).toBe(`${TASK}\n\n${INSTRUCTION}`);
  });
});
