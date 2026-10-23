// #650/#651 总管抽屉 markdown 单源 + 流式打字尾行（mapper 缝；渲染缝的钉在
// e2e/chief-stream-markdown.spec.ts）。
// 失败方式先行枚举：
//   F-A1 chief 回复 `**bold**` 字面星号漏出（内联层不解析 strong，只剥离）
//   F-A2 strong 解析吃掉 code span：反引号内的 `**` 被当粗体标记
//   F-A3 粗体跨 code span 时断链（**使用 `cmd` 安装** 退化成字面星号）
//   F-A4 mention 方案被 strong 解析破坏（[name](agent:id) 不再出 chip）
//   F-A5 mapChiefStream 重写破坏既有投影（toolcall 折叠面 / error 行 / user 行）
//   F-A6 live robot 行仍走第二套手搓投影（paragraphs/bullets），不进 markdown 槽
//   F-B1 liveText 缓冲有字但 mapChief 不产 typing 尾行（增量照旧全丢）
//   F-B2 回合未在进行（activeRun null）也挂 typing 行——陈旧缓冲回显
//   F-B3 空串/纯空白缓冲挂出空气泡（闪烁面）
//   F-B4 typing 行携带 foot（复制钮/完成徽标）——打字面不是定稿面
//   F-B5 流式半途未闭合的 `**` 漏字面星号（闭合符还在路上）
//   F-B6 未闭合代码栅栏内被误补闭合符（fence 内 ** 是字面内容）
// #675 todo 提及位（chief 系统提示词让其发 [#n](todo:id)，SCHEME 正则此前不认）：
//   F-C1 [#n](todo:id) 不出 chip——字面 markdown 漏进 transcript / 抽屉 / 文档 pane
//   F-C2 todo mention 段不带实体 id——渲染层无法接 /app/todo/<id> 点击导航
//   F-C3 prose 里的裸 #N 被误判成提及（正则吃宽）
//   F-C4 相邻 scheme（todos:）或空 id（todo: 无 id）被误配成 chip
//   F-C5 四旧 scheme（agent/project/skill/machine）段投影被改坏（契约扩展回归钉）
// #742 用户气泡 markdown 槽（详情页用户行 #612 同款配方；渲染缝的钉在
// e2e/chief-stream-markdown.spec.ts F-R14..R17）：
//   F-D1 live 用户行不进 markdown 槽——用户自己发的 [#16](todo:id) 与粗体标记
//        在自泡里漏成字面文本（bug 本体；详情页 #612 / robot 行 #650 早已同槽）
//   F-D2 #667 去重键被槽带偏：同文 POST + 回声不再恰一条，或 rewind 锚 id 漂移
//   F-D3 wake 回声行（无孪生）被误删；槽内文本被摊平（多行原文不逐字）
//   F-D4 javascript: 伪链成锚（scheme 白名单退化；现状已挡 → 负例钉住防回归）
//   F-D5 渲染链出现 dangerouslySetInnerHTML（解析器产 React 节点的 XSS 律退化）

import type { AgentRecord, ChiefGetResponse, ChiefThread } from '@cairn/shared';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  inlineSegments,
  mapChief,
  mapChiefStream,
  type MessageRow,
} from '../src/api/mappers.js';
import type { ChiefStreamItem } from '../src/fixtures/records.js';

const NOW = 1_758_000_000_000;

let msgSeq = 0;
function msg(role: MessageRow['role'], content: unknown, at = NOW): MessageRow {
  msgSeq += 1;
  return { id: `msg-${msgSeq}`, role, content, createdAt: at };
}

const AGENT: AgentRecord = {
  id: 'agent-1',
  displayName: 'r5-scribe',
  description: null,
  status: 'active',
  avatarUrl: null,
  provider: 'r3-gw',
  modelId: 'claude-sonnet-5',
  thinkingLevel: null,
  tools: [],
  secrets: [],
  defaultSkill: null,
  skillsAllowlist: null,
  mcpServers: [],
};

const ENV: ChiefGetResponse = {
  chief: {
    id: 'chief-u1-t1',
    userId: 'u1',
    teamId: 't1',
    agent: { agentId: 'agent-1' },
    charter: null,
    lastTurnAt: null,
    createdAt: NOW,
    tz: null,
  },
  agentActor: AGENT,
  context: null,
  watches: [],
  wakes: [],
  // orchestration 块本测试面不消费，取空态（chief 未绑定 + 无计数）。
  orchestration: { homeMachineId: null, activity: [] },
};

