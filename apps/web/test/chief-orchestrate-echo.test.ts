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

describe('chief stream hides the orchestration body and the skill-route hint', () => {
  test('start-task POST row + echo row carrying the route hint render one bubble with only the head line', () => {
    const items = mapChiefStream([
      row('kAHTl5tvbNmMWu82kmvCH', 'user', ORCHESTRATE, NOW),
      row('user-kAHTl5tvbNmMWu82kmvCH', 'user', `${ORCHESTRATE}\n\n${ROUTE}`, NOW + 100),
      row('msg-a1', 'assistant', '已派发 #103', NOW + 9000),
    ]);
    const users = userItems(items);
    expect(users).toHaveLength(1);
    expect(users[0]?.text).toBe('开始任务 #103');
    expect(users[0]?.markdown ?? '').not.toContain('编排请求');
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
