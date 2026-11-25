import { buildOrchestratePrompt, formatSkillRouteSection } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { mapChiefStream, type MessageRow } from '../src/api/mappers.js';
import type { ChiefStreamItem } from '../src/fixtures/records.js';

const NOW = 1_758_000_000_000;

function row(id: string, role: MessageRow['role'], content: unknown, at = NOW): MessageRow {
  return { id, role, content, createdAt: at };
}

function userItems(items: ChiefStreamItem[]) {
  return items.filter((i): i is Extract<ChiefStreamItem, { kind: 'user' }> => i.kind === 'user');
}

const ORCHESTRATE = buildOrchestratePrompt({
  id: 'TzfP82pe3-aO2tKlqoJJB',
  seqNum: 103,
  spec: '## Problem\n\nThe prepush self-test list exists twice: `selfTests` and the CI step.',
  sourceKind: 'github-issue',
  sourceRef: 'xiechimon/cairn#2159',
});

const ROUTE = formatSkillRouteSection({
  ruleId: 'explicit-mention',
  skills: [{ id: 'pr', name: 'pr', description: 'Use when writing a PR body.' }],
  toolHint: null,
});

describe('chief stream hides all orchestration and system prompts from user bubbles', () => {
  test('start-task POST row + echo row carrying the route hint render zero user bubbles', () => {
    const items = mapChiefStream([
      row('kAHTl5tvbNmMWu82kmvCH', 'user', ORCHESTRATE, NOW),
      row('user-kAHTl5tvbNmMWu82kmvCH', 'user', `${ORCHESTRATE}\n\n${ROUTE}`, NOW + 100),
      row('msg-a1', 'assistant', '已派发', NOW + 9000),
    ]);
    expect(userItems(items)).toHaveLength(0);
    expect(items.some((i) => i.kind === 'robot')).toBe(true);
  });

  test('legacy user-origin orchestration prompt with correction/project prefix also renders zero user bubbles', () => {
    const legacy = `开始任务 #103\n\n编排请求：[#103](todo:TzfP82pe3-aO2tKlqoJJB) —— Fix prepush\n\n来源：issue`;
    const items = mapChiefStream([
      row('legacy-1', 'user', legacy, NOW),
      row('legacy-2', 'user', `【输入框选定项目：Demo（id: p1）】\n${legacy}`, NOW + 10),
      row('legacy-3', 'user', `Correction: fix CI failure.\n\n${legacy}\n\n${ROUTE}`, NOW + 20),
    ]);
    expect(userItems(items)).toHaveLength(0);
  });

  test('an ordinary message whose echo carries the route hint renders once, without the hint', () => {
    const items = mapChiefStream([
      row('AbCdEfGhIjKlMnOpQrStU', 'user', '用 pr 技能写正文', NOW),
      row('user-LFnKO1KhDH4F1HylsEAfY', 'user', `用 pr 技能写正文\n\n${ROUTE}`, NOW + 100),
    ]);
    const users = userItems(items);
    expect(users).toHaveLength(1);
    expect(users[0]?.text).toBe('用 pr 技能写正文');
  });
});