function thread(activeRun: ChiefThread['activeRun']): ChiefThread {
  return {
    id: 'chief-aaa',
    chiefId: 'chief-u1-t1',
    userId: 'u1',
    teamId: 't1',
    title: '线程甲',
    createdAt: NOW,
    updatedAt: NOW,
    lastTurnAt: null,
    session: { runtime: 'pi', id: 's1', openedAt: NOW },
    pendingSessionResumeAt: null,
    toolDefHashes: {},
    toolResultHashes: {},
    activeRun,
  };
}

function robotItems(items: ChiefStreamItem[]) {
  return items.filter((i): i is Extract<ChiefStreamItem, { kind: 'robot' }> => i.kind === 'robot');
}

function userItems(items: ChiefStreamItem[]) {
  return items.filter((i): i is Extract<ChiefStreamItem, { kind: 'user' }> => i.kind === 'user');
}

/** 显式 id 行（chief-user-echo.test.ts 同形）：#667 去重与 #615 rewind 锚
 *  都吃 id 位，共享计数器工厂 msg() 的自增 id 钉不住。 */
function row(id: string, role: MessageRow['role'], content: unknown, at = NOW): MessageRow {
  return { id, role, content, createdAt: at };
}

describe('inlineSegments strong 位（#650 F-A1..A4）', () => {
  test('F-A1 **bold** 切成 strong 段，星号不再漏字面也不再只剥离', () => {
    const segs = inlineSegments('**项目**: [凭证链路验证]');
    expect(segs).toContainEqual({ text: '项目', style: 'strong' });
    expect(segs.map((s) => s.text).join('')).not.toContain('**');
    expect(segs.map((s) => s.text).join('')).toContain(': [凭证链路验证]');
  });

  test('F-A2 code span 内的 ** 保持字面（反引号优先）', () => {
    const segs = inlineSegments('运行 `grep **` 输出');
    const code = segs.find((s) => s.style === 'code');
    expect(code?.text).toBe('grep **');
    expect(segs.filter((s) => s.style === 'strong')).toHaveLength(0);
  });

  test('F-A3 粗体跨 code span 不断链', () => {
    const segs = inlineSegments('**使用 `npm i` 安装**');
    expect(segs).toEqual([
      { text: '使用 ', style: 'strong' },
      { text: 'npm i', style: 'code' },
      { text: ' 安装', style: 'strong' },
    ]);
  });

  test('F-A4 mention 方案照常出 chip（strong 内外都不破）', () => {
    // #675：mention 段契约扩展——携带 wire 实体 id（mentionId），四旧 scheme 同律。
    const plain = inlineSegments('派给 [scribe](agent:a1) 承接');
    expect(plain).toContainEqual({
      text: 'scribe',
      style: 'mention',
      mentionKind: 'agent',
      mentionId: 'a1',
    });
    const bolded = inlineSegments('**由 [scribe](agent:a1) 承接**');
    expect(bolded).toContainEqual({
      text: 'scribe',
      style: 'mention',
      mentionKind: 'agent',
      mentionId: 'a1',
    });
    expect(bolded.map((s) => s.text).join('')).not.toContain('**');
  });

  test('无标记文本行为不变（回归钉）', () => {
    expect(inlineSegments('纯文本')).toEqual([{ text: '纯文本' }]);
    expect(inlineSegments('带 `code` 的文本')).toEqual([
      { text: '带 ' },
      { text: 'code', style: 'code' },
      { text: ' 的文本' },
    ]);
  });

  test('落单 ** 保持字面（奇数个定界符不吞尾段）', () => {
    const segs = inlineSegments('a ** b');
    expect(segs.map((s) => s.text).join('')).toBe('a ** b');
    expect(segs.filter((s) => s.style === 'strong')).toHaveLength(0);
  });
});

