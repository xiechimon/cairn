import { expect, test } from 'vitest';
import {
  CHIEF_REMOTE_TOOLS,
  COORDINATOR_MEMORY_FLUSH_PROMPT_HEAD,
  MEMORY_VERIFY_NOTE,
  MEMORY_WRITE_CRITERION,
  WORKER_REMOTE_TOOLS,
  WORKER_REMOTE_TOOLS_GITHUB,
} from '../src/index.js';

test('every path an agent writes memory through carries the same write criterion', () => {
  for (const tools of [WORKER_REMOTE_TOOLS, WORKER_REMOTE_TOOLS_GITHUB, CHIEF_REMOTE_TOOLS]) {
    for (const name of ['save_memory', 'update_memory']) {
      const description = tools.find((tool) => tool.name === name)?.description;
      expect(description, name).toContain(MEMORY_WRITE_CRITERION);
    }
  }
  expect(COORDINATOR_MEMORY_FLUSH_PROMPT_HEAD).toContain(MEMORY_WRITE_CRITERION);
});

test('the extraction reply skips a duplicate and writes only updates and contradictions', () => {
  expect(COORDINATOR_MEMORY_FLUSH_PROMPT_HEAD).toContain(
    'write an update or a contradiction as a new entry whose text says what it replaces, and write nothing for a duplicate',
  );
  expect(COORDINATOR_MEMORY_FLUSH_PROMPT_HEAD).not.toContain('editing an entry means writing');
});

test('the shipped exclusions hold even when said, and a lasting request is never refused', () => {
  expect(MEMORY_WRITE_CRITERION).toContain(
    'Skip task progress, status, one-off details, the project list, tool lookups and matters of only this conversation, even when the user said them.',
  );
  expect(MEMORY_WRITE_CRITERION).toContain(
    'Lasting preferences, decisions and facts the user asks you to remember qualify.',
  );
  expect(MEMORY_WRITE_CRITERION).not.toContain('save something, save it');
});

test('the verify note tells the agent to check the repository before relying on memory', () => {
  expect(MEMORY_VERIFY_NOTE).toContain(
    'check what it says is in a repository against the repository before relying on it',
  );
  expect(MEMORY_VERIFY_NOTE.length).toBeLessThanOrEqual(260);
});

test('the verify note keeps what the user set above the repository files', () => {
  expect(MEMORY_VERIFY_NOTE).toContain(
    'preferences and decisions the user set still apply even where its files say otherwise',
  );
});

test('the criterion states each rule and stays within its prompt budget', () => {
  for (const rule of [
    'a month from now',
    'cannot be derived from the repository',
    'state what it replaces',
    'YYYY-MM-DD',
    'Saving nothing is a normal result',
  ])
    expect(MEMORY_WRITE_CRITERION).toContain(rule);
  expect(MEMORY_WRITE_CRITERION.length).toBeLessThanOrEqual(500);
});

test('save_memory warns on every runtime path that searchable files are not auto-loaded', () => {
  for (const tools of [WORKER_REMOTE_TOOLS, WORKER_REMOTE_TOOLS_GITHUB, CHIEF_REMOTE_TOOLS]) {
    const description = tools.find((tool) => tool.name === 'save_memory')?.description ?? '';
    expect(description).toContain('not auto-loaded on future turns');
    expect(description).toContain('Only MEMORY.md is always loaded');
  }
});
