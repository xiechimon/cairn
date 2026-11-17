import { describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import {
  type EligibilityInput,
  machineEligibility,
  missingCapabilityItems,
} from '../src/services/dispatch-eligibility.js';

function input(over: {
  machine?: Partial<EligibilityInput['machine']>;
  agent?: Partial<EligibilityInput['agent']>;
  model?: Partial<EligibilityInput['model']>;
  rest?: Partial<Omit<EligibilityInput, 'machine' | 'agent' | 'model'>>;
}): EligibilityInput {
  return {
    machine: readyMachine({
      id: 'mac',
      name: 'mac',
      claudeCodeReport: {
        installed: true,
        hostname: 'mac',
        models: [{ id: 'claude-sonnet-5-5', name: 'claude-sonnet-5-5' }],
      },
      capabilities: { mcpServers: ['figma'], skills: [], executor: 'host' },
      ...over.machine,
    }),
    agent: { machineId: 'omarchy', requiredCapabilities: null, ...over.agent },
    model: { provider: 'claude-code', modelId: 'claude-sonnet-5-5', ...over.model },
    catalog: [],
    localProject: false,
    claudeRateBlocked: false,
    claudeSubscriptionMissing: false,
    devinSubscriptionMissing: false,
    ...over.rest,
  };
}

describe('D71 machineEligibility: hard constraints for a worker step on a machine', () => {
  test('a machine that passes every constraint is eligible even when it is not the preferred one', () => {
    expect(machineEligibility(input({}))).toBeNull();
  });

  test('Claude Code not detected on the machine', () => {
    expect(
      machineEligibility(
        input({ machine: { claudeCodeReport: { installed: false, hostname: 'mac', models: [] } } }),
      )?.kind,
    ).toBe('runtime');
  });

  test('a machine whose daemon never reported Claude Code cannot take a claude-code step', () => {
    expect(machineEligibility(input({ machine: { claudeCodeReport: null } }))?.kind).toBe(
      'runtime',
    );
  });

  test('an Orb executor runs claude-code steps without a host report', () => {
    expect(
      machineEligibility(
        input({
          machine: {
            claudeCodeReport: null,
            capabilities: { mcpServers: [], skills: [], executor: 'orb' },
          },
          model: { modelId: 'claude-opus-5-5' },
        }),
      ),
    ).toBeNull();
  });

  test('claude-code model not configured on the machine and not live in the catalog', () => {
    const gap = machineEligibility(input({ model: { modelId: 'claude-opus-5-5' } }));
    expect(gap?.kind).toBe('model');
  });

  test('claude-code model live in the catalog runs without a local report entry', () => {
    expect(
      machineEligibility(
        input({
          model: { modelId: 'claude-opus-5-5' },
          rest: { catalog: [{ id: 'claude-opus-5-5', liveness: 'alive' }] },
        }),
      ),
    ).toBeNull();
  });

  test('a machine that reports no model list fails closed', () => {
    expect(
      machineEligibility(
        input({ machine: { claudeCodeReport: { installed: true, hostname: 'mac', models: [] } } }),
      )?.kind,
    ).toBe('model');
  });

  test('a model the catalog marks dead is refused even when the machine lists it', () => {
    const gap = machineEligibility(
      input({ rest: { catalog: [{ id: 'claude-sonnet-5-5', liveness: 'dead' }] } }),
    );
    expect(gap?.kind).toBe('model');
  });

  test('the preferred machine keeps its bind-time model check and is not re-checked at claim', () => {
    expect(
      machineEligibility(
        input({
          machine: {
            id: 'omarchy',
            claudeCodeReport: { installed: true, hostname: 'omarchy', models: [] },
          },
          agent: { machineId: 'omarchy' },
        }),
      ),
    ).toBeNull();
  });

  test('a pi step needs no claude-code model report', () => {
    expect(
      machineEligibility(
        input({
          machine: { claudeCodeReport: null },
          model: { provider: 'relay-186', modelId: 'glm-5.3' },
        }),
      ),
    ).toBeNull();
  });

  test('a required MCP server the machine lacks', () => {
    const gap = machineEligibility(
      input({ agent: { requiredCapabilities: { mcpServers: ['context7'] } } }),
    );
    expect(gap).toEqual({ kind: 'capability', missing: ['MCP server "context7"'] });
  });

  test('an Orb-required agent on a host executor never qualifies', () => {
    const gap = machineEligibility(input({ agent: { requiredCapabilities: { executor: 'orb' } } }));
    expect(gap).toEqual({ kind: 'capability', missing: ['Orb sandbox executor'] });
  });

  test('an Orb-required agent on an Orb executor qualifies', () => {
    expect(
      machineEligibility(
        input({
          machine: { capabilities: { mcpServers: [], skills: [], executor: 'orb' } },
          agent: { requiredCapabilities: { executor: 'orb' } },
        }),
      ),
    ).toBeNull();
  });

  test('a local-path project only runs on its preferred machine', () => {
    expect(machineEligibility(input({ rest: { localProject: true } }))?.kind).toBe('local-path');
    expect(
      machineEligibility(input({ machine: { id: 'omarchy' }, rest: { localProject: true } })),
    ).toBeNull();
  });

  test('a local-path project with no preferred machine runs anywhere eligible', () => {
    expect(
      machineEligibility(input({ agent: { machineId: null }, rest: { localProject: true } })),
    ).toBeNull();
  });

  test('a Claude-rate-blocked machine does not take a claude-code step', () => {
    expect(machineEligibility(input({ rest: { claudeRateBlocked: true } }))?.kind).toBe(
      'claude-blocked',
    );
  });

  test('a Claude-rate-blocked machine still takes a pi step', () => {
    expect(
      machineEligibility(
        input({
          model: { provider: 'relay-186', modelId: 'glm-5.3' },
          rest: { claudeRateBlocked: true },
        }),
      ),
    ).toBeNull();
  });

  test('a team without a usable Claude subscription does not take a claude-code step', () => {
    expect(machineEligibility(input({ rest: { claudeSubscriptionMissing: true } }))?.kind).toBe(
      'claude-login',
    );
  });

  test('a team without a usable Devin subscription does not take a devin step', () => {
    expect(
      machineEligibility(
        input({
          machine: {
            claudeCodeReport: null,
            capabilities: { mcpServers: [], skills: [], devin: { installed: true } },
          },
          model: { provider: 'devin', modelId: 'swe-2-high' },
          rest: { devinSubscriptionMissing: true },
        }),
      )?.kind,
    ).toBe('devin-subscription');
  });

  test('a devin step skips the per-runner model check on a static model list', () => {
    expect(
      machineEligibility(
        input({
          machine: {
            claudeCodeReport: null,
            capabilities: { mcpServers: [], skills: [], devin: { installed: true } },
          },
          model: { provider: 'devin', modelId: 'swe-2-high' },
        }),
      ),
    ).toBeNull();
  });
});

describe('D71 missing capability reports count as not satisfied', () => {
  test('no capability report: every required MCP server is missing', () => {
    expect(
      missingCapabilityItems(
        { capabilities: null, claudeCodeReport: null },
        { mcpServers: ['Figma'] },
      ).mcpServers,
    ).toEqual(['figma']);
  });

  test('no model report: every required model is missing', () => {
    expect(
      missingCapabilityItems(
        { capabilities: null, claudeCodeReport: null },
        { models: ['glm-5.3'] },
      ).models,
    ).toEqual(['glm-5.3']);
  });

  test('no requirement means nothing is missing even without reports', () => {
    expect(missingCapabilityItems({ capabilities: null, claudeCodeReport: null }, null)).toEqual({
      mcpServers: [],
      models: [],
    });
  });
});