describe('inlineSegments todo 提及位（#675 F-C1..C5）', () => {
  test('F-C1/C2 [#n](todo:id) 切出 mention 段——label 逐字 + 实体 id 随行', () => {
    const segs = inlineSegments('已创建并派工 [#24](todo:t24)，进入复核');
    expect(segs).toContainEqual({
      text: '#24',
      style: 'mention',
      mentionKind: 'todo',
      mentionId: 't24',
    });
    expect(segs.map((s) => s.text).join('')).not.toContain('](');
  });

  test('F-C1 strong 内的 todo 提及照常出 chip（F-A4 同律）', () => {
    const bolded = inlineSegments('**由 [#1](todo:r3-legacy-1) 承接**');
    expect(bolded).toContainEqual({
      text: '#1',
      style: 'mention',
      mentionKind: 'todo',
      mentionId: 'r3-legacy-1',
    });
    expect(bolded.map((s) => s.text).join('')).not.toContain('**');
  });

  test('F-C3 prose 裸 #N 不是提及（正则不吃宽）', () => {
    expect(inlineSegments('任务 #12 停在 review，另见 PR #487')).toEqual([
      { text: '任务 #12 停在 review，另见 PR #487' },
    ]);
  });

  test('F-C4 相邻 scheme 与空 id 保持字面（todos: / todo: 无 id 不配）', () => {
    const near = inlineSegments('[伪链](todos:t1) 保持字面');
    expect(near.filter((s) => s.style === 'mention')).toHaveLength(0);
    expect(near.map((s) => s.text).join('')).toContain('[伪链](todos:t1)');
    const empty = inlineSegments('[x](todo:) 保持字面');
    expect(empty.filter((s) => s.style === 'mention')).toHaveLength(0);
    expect(empty.map((s) => s.text).join('')).toContain('[x](todo:)');
  });

  test('F-C5 四旧 scheme 照常出段并携带 wire id（契约扩展回归钉）', () => {
    const segs = inlineSegments(
      '[scribe](agent:a1) [proj](project:p1) [sk](skill:s1) [box](machine:m1)',
    );
    expect(segs).toContainEqual({
      text: 'scribe',
      style: 'mention',
      mentionKind: 'agent',
      mentionId: 'a1',
    });
    expect(segs).toContainEqual({
      text: 'proj',
      style: 'mention',
      mentionKind: 'project',
      mentionId: 'p1',
    });
    expect(segs).toContainEqual({ text: 'sk', style: 'mention', mentionKind: 'skill', mentionId: 's1' });
    expect(segs).toContainEqual({
      text: 'box',
      style: 'mention',
      mentionKind: 'machine',
      mentionId: 'm1',
    });
  });
});

describe('mapChiefStream markdown 槽（#650 F-A5/A6）', () => {
  test('F-A6 assistant 行进 markdown 槽（原文逐字），不再手搓 paragraphs/bullets', () => {
    const text = '## 报告\n\n- **项目**: 凭证链路验证\n- 次要点';
    const items = mapChiefStream([msg('assistant', text)]);
    const robots = robotItems(items);
    expect(robots).toHaveLength(1);
    expect(robots[0]?.markdown).toBe(text);
    expect(robots[0]?.paragraphs).toBeUndefined();
    expect(robots[0]?.seconds).toBe('');
  });

  test('F-A5 toolcall 行仍缓冲进下一 robot 行的折叠面', () => {
    const items = mapChiefStream([
      msg('assistant', {
        kind: 'toolcall',
        call: { id: 'c1', name: 'create_todo', arguments: {}, startedAt: NOW, endedAt: NOW + 2000 },
      }),
      msg('assistant', '已创建并派工'),
    ]);
    const robots = robotItems(items);
    expect(robots).toHaveLength(1);
    expect(robots[0]?.tools).toEqual([{ label: 'create_todo', seconds: 2 }]);
  });

  test('F-A5 user 行 / chief_turn_error 行投影不变（回归钉）', () => {
    const items = mapChiefStream([
      msg('user', '帮我写 CONTRIBUTING.md'),
      msg('system', JSON.stringify({ kind: 'chief_turn_error', message: '400 协议不支持' })),
    ]);
    expect(items[0]).toMatchObject({ kind: 'user', text: '帮我写 CONTRIBUTING.md' });
    expect(items[1]).toMatchObject({ kind: 'error', text: '400 协议不支持' });
  });
});

