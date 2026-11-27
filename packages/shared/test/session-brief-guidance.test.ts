import { describe, expect, test } from 'vitest';
import { SESSION_BRIEF, SESSION_REWORK_BRIEF, WORKER_ASK_USER_TOOL } from '../src/index.js';

describe('task execution guidance prompts (Slice 1)', () => {
  test('SESSION_BRIEF removes the blanket no-approval rule and clarifies clear multi-file vs uncertain big tasks', () => {
    expect(SESSION_BRIEF).not.toContain('Do not wait for approval');
    expect(SESSION_BRIEF).toMatch(/even across multiple files/i);
    expect(SESSION_BRIEF).toMatch(/unclear scope|trade-offs/i);
    expect(SESSION_BRIEF).toContain('ask_user');
    expect(SESSION_BRIEF).toMatch(/recommended/i);
    expect(SESSION_BRIEF).toMatch(/draft PR.*ask_user/i);
  });

  test('SESSION_BRIEF requires listing 3-5 edge cases before the first edit', () => {
    expect(SESSION_BRIEF).toMatch(/3.?5/);
    expect(SESSION_BRIEF).toMatch(/edge cases/i);
    expect(SESSION_BRIEF).toMatch(/before your first edit/i);
  });

  test('SESSION_BRIEF and SESSION_REWORK_BRIEF define mandatory real acceptance per task kind', () => {
    expect(SESSION_BRIEF).toContain('attach_file');
    expect(SESSION_BRIEF).toMatch(/screenshot/i);
    expect(SESSION_BRIEF).toMatch(/API|request/i);
    expect(SESSION_BRIEF).toMatch(/CLI|command/i);
    expect(SESSION_BRIEF).toMatch(/doc|data|artifact/i);
    expect(SESSION_BRIEF).toMatch(/ask_user/);
    expect(SESSION_REWORK_BRIEF).toMatch(/real acceptance|running/i);
  });

  test('WORKER_ASK_USER_TOOL only blocks on genuine user decisions, draft PR confirmation, or blocked acceptance', () => {
    expect(WORKER_ASK_USER_TOOL.description).toMatch(/genuine user decisions/i);
    expect(WORKER_ASK_USER_TOOL.description).toMatch(/clear.*even across multiple files.*proceed/i);
    expect(WORKER_ASK_USER_TOOL.description).toMatch(/recommended/i);
    expect(WORKER_ASK_USER_TOOL.description).toMatch(/draft PR.*PR link/i);
    expect(WORKER_ASK_USER_TOOL.description).toMatch(/blocked|acceptance|push/i);
  });
});
