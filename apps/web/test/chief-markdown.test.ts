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

function row(id: string, role: MessageRow['role'], content: unknown, at = NOW): MessageRow {
  return { id, role, content, createdAt: at };
}

describe('inlineSegments strong slot (#650 F-A1..A4)', () => {
  test('F-A1 **bold** splits into strong segments, stars no longer leak literally nor get stripped only', () => {
    const segs = inlineSegments('**项目**: [凭证链路验证]');
    expect(segs).toContainEqual({ text: '项目', style: 'strong' });
    expect(segs.map((s) => s.text).join('')).not.toContain('**');
    expect(segs.map((s) => s.text).join('')).toContain(': [凭证链路验证]');
  });

  test('F-A2 ** inside a code span stays literal (backticks win)', () => {
    const segs = inlineSegments('运行 `grep **` 输出');
    const code = segs.find((s) => s.style === 'code');
    expect(code?.text).toBe('grep **');
    expect(segs.filter((s) => s.style === 'strong')).toHaveLength(0);
  });

  test('F-A3 bold chains across code spans unbroken', () => {
    const segs = inlineSegments('**使用 `npm i` 安装**');
    expect(segs).toEqual([
      { text: '使用 ', style: 'strong' },
      { text: 'npm i', style: 'code' },
      { text: ' 安装', style: 'strong' },
    ]);
  });

  test('F-A4 mention recipe still yields chips (unbroken inside or outside strong)', () => {

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

  test('markup-free text rows unchanged (regression pin)', () => {
    expect(inlineSegments('纯文本')).toEqual([{ text: '纯文本' }]);
    expect(inlineSegments('带 `code` 的文本')).toEqual([
      { text: '带 ' },
      { text: 'code', style: 'code' },
      { text: ' 的文本' },
    ]);
  });

  test('a lone ** stays literal (odd delimiter count does not swallow the tail segment)', () => {
    const segs = inlineSegments('a ** b');
    expect(segs.map((s) => s.text).join('')).toBe('a ** b');
    expect(segs.filter((s) => s.style === 'strong')).toHaveLength(0);
  });
});

describe('inlineSegments todo-mention slot (#675 F-C1..C5)', () => {
  test('F-C1/C2 [#n](todo:id) splits out a mention segment — label verbatim + entity id riding along', () => {
    const segs = inlineSegments('已创建并派工 [#24](todo:t24)，进入复核');
    expect(segs).toContainEqual({
      text: '#24',
      style: 'mention',
      mentionKind: 'todo',
      mentionId: 't24',
    });
    expect(segs.map((s) => s.text).join('')).not.toContain('](');
  });

  test('F-C1 todo mentions inside strong still yield chips (same law as F-A4)', () => {
    const bolded = inlineSegments('**由 [#1](todo:r3-legacy-1) 承接**');
    expect(bolded).toContainEqual({
      text: '#1',
      style: 'mention',
      mentionKind: 'todo',
      mentionId: 'r3-legacy-1',
    });
    expect(bolded.map((s) => s.text).join('')).not.toContain('**');
  });

  test('F-C3 bare #N in prose is not a mention (the regex does not over-match)', () => {
    expect(inlineSegments('任务 #12 停在 review，另见 PR #487')).toEqual([
      { text: '任务 #12 停在 review，另见 PR #487' },
    ]);
  });

  test('F-C4 adjacent schemes and empty ids stay literal (todos: / todo: without id do not match)', () => {
    const near = inlineSegments('[伪链](todos:t1) 保持字面');
    expect(near.filter((s) => s.style === 'mention')).toHaveLength(0);
    expect(near.map((s) => s.text).join('')).toContain('[伪链](todos:t1)');
    const empty = inlineSegments('[x](todo:) 保持字面');
    expect(empty.filter((s) => s.style === 'mention')).toHaveLength(0);
    expect(empty.map((s) => s.text).join('')).toContain('[x](todo:)');
  });

  test('F-C5 the four legacy schemes still yield segments carrying the wire id (contract-extension regression pin)', () => {
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

describe('mapChiefStream markdown slot (#650 F-A5/A6)', () => {
  test('F-A6 assistant rows enter the markdown slot (source verbatim), no more hand-rolled paragraphs/bullets', () => {
    const text = '## 报告\n\n- **项目**: 凭证链路验证\n- 次要点';
    const items = mapChiefStream([msg('assistant', text)]);
    const robots = robotItems(items);
    expect(robots).toHaveLength(1);
    expect(robots[0]?.markdown).toBe(text);
    expect(robots[0]?.paragraphs).toBeUndefined();
    expect(robots[0]?.seconds).toBe('');
  });

  test('F-A5 toolcall rows still buffer into the next robot row collapsed face', () => {
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

  test('F-A5 user rows / chief_turn_error rows project unchanged (regression pin)', () => {
    const items = mapChiefStream([
      msg('user', '帮我写 CONTRIBUTING.md'),
      msg('system', JSON.stringify({ kind: 'chief_turn_error', message: '400 协议不支持' })),
    ]);
    expect(items[0]).toMatchObject({ kind: 'user', text: '帮我写 CONTRIBUTING.md' });
    expect(items[1]).toMatchObject({ kind: 'error', text: '400 协议不支持' });
  });
});

describe('mapChief typing tail row (#651 F-B1..B4)', () => {
  const opts = (activeRun: ChiefThread['activeRun'], liveText?: string) => ({
    threads: [thread(activeRun)],
    activeThreadId: 'chief-aaa',
    messages: [msg('user', '派一下')],
    ...(liveText !== undefined ? { liveText } : {}),
  });

  test('F-B1 turn in flight + non-empty buffer → typing robot row hangs at the stream tail', () => {
    const content = mapChief(ENV, opts({ phase: 'chief' }, '正在读取 **仓库结构**'));
    const stream = content.stream ?? [];
    const last = stream[stream.length - 1];
    expect(last).toMatchObject({
      kind: 'robot',
      markdown: '正在读取 **仓库结构**',
      typing: true,
    });
  });

  test('F-B2 activeRun null (turn settled) → stale buffer does not render', () => {
    const content = mapChief(ENV, opts(null, '上一轮的残留文本'));
    expect(robotItems(content.stream ?? []).some((r) => r.typing === true)).toBe(false);
  });

  test('F-B3 empty/whitespace-only buffer → no air bubble hung', () => {
    expect(
      robotItems(mapChief(ENV, opts({ phase: 'chief' }, '')).stream ?? []).some((r) => r.typing),
    ).toBe(false);
    expect(
      robotItems(mapChief(ENV, opts({ phase: 'chief' }, '   \n ')).stream ?? []).some(
        (r) => r.typing,
      ),
    ).toBe(false);
  });

  test('F-B5 unclosed ** mid-stream auto-closes with a virtual closer (incremental face leaks no literal stars)', () => {
    const content = mapChief(ENV, opts({ phase: 'chief' }, '正在验证 **凭证'));
    const stream = content.stream ?? [];
    expect(stream[stream.length - 1]).toMatchObject({
      kind: 'robot',
      typing: true,
      markdown: '正在验证 **凭证**',
    });
  });

  test('F-B6 no closing inside an unclosed code fence (** inside a fence is literal content)', () => {
    const content = mapChief(ENV, opts({ phase: 'chief' }, '```sh\necho **'));
    const stream = content.stream ?? [];
    expect(stream[stream.length - 1]).toMatchObject({ markdown: '```sh\necho **' });
  });

  test('F-B4 typing rows carry no foot data (seconds empty string, no tools)', () => {
    const content = mapChief(ENV, opts({ phase: 'chief' }, '打字中'));
    const typing = robotItems(content.stream ?? []).find((r) => r.typing === true);
    expect(typing?.seconds).toBe('');
    expect(typing?.tools).toBeUndefined();
  });

  test('liveText absent but the turn in flight → presence tail row replaces the typing row (#739)', () => {
    const content = mapChief(ENV, opts({ phase: 'chief' }));

    expect(robotItems(content.stream ?? [])).toHaveLength(0);
    expect(content.running).toBe(true);

    const stream = content.stream ?? [];
    expect(stream[stream.length - 1]).toMatchObject({ kind: 'streaming', label: '处理中...' });
  });
});

describe('mapChief in-flight presence tail row (#739 F1/F2/F4/F6)', () => {
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

  test('presence row: running + empty buffer → streaming presence row hung at the tail (label `处理中...`)', () => {
    const stream = mapChief(ENV, opts({ phase: 'chief' }, '')).stream ?? [];
    expect(stream[stream.length - 1]).toMatchObject({ kind: 'streaming', label: '处理中...' });
  });

  test('F4 presence row carries no seconds (#471: no stream events drive re-render in the still window, seconds would freeze and lie)', () => {
    const stream = mapChief(ENV, opts({ phase: 'chief' })).stream ?? [];
    const last = stream[stream.length - 1];
    expect(last).toMatchObject({ kind: 'streaming' });
    expect((last as { seconds?: number }).seconds).toBeUndefined();
  });

  test('F1 non-empty buffer → typing row only, presence row retires (the two are mutually exclusive)', () => {
    const stream = mapChief(ENV, opts({ phase: 'chief' }, '正在读取仓库')).stream ?? [];
    expect(streamingItems(stream)).toHaveLength(0);
    expect(stream[stream.length - 1]).toMatchObject({ kind: 'robot', typing: true });
  });

  test('F1 buffer empty↔non-empty flips, the live tail row is at most one row at any time (no doppelganger)', () => {
    for (const liveText of ['', '   ', 'x']) {
      const stream = mapChief(ENV, opts({ phase: 'chief' }, liveText)).stream ?? [];
      const liveTails = [
        ...streamingItems(stream),
        ...robotItems(stream).filter((r) => r.typing),
      ];
      expect(liveTails).toHaveLength(1);
    }
  });

  test('F2 activeRun null (turn settled) → no presence row even with empty buffer (zombie rows do not linger)', () => {
    const stream = mapChief(ENV, opts(null)).stream ?? [];
    expect(streamingItems(stream)).toHaveLength(0);
  });

  test('settle law: final assistant row already stored (tail is a robot row) + activeRun unsettled → presence row no longer flashes', () => {

    const stream =
      mapChief(ENV, {
        threads: [thread({ phase: 'chief' })],
        activeThreadId: 'chief-aaa',
        messages: [msg('user', '派一下'), msg('assistant', '验证完成，全部通过')],
      }).stream ?? [];
    expect(streamingItems(stream)).toHaveLength(0);
    expect(stream[stream.length - 1]).toMatchObject({ kind: 'robot' });
  });

  test('F6 new-topic view (activeThreadId null) → no stream, presence row leaves no residue', () => {
    const content = mapChief(ENV, opts({ phase: 'chief' }, '', null));
    expect(content.stream).toBeUndefined();
    expect(content.examples).toBeDefined();
  });
});

describe('mapChiefStream user-row markdown slot (#742 F-D1..D5)', () => {
  test('F-D1 user rows enter the markdown slot — source verbatim + rewind anchor id passed through', () => {
    const text = '派 [#16](todo:t16) 去处理，**优先** 检查';
    const items = mapChiefStream([row('u-post-1', 'user', text)]);
    const users = userItems(items);
    expect(users).toHaveLength(1);

    expect(users[0]?.markdown).toBe(text);

    expect(users[0]?.text).toBe(text);

    expect(users[0]?.id).toBe('u-post-1');
  });

  test('F-D2 the #667 dedup key ignores the slot — same-text POST + echo render exactly one, the canon lands with slot and anchor', () => {
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

  test('F-D3 wake echo rows (no twin) survive, marker stripped and slotted; multi-row source is not flattened inside the slot', () => {
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

    expect(users[1]?.markdown).toBe(steer);
  });

  test('F-D4 javascript: pseudo-links do not become mention segments (scheme whitelist, degradation negative case)', () => {
    const segs = inlineSegments('别点 [click](javascript:alert(1)) 这个');
    expect(segs.filter((s) => s.style === 'mention')).toHaveLength(0);
    expect(segs.map((s) => s.text).join('')).toContain('[click](javascript:alert(1))');
  });

  test('F-D5 the render chain has zero dangerouslySetInnerHTML (the parser produces React nodes, static pin)', () => {
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