describe('mapChief typing 尾行（#651 F-B1..B4）', () => {
  const opts = (activeRun: ChiefThread['activeRun'], liveText?: string) => ({
    threads: [thread(activeRun)],
    activeThreadId: 'chief-aaa',
    messages: [msg('user', '派一下')],
    ...(liveText !== undefined ? { liveText } : {}),
  });

  test('F-B1 回合进行中 + 缓冲非空 → stream 尾挂 typing robot 行', () => {
    const content = mapChief(ENV, opts({ phase: 'chief' }, '正在读取 **仓库结构**'));
    const stream = content.stream ?? [];
    const last = stream[stream.length - 1];
    expect(last).toMatchObject({
      kind: 'robot',
      markdown: '正在读取 **仓库结构**',
      typing: true,
    });
  });

  test('F-B2 activeRun null（回合已收）→ 陈旧缓冲不渲染', () => {
    const content = mapChief(ENV, opts(null, '上一轮的残留文本'));
    expect(robotItems(content.stream ?? []).some((r) => r.typing === true)).toBe(false);
  });

  test('F-B3 空串/纯空白缓冲 → 不挂空气泡', () => {
    expect(
      robotItems(mapChief(ENV, opts({ phase: 'chief' }, '')).stream ?? []).some((r) => r.typing),
    ).toBe(false);
    expect(
      robotItems(mapChief(ENV, opts({ phase: 'chief' }, '   \n ')).stream ?? []).some(
        (r) => r.typing,
      ),
    ).toBe(false);
  });

  test('F-B5 未闭合 ** 的流式半途自动补虚拟闭合符（增量面不漏字面星号）', () => {
    const content = mapChief(ENV, opts({ phase: 'chief' }, '正在验证 **凭证'));
    const stream = content.stream ?? [];
    expect(stream[stream.length - 1]).toMatchObject({
      kind: 'robot',
      typing: true,
      markdown: '正在验证 **凭证**',
    });
  });

  test('F-B6 未闭合代码栅栏内不补（fence 内 ** 是字面内容）', () => {
    const content = mapChief(ENV, opts({ phase: 'chief' }, '```sh\necho **'));
    const stream = content.stream ?? [];
    expect(stream[stream.length - 1]).toMatchObject({ markdown: '```sh\necho **' });
  });

  test('F-B4 typing 行不带 foot 数据（seconds 空串、无 tools）', () => {
    const content = mapChief(ENV, opts({ phase: 'chief' }, '打字中'));
    const typing = robotItems(content.stream ?? []).find((r) => r.typing === true);
    expect(typing?.seconds).toBe('');
    expect(typing?.tools).toBeUndefined();
  });

  test('liveText 缺省但回合在飞 → 存在尾行取代打字行（#739）', () => {
    const content = mapChief(ENV, opts({ phase: 'chief' }));
    // 无增量文本 → 不挂 typing robot 行
    expect(robotItems(content.stream ?? [])).toHaveLength(0);
    expect(content.running).toBe(true);
    // #739：改挂在飞存在行（streaming 尾行），静默窗口消失
    const stream = content.stream ?? [];
    expect(stream[stream.length - 1]).toMatchObject({ kind: 'streaming', label: '处理中...' });
  });
});

describe('mapChief 在飞存在尾行（#739 F1/F2/F4/F6）', () => {
  const opts = (
    activeRun: ChiefThread['activeRun'],
    liveText?: string,
    activeThreadId: string | null = 'chief-aaa',
  ) => ({
    threads: [thread(activeRun)],
    activeThreadId,
    messages: [msg('user', '派一下')],
    ...(liveText !== undefined ? { liveText } : {}),
  });

  function streamingItems(items: ChiefStreamItem[]) {
    return items.filter(
      (i): i is Extract<ChiefStreamItem, { kind: 'streaming' }> => i.kind === 'streaming',
    );
  }

  test('存在行：running + 缓冲空 → 尾挂 streaming 存在行（label 处理中...）', () => {
    const stream = mapChief(ENV, opts({ phase: 'chief' }, '')).stream ?? [];
    expect(stream[stream.length - 1]).toMatchObject({ kind: 'streaming', label: '处理中...' });
  });

  test('F4 存在行不挂秒数（#471 静止期无流事件驱动重渲，秒数会冻结说谎）', () => {
    const stream = mapChief(ENV, opts({ phase: 'chief' })).stream ?? [];
    const last = stream[stream.length - 1];
    expect(last).toMatchObject({ kind: 'streaming' });
    expect((last as { seconds?: number }).seconds).toBeUndefined();
  });

  test('F1 缓冲非空 → 仅 typing 行，存在行退场（两行互斥）', () => {
    const stream = mapChief(ENV, opts({ phase: 'chief' }, '正在读取仓库')).stream ?? [];
    expect(streamingItems(stream)).toHaveLength(0);
    expect(stream[stream.length - 1]).toMatchObject({ kind: 'robot', typing: true });
  });

  test('F1 缓冲空↔非空翻转，live 尾行恒至多一行（无二重身）', () => {
    for (const liveText of ['', '   ', 'x']) {
      const stream = mapChief(ENV, opts({ phase: 'chief' }, liveText)).stream ?? [];
      const liveTails = [
        ...streamingItems(stream),
        ...robotItems(stream).filter((r) => r.typing),
      ];
      expect(liveTails).toHaveLength(1);
    }
  });

  test('F2 activeRun null（回合已收）→ 缓冲空也不挂存在行（僵尸行不常驻）', () => {
    const stream = mapChief(ENV, opts(null)).stream ?? [];
    expect(streamingItems(stream)).toHaveLength(0);
  });

  test('收敛律：终稿 assistant 已落库（尾为 robot 行）+ activeRun 未收 → 存在行不再闪', () => {
    // message → step 的窗口：终稿行已重取进 messages，但 activeRun 要等 step
    // 事件（#684 失效 chiefThreads）才收口。gate = 尾非 robot → 存在行当场退场，
    // 不赌 step 时机（否则 running 仍 true + liveText 空会在终稿后再闪存在行）。
    const stream =
      mapChief(ENV, {
        threads: [thread({ phase: 'chief' })],
        activeThreadId: 'chief-aaa',
        messages: [msg('user', '派一下'), msg('assistant', '验证完成，全部通过')],
      }).stream ?? [];
    expect(streamingItems(stream)).toHaveLength(0);
    expect(stream[stream.length - 1]).toMatchObject({ kind: 'robot' });
  });

  test('F6 新主题视图（activeThreadId null）→ 无 stream，存在行不残留', () => {
    const content = mapChief(ENV, opts({ phase: 'chief' }, '', null));
    expect(content.stream).toBeUndefined();
    expect(content.examples).toBeDefined();
  });
});

