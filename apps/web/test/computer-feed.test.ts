import type { ComputerCommand } from '@cairn/shared';
import { beforeEach, describe, expect, test } from 'vitest';
import { computerFeedStore, mergeComputerFeed } from '../src/api/computer-feed.js';

const id = (n: number) => n.toString(16).padStart(64, '0');
const cmd = (n: number, patch: Partial<ComputerCommand> = {}): ComputerCommand => ({
  callId: id(n),
  stepId: 'step-1',
  tool: 'shell',
  command: `echo ${n}`,
  cwd: '.',
  status: 'done',
  exitCode: 0,
  output: '',
  at: n * 10,
  ...patch,
});

beforeEach(() => computerFeedStore.clear());

describe('mergeComputerFeed', () => {
  test('a live event for a call already in history does not duplicate it', () => {
    const merged = mergeComputerFeed([cmd(1), cmd(2)], [cmd(2)]);
    expect(merged.map((c) => c.callId)).toEqual([id(1), id(2)]);
  });

  test('a settled event replaces the running one and keeps its place', () => {
    const merged = mergeComputerFeed(
      [cmd(1), cmd(2, { status: 'running', exitCode: null, at: 15 })],
      [cmd(3), cmd(2, { at: 90 })],
    );
    expect(merged.map((c) => c.callId)).toEqual([id(1), id(2), id(3)]);
    expect(merged[1]?.status).toBe('done');
  });

  test('a stale running event never overwrites a settled call', () => {
    const merged = mergeComputerFeed([cmd(1)], [cmd(1, { status: 'running', exitCode: null })]);
    expect(merged[0]?.status).toBe('done');
  });

  test('calls with equal times order by call id', () => {
    const merged = mergeComputerFeed([], [cmd(2, { at: 5 }), cmd(1, { at: 5 })]);
    expect(merged.map((c) => c.callId)).toEqual([id(1), id(2)]);
  });
});

describe('computerFeedStore', () => {
  test('rejects payloads that are not feed commands', () => {
    expect(computerFeedStore.push({ callId: 'x' })).toBe(false);
    expect(computerFeedStore.snapshot()).toHaveLength(0);
  });

  test('reports a call id as new once', () => {
    expect(computerFeedStore.push(cmd(1, { status: 'running', exitCode: null }))).toBe(true);
    expect(computerFeedStore.push(cmd(1))).toBe(false);
    expect(computerFeedStore.snapshot()).toHaveLength(1);
  });
});
