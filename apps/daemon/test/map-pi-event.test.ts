// 事件映射纯函数面（02 §5.6 pi 词表 → 01 §5 StepEvent 缝词表的宿主投影，
// 映射登记 = backend/pi.ts 头注 [推断]）。pi 包不在测试面出现——缝纪律。

import { THINKING_LEVELS } from '@pacman/shared';
import { describe, expect, test } from 'vitest';
import {
  type AgentSessionEventLike,
  mapPiSessionEvent,
  newMapState,
  PI_CAPABILITIES,
} from '../src/backend/pi.js';

function map(ev: AgentSessionEventLike, state = newMapState()) {
  return mapPiSessionEvent(ev, state);
}

describe('mapPiSessionEvent（AgentSessionEvent → StepEvent 投影）', () => {
  test('text_delta → text_delta + message_update 双事件', () => {
    const out = map({
      type: 'message_update',
      message: { role: 'assistant', content: [{ type: 'text', text: 'OK' }] },
      assistantMessageEvent: { type: 'text_delta', delta: 'OK' },
    });
    expect(out).toEqual([
      { type: 'text_delta', text: 'OK' },
      {
        type: 'message_update',
        message: { role: 'assistant', content: [{ type: 'text', text: 'OK' }] },
      },
    ]);
  });

  test('thinking_delta → thinking_delta；thinking_end → thinking（块全文）', () => {
    const msg = { role: 'assistant' };
    expect(
      map({
        type: 'message_update',
        message: msg,
        assistantMessageEvent: { type: 'thinking_delta', delta: 'hmm' },
      })[0],
    ).toEqual({ type: 'thinking_delta', text: 'hmm' });
    expect(
      map({
        type: 'message_update',
        message: msg,
        assistantMessageEvent: { type: 'thinking_end', content: 'hmm full' },
      }),
    ).toEqual([{ type: 'thinking', text: 'hmm full' }]);
  });

  test('toolcall_end 两段：调用块（无 result）→ 执行完（含 result，同 id）', () => {
    const state = newMapState();
    const first = map(
      {
        type: 'message_update',
        message: { role: 'assistant' },
        assistantMessageEvent: {
          type: 'toolcall_end',
          toolCall: { id: 'c1', name: 'edit', arguments: { path: 'README.md' } },
        },
      },
      state,
    );
    expect(first).toEqual([
      { type: 'toolcall_end', call: { id: 'c1', name: 'edit', arguments: { path: 'README.md' } } },
    ]);
    const second = map(
      {
        type: 'tool_execution_end',
        toolCallId: 'c1',
        toolName: 'edit',
        result: { ok: 1 },
        isError: false,
      },
      state,
    );
    expect(second).toHaveLength(1);
    const call = (second[0] as { call: Record<string, unknown> }).call;
    expect(call.id).toBe('c1');
    expect(call.arguments).toEqual({ path: 'README.md' }); // 前段参数保留
    expect(call.result).toEqual({ ok: 1 });
    expect(call.isError).toBe(false);
  });

  test('message_end 累积 usage（provider/model 键）；done 携累积值', () => {
    const state = newMapState();
    map(
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          provider: 'stub-gw',
          model: 'stub-model',
          stopReason: 'stop',
          usage: { input: 12, output: 980, cacheRead: 100, cacheWrite: 50 },
        },
      },
      state,
    );
    map(
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          provider: 'stub-gw',
          model: 'stub-model',
          stopReason: 'stop',
          usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
        },
      },
      state,
    );
    // 收敛信号 = agent_settled（#926）：pi 不再自动继续时才发 done，携累积 usage。
    const done = map({ type: 'agent_settled' }, state);
    expect(done).toEqual([
      {
        type: 'done',
        usage: [
          { model: 'stub-gw/stub-model', input: 13, output: 982, cacheRead: 100, cacheWrite: 50 },
        ],
      },
    ]);
  });

  // —— #926 收敛判定：agent_settled 取代 agent_end(!willRetry) 猜测 ——————————
  // pi docs/sdk.md §Subscribing：agent_end 标记「一次低层 run 结束」，但自动恢复
  // 或排队工作（steering/followUp/overflow 恢复）可能随后继续；agent_settled 才是
  // 「pi 不会再自动继续」的权威信号。旧映射用 agent_end(!willRetry) 猜收敛 =
  // 时序赌博：willRetry 只覆盖「错误重试」一条继续路径，排队工作/溢出恢复继续时
  // willRetry=false 仍会提前发 done（并 dispose 会话、掐死后续 run）。

  test('agent_end 恒不发 done（无论 willRetry——收敛已移 agent_settled）', () => {
    expect(map({ type: 'agent_end', willRetry: true })).toEqual([]);
    expect(map({ type: 'agent_end', willRetry: false })).toEqual([]);
  });

  test('「模型还会继续」路径：agent_end(!willRetry) 后仍有 run，done 不提前发', () => {
    const state = newMapState();
    // 首轮 assistant 收尾 → 一次低层 run 结束（willRetry=false，但排队工作随后继续）。
    map(
      {
        type: 'message_end',
        message: { role: 'assistant', provider: 'gw', model: 'm', stopReason: 'stop' },
      },
      state,
    );
    // 旧映射在此发 done（提前）；新映射不发——收敛尚未到达。
    expect(map({ type: 'agent_end', willRetry: false }, state)).toEqual([]);
    // 排队工作驱动的第二轮 run（旧映射已 dispose 会话，这段本不会发生）。
    const continued = map(
      {
        type: 'message_end',
        message: { role: 'assistant', provider: 'gw', model: 'm', stopReason: 'stop' },
      },
      state,
    );
    expect(continued.some((e) => e.type === 'done')).toBe(false);
    // 真正收敛：agent_settled 才发 done（本例 message_end 不带 usage，累积面为空——
    // 本测钉的是收敛时机，usage 累积由上一用例覆盖）。
    const done = map({ type: 'agent_settled' }, state);
    expect(done).toEqual([{ type: 'done', usage: [] }]);
  });

  test('「确实结束」路径：agent_settled 按时发 done（反向构造）', () => {
    const state = newMapState();
    map(
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          provider: 'gw',
          model: 'm',
          stopReason: 'stop',
          usage: { input: 5, output: 7, cacheRead: 0, cacheWrite: 0 },
        },
      },
      state,
    );
    map({ type: 'agent_end', willRetry: false }, state);
    const done = map({ type: 'agent_settled' }, state);
    expect(done).toEqual([
      {
        type: 'done',
        usage: [{ model: 'gw/m', input: 5, output: 7, cacheRead: 0, cacheWrite: 0 }],
      },
    ]);
  });

  // —— #927 成本维：pi 报的 per-message usage.cost 原样累积（不自造价格表，
  // 数值 = pi calculateCost 产物），message_end 行携 per-message usage 供追溯。
  test('#927 cost：per-message usage.cost 累积进 per-model 行；done 携 cost', () => {
    const state = newMapState();
    const first = map(
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          provider: 'stub-gw',
          model: 'stub-model',
          stopReason: 'stop',
          usage: {
            input: 0,
            output: 980,
            cacheRead: 100,
            cacheWrite: 0,
            cost: { input: 0, output: 1960, cacheRead: 50, cacheWrite: 0, total: 2010 },
          },
        },
      },
      state,
    );
    // 事件流追溯面：message_end 行携该条消息的 usage（含 cost）原样。
    expect((first[0] as { message: { usage?: unknown } }).message.usage).toEqual({
      input: 0,
      output: 980,
      cacheRead: 100,
      cacheWrite: 0,
      cost: { input: 0, output: 1960, cacheRead: 50, cacheWrite: 0, total: 2010 },
    });
    map(
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          provider: 'stub-gw',
          model: 'stub-model',
          stopReason: 'stop',
          usage: {
            input: 3,
            output: 2,
            cacheRead: 1,
            cacheWrite: 0,
            cost: { input: 3, output: 4, cacheRead: 0.5, cacheWrite: 0, total: 7.5 },
          },
        },
      },
      state,
    );
    const done = map({ type: 'agent_settled' }, state);
    expect(done).toEqual([
      {
        type: 'done',
        usage: [
          {
            model: 'stub-gw/stub-model',
            input: 3,
            output: 982,
            cacheRead: 101,
            cacheWrite: 0,
            cost: { input: 3, output: 1964, cacheRead: 50.5, cacheWrite: 0, total: 2017.5 },
          },
        ],
      },
    ]);
  });

  test('#927 回归：usage 无 cost（旧形投影）→ 四维累积零变化、不产 cost 键', () => {
    const state = newMapState();
    map(
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          provider: 'p',
          model: 'm',
          stopReason: 'stop',
          usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
        },
      },
      state,
    );
    const done = map({ type: 'agent_settled' }, state);
    const usage = (done[0] as { usage: Record<string, unknown>[] }).usage[0]!;
    expect(usage).not.toHaveProperty('cost');
    expect(usage).toEqual({ model: 'p/m', input: 1, output: 2, cacheRead: 3, cacheWrite: 4 });
  });

  test('stopReason=length 透传 rawStopReason / responseModel（#1512）', () => {
    const out = map({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: 'cut off',
        stopReason: 'length',
        rawStopReason: 'max_tokens',
        responseModel: 'claude-opus-4',
      },
    });
    expect(out).toEqual([
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          content: 'cut off',
          stopReason: 'length',
          rawStopReason: 'max_tokens',
          responseModel: 'claude-opus-4',
        },
      },
    ]);
  });

  test('stopReason=error → message_end + error{retryable 判定}；aborted → message_stop', () => {
    const err = map({
      type: 'message_end',
      message: { role: 'assistant', stopReason: 'error', errorMessage: 'rate limit hit' },
    });
    expect(err[1]).toEqual({
      type: 'error',
      error: { message: 'rate limit hit', retryable: true },
    });
    const fatal = map({
      type: 'message_end',
      message: { role: 'assistant', stopReason: 'error', errorMessage: 'invalid prompt' },
    });
    expect((fatal[1] as { error: { retryable: boolean } }).error.retryable).toBe(false);
    // #882 装饰位：宿主注入的 diagnose 追加响应真实形态；retryable 仍取**原始**
    // 文案——追加段里带状态码数字，先判再装饰才不会被自己的诊断带偏。
    const decorated = mapPiSessionEvent(
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'error',
          errorMessage: 'Stream ended without finish_reason',
        },
      },
      newMapState({
        diagnose: (m) =>
          `${m}\nprovider response: POST http://host/chat/completions -> 200 text/html (not an SSE stream); first bytes: "<!doctype html>"; status 500 note`,
      }),
    );
    expect((decorated[1] as { error: { message: string } }).error.message).toContain(
      'POST http://host/chat/completions -> 200 text/html',
    );
    // 装饰段里带 `500`，原始文案里没有 → retryable 必须是 false。
    expect((decorated[1] as { error: { retryable: boolean } }).error.retryable).toBe(false);
    const stopped = map({
      type: 'message_end',
      message: { role: 'assistant', stopReason: 'aborted' },
    });
    expect(stopped).toEqual([
      {
        type: 'message_stop',
        // stopReason 透传（#708：pi 结构化终态位随消息行投影——错误终局行
        // 不算进展的判定依据；messageRecordSchema loose 面不改 wire）。
        message: { role: 'assistant', content: null, stopReason: 'aborted' },
      },
    ]);
  });

  test('auto_retry_start/end 与 compaction_start/end 同名直通', () => {
    expect(map({ type: 'auto_retry_start', attempt: 2 })).toEqual([
      { type: 'auto_retry_start', attempt: 2 },
    ]);
    expect(map({ type: 'auto_retry_end', attempt: 2 })).toEqual([
      { type: 'auto_retry_end', attempt: 2 },
    ]);
    expect(map({ type: 'compaction_start' })).toEqual([{ type: 'compaction_start' }]);
    expect(map({ type: 'compaction_end' })).toEqual([{ type: 'compaction_end' }]);
  });

  test('非词表事件（agent_start/turn_end/queue_update 族）不产生 StepEvent', () => {
    for (const type of [
      'agent_start',
      'turn_start',
      'turn_end',
      'queue_update',
      'entry_appended',
    ]) {
      expect(map({ type })).toEqual([]);
    }
  });

  test('toolResult role 投影到 message 词表（system/user/assistant，r5 §3.6）', () => {
    const out = map({ type: 'message_end', message: { role: 'toolResult', content: 'r' } });
    expect((out[0] as { message: { role: string } }).message.role).toBe('system');
  });
});

describe('PI_CAPABILITIES（01 §5 能力面）', () => {
  test('name/oauth 四家/思考强度七档/compaction/sessionResume', () => {
    expect(PI_CAPABILITIES.name).toBe('pi');
    expect(PI_CAPABILITIES.oauthProviders).toEqual([
      'anthropic',
      'openai-codex',
      'github-copilot',
      'xai',
    ]); // 02 §5.6/#34 锁定订阅项
    expect(PI_CAPABILITIES.thinkingLevels).toEqual([
      'off',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    // 单源约束（XMON-16）：能力面必须是 shared 的那一个数组本身，不是等价
    // 副本——跨缝复制常量会让两份真值各自漂移，toEqual 挡不住。引用同一性
    // 才挡得住。
    expect(PI_CAPABILITIES.thinkingLevels).toBe(THINKING_LEVELS);
    expect(PI_CAPABILITIES.compaction).toBe(true);
    expect(PI_CAPABILITIES.sessionResume).toBe(true); // continue session（02 §4.2）
  });
});