describe('mapChiefStream 用户行 markdown 槽（#742 F-D1..D5）', () => {
  test('F-D1 user 行进 markdown 槽——原文逐字 + rewind 锚 id 透传', () => {
    const text = '派 [#16](todo:t16) 去处理，**优先** 检查';
    const items = mapChiefStream([row('u-post-1', 'user', text)]);
    const users = userItems(items);
    expect(users).toHaveLength(1);
    // 槽 = 原文逐字（trim 后），块结构解析归渲染期（#612/#650 同律）
    expect(users[0]?.markdown).toBe(text);
    // text 位不变（复制载荷 / 去重键 / 呈现兜底三面吃它）
    expect(users[0]?.text).toBe(text);
    // #615 rewind 锚照常透传（渲染换法不得动 id 位）
    expect(users[0]?.id).toBe('u-post-1');
  });

  test('F-D2 #667 去重键不吃槽——同文 POST + 回声恰一条，正本就位带槽带锚', () => {
    const text = '派 [#16](todo:t16) 去处理';
    const items = mapChiefStream([
      row('AbCdEfGhIjKlMnOpQrStU', 'user', text, NOW),
      row('user-LFnKO1KhDH4F1HylsEAfY', 'user', text, NOW + 100),
      row('msg-r1', 'assistant', '已派工', NOW + 9000),
    ]);
    const users = userItems(items);
    expect(users).toHaveLength(1);
    expect(users[0]?.id).toBe('AbCdEfGhIjKlMnOpQrStU');
    expect(users[0]?.markdown).toBe(text);
  });

  test('F-D3 wake 回声行（无孪生）保留、剥 marker 且带槽；多行原文在槽内不摊平', () => {
    const wake = '[wake:settle] 任务 #5「修复」已合并完成';
    const steer = '按这个改：\n\n- 圆角 8px\n- 悬停加过渡';
    const items = mapChiefStream([
      row('user-stepW', 'user', wake, NOW),
      row('u-post-2', 'user', steer, NOW + 5000),
    ]);
    const users = userItems(items);
    expect(users).toHaveLength(2);
    expect(users[0]?.markdown).toBe('任务 #5「修复」已合并完成');
    expect(users[0]?.text).toBe('任务 #5「修复」已合并完成');
    // 换行逐字保留——围栏/列表的块结构归渲染期解析，mapper 不摊平
    expect(users[1]?.markdown).toBe(steer);
  });

  test('F-D4 javascript: 伪链不成 mention 段（scheme 白名单，防退化负例）', () => {
    const segs = inlineSegments('别点 [click](javascript:alert(1)) 这个');
    expect(segs.filter((s) => s.style === 'mention')).toHaveLength(0);
    expect(segs.map((s) => s.text).join('')).toContain('[click](javascript:alert(1))');
  });

  test('F-D5 渲染链零 dangerouslySetInnerHTML（解析器产 React 节点，静态钉）', () => {
    const web = resolve(import.meta.dirname, '..');
    const chain = [
      'src/chief/chief-drawer.tsx',
      'src/detail/chat-markdown.tsx',
      'src/detail/segments.tsx',
      'src/api/mappers.ts',
    ];
    for (const rel of chain) {
      expect(readFileSync(resolve(web, rel), 'utf8'), rel).not.toContain(
        'dangerouslySetInnerHTML',
      );
    }
  });
});
