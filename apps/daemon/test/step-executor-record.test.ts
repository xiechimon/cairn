import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MachineHeartbeatBody } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { buildExecutorRecord } from '../src/executor-record.js';
import { reportStepProvenance, stepExecutorRecord } from '../src/step-executor-record.js';
import { testTempDir } from './test-temp-dir.js';

function skillsFixture(): { skillsDir: string; cwd: string; content: (name: string) => string } {
  const root = testTempDir('cairn-step-executor-');
  const skillsDir = join(root, 'skills');
  const content = (name: string) => `---\ndescription: ${name} skill\n---\n\n${name} body.\n`;
  for (const name of ['alpha', 'beta']) {
    mkdirSync(join(skillsDir, name), { recursive: true });
    writeFileSync(join(skillsDir, name, 'SKILL.md'), content(name), 'utf8');
  }
  return { skillsDir, cwd: root, content };
}

const base = {
  backend: 'pi',
  model: 'p/m',
  effort: 'high',
  systemPrompt: 'system',
} as const;

describe('stepExecutorRecord', () => {
  test('hashes only the injected skills with their file contents', () => {
    const { skillsDir, cwd, content } = skillsFixture();
    const record = stepExecutorRecord({
      ...base,
      catalog: { skillsDir, cwd },
      injectedNames: ['beta'],
      tools: [],
    });
    expect(record).toEqual(
      buildExecutorRecord({
        ...base,
        harness: {
          systemPrompt: 'system',
          skills: [{ name: 'beta', content: content('beta') }],
          tools: [],
        },
      }),
    );
  });

  test('hashes every visible skill when no injection list is known', () => {
    const { skillsDir, cwd, content } = skillsFixture();
    const record = stepExecutorRecord({
      ...base,
      catalog: { skillsDir, cwd },
      injectedNames: undefined,
      tools: [],
    });
    expect(record.harness_sha).toBe(
      buildExecutorRecord({
        ...base,
        harness: {
          systemPrompt: 'system',
          skills: [
            { name: 'alpha', content: content('alpha') },
            { name: 'beta', content: content('beta') },
          ],
          tools: [],
        },
      }).harness_sha,
    );
  });

  test('without a catalog it hashes no skills, an empty prompt and only tool names and descriptions', () => {
    const tools = [{ name: 'run', description: 'runs', inputSchema: { type: 'object' } }];
    const record = stepExecutorRecord({
      ...base,
      systemPrompt: undefined,
      catalog: null,
      injectedNames: undefined,
      tools,
    });
    expect(record).toEqual(
      buildExecutorRecord({
        ...base,
        harness: {
          systemPrompt: '',
          skills: [],
          tools: [{ name: 'run', description: 'runs' }],
        },
      }),
    );
  });
});

describe('reportStepProvenance', () => {
  const record = () => ({ ...base, catalog: null, injectedNames: undefined, tools: [] });

  test('stamps the base sha and harness hash and sends them in a heartbeat', async () => {
    const provenance: MachineHeartbeatBody = {};
    const sent: MachineHeartbeatBody[] = [];
    const lines: string[] = [];
    await reportStepProvenance({
      record,
      provenance,
      baseSha: 'a'.repeat(40),
      heartbeat: async (body) => {
        sent.push({ ...body });
      },
      log: (line) => lines.push(line),
    });
    const expected = stepExecutorRecord(record());
    expect(sent).toEqual([{ baseSha: 'a'.repeat(40), harnessHash: expected.harness_sha }]);
    expect(lines).toEqual([`executor record ${JSON.stringify(expected)}`]);
  });

  test('logs and swallows a failing heartbeat or record build', async () => {
    const lines: string[] = [];
    await reportStepProvenance({
      record,
      provenance: {},
      baseSha: null,
      heartbeat: async () => {
        throw new Error('server down');
      },
      log: (line) => lines.push(line),
    });
    await reportStepProvenance({
      record: () => {
        throw new Error('catalog unreadable');
      },
      provenance: {},
      baseSha: null,
      heartbeat: async () => {},
      log: (line) => lines.push(line),
    });
    expect(lines.slice(-1)).toEqual(['build provenance report failed: catalog unreadable']);
    expect(lines).toContain('build provenance report failed: server down');
  });
});
