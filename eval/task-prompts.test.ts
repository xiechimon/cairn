import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { coordinatorToolDefs } from '../apps/server/src/services/coordinator-tool-defs.js';

const TASKS = resolve(import.meta.dirname, 'tasks');
const OFFERINGS = [
  coordinatorToolDefs(),
  coordinatorToolDefs({
    routerTools: true,
    desktopTools: true,
    ownComputer: true,
    ownComputerWorkspace: true,
    ownerChrome: true,
    browser: true,
    takeover: true,
    phoneComputer: ['owner-phone'],
    includeSubagent: true,
  }),
];
const TOOL_NAMES = [...new Set(OFFERINGS.flatMap((defs) => defs.map((def) => def.name)))];

function mentionedTools(prompt: string): string[] {
  const hits: string[] = [];
  for (const name of TOOL_NAMES) {
    const boundary = `(^|[^A-Za-z0-9_])${name}([^A-Za-z0-9_]|$)`;
    const called = `(^|[^A-Za-z0-9_])${name}\\(`;
    if (name.includes('_') && new RegExp(boundary).test(prompt)) hits.push(name);
    else if (new RegExp(called).test(prompt) || prompt.includes(`\`${name}\``)) hits.push(name);
  }
  return hits;
}

interface Prompt {
  id: string;
  prompt: string;
}

function taskPrompts(): Prompt[] {
  const prompts: Prompt[] = [];
  for (const kind of ['runtime', 'canary'] as const) {
    for (const file of readdirSync(join(TASKS, kind))) {
      const task = JSON.parse(readFileSync(join(TASKS, kind, file), 'utf8')) as {
        id: string;
        request: string;
      };
      prompts.push({ id: `${kind}/${task.id}`, prompt: task.request });
    }
  }
  for (const entry of readdirSync(join(TASKS, 'lane'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const task = JSON.parse(readFileSync(join(TASKS, 'lane', entry.name, 'task.json'), 'utf8')) as {
      id: string;
      instruction: string;
    };
    prompts.push({ id: `lane/${task.id}`, prompt: task.instruction });
  }
  return prompts;
}

describe('eval task prompts read like a user request', () => {
  const prompts = taskPrompts();
  const suite = JSON.parse(readFileSync(resolve(import.meta.dirname, 'suite.json'), 'utf8')) as {
    expectedCounts: Record<string, number>;
  };

  it('reads every task the suite manifest counts', () => {
    const counted = Object.values(suite.expectedCounts).reduce((sum, count) => sum + count, 0);
    expect(prompts).toHaveLength(counted);
  });

  it.each(prompts)('$id names no Coordinator tool', ({ id, prompt }) => {
    expect(prompt.trim()).not.toBe('');
    expect(mentionedTools(prompt), id).toEqual([]);
  });
});
