import { Buffer } from 'node:buffer';
import { describe, expect, test } from 'vitest';
import { todo } from '../src/db/schema.js';
import { executeChiefTool } from '../src/services/chief-tools.js';
import { ctx, H, registerChiefHarness, toolDeps } from './chief-harness.js';

registerChiefHarness();

describe('chief todos output budget', () => {
  test('large todo lists stay within 32 KiB and can be paged without losing ids', async () => {
    const ids = Array.from({ length: 200 }, (_, i) => `budget-todo-${i}`);
    H.s.db
      .insert(todo)
      .values(
        ids.map((id, i) => ({
          id,
          teamId: H.teamId,
          projectId: H.projectId,
          seqNum: i + 1,
          title: '标题😀"\\'.repeat(100),
          spec: '需求😀"\\\n'.repeat(10000),
          phaseAt: 1,
        })),
      )
      .run();
    const seen = new Set<string>();
    let offset: number | null = 0;
    do {
      const text = await executeChiefTool(toolDeps(), ctx(), 'todos', { offset });
      expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(32768);
      const page = JSON.parse(text) as {
        todos: { id: string; title: string; phase: string; summary: string; spec?: string }[];
        nextOffset: number | null;
        total: number;
      };
      expect(page.total).toBe(200);
      expect(page.todos.length).toBeGreaterThan(0);
      for (const item of page.todos) {
        expect(item.spec).toBeUndefined();
        expect(item.summary.length).toBeLessThanOrEqual(240);
        expect(seen.has(item.id)).toBe(false);
        seen.add(item.id);
      }
      offset = page.nextOffset;
    } while (offset !== null);
    expect(seen.size).toBe(200);
    const detail = JSON.parse(
      await executeChiefTool(toolDeps(), ctx(), 'todos', { todoId: ids[0] }),
    );
    expect(detail.spec).toBe('需求😀"\\\n'.repeat(10000));
  }, 30_000);
});
