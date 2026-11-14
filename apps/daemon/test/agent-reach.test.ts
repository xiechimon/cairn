import { describe, expect, it } from 'vitest';
import {
  AGENT_REACH_REFRESH_MS,
  AgentReachProbe,
  parseAgentReachDoctor,
} from '../src/agent-reach.js';

const DOCTOR_1_6_1 = JSON.stringify({
  schema_version: 1,
  ok: true,
  action: 'doctor',
  result: {
    version: '1.6.1',
    channels: [
      { channel: 'github', level: 'default', status: 'unverified', problems: [], regressed: false },
      {
        channel: 'bilibili',
        level: 'default',
        status: 'needs_setup',
        problems: ['bili-cli not installed'],
        regressed: false,
      },
    ],
    tools: [{ tool: 'opencli', version: '1.8.7' }],
  },
  error: null,
});

describe('parseAgentReachDoctor', () => {
  it('keeps the version and each channel status from agent-reach 1.6.1 doctor output', () => {
    expect(parseAgentReachDoctor(DOCTOR_1_6_1)).toEqual({
      version: '1.6.1',
      channels: [
        { channel: 'github', status: 'unverified' },
        { channel: 'bilibili', status: 'needs_setup' },
      ],
    });
  });

  it('reports nothing for an error envelope or output that is not JSON', () => {
    expect(
      parseAgentReachDoctor(JSON.stringify({ ok: false, error: { code: 'BAD_INPUT' } })),
    ).toBeUndefined();
    expect(parseAgentReachDoctor('agent-reach: command not found')).toBeUndefined();
  });
});

describe('AgentReachProbe', () => {
  it('reports the first result only after the doctor run finishes, and reruns only after the refresh window', async () => {
    let clock = 0;
    let runs = 0;
    const probe = new AgentReachProbe(
      async () => {
        runs++;
        return DOCTOR_1_6_1;
      },
      () => clock,
    );
    expect(probe.current()).toBeUndefined();
    await probe.settled();
    expect(probe.current()?.version).toBe('1.6.1');
    clock = AGENT_REACH_REFRESH_MS - 1;
    probe.current();
    expect(runs).toBe(1);
    clock = AGENT_REACH_REFRESH_MS;
    probe.current();
    await probe.settled();
    expect(runs).toBe(2);
  });

  it('drops an earlier report once the binary stops running', async () => {
    let clock = 0;
    let stdout: string | null = DOCTOR_1_6_1;
    const probe = new AgentReachProbe(
      async () => stdout,
      () => clock,
    );
    probe.current();
    await probe.settled();
    expect(probe.current()).toBeDefined();
    stdout = null;
    clock = AGENT_REACH_REFRESH_MS;
    probe.current();
    await probe.settled();
    expect(probe.current()).toBeUndefined();
  });
});
