import { describe, expect, test } from 'vitest';
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
    machine: {
      id: 'mac',
      name: 'mac',
      enabledRuntimes: ['claude-code', 'pi'],
      claudeCodeReport: {
        installed: true,
        hostname: 'mac',
        models: [{ id: 'claude-sonnet-5-5', name: 'claude-sonnet-5-5' }],
      },
      capabilities: { mcpServers: ['figma'], skills: [], executor: 'host' },
      ...over.machine,
    },
    agent: { machineId: 'omarchy', requiredCapabilities: null, ...over.agent },
    model: { provider: 'claude-code', modelId: 'claude-sonnet-5-5', ...over.model },
    catalog: [],
    localProject: false,
    claudeRateBlocked: false,
    claudeLoginBlocked: false,
    claudeUsageRefused: false,
    ...over.rest,
  };
}

describe('D71 machineEligibility: hard constraints for a worker step on a machine', () => {
  test('a machine that passes every constraint is eligible even when it is not the preferred one', () => {
    expect(machineEligibility(input({}))).toBeNull();
  });

  test('runtime not enabled on the machine', () => {
    expect(machineEligibility(input({ machine: { enabledRuntimes: ['pi'] } }))?.kind).toBe(
      'runtime',
    );
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

  test('a machine that never reported its model list fails closed', () => {
    expect(machineEligibility(input({ machine: { claudeCodeReport: null } }))?.kind).toBe('model');
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
          machine: { id: 'omarchy', claudeCodeReport: null },
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

  test('a machine whose Claude login is blocked does not take a claude-code step', () => {
    expect(machineEligibility(input({ rest: { claudeLoginBlocked: true } }))?.kind).toBe(
      'claude-login',
    );
  });

  test('a machine where the team usage policy refuses this Claude model', () => {
    expect(machineEligibility(input({ rest: { claudeUsageRefused: true } }))?.kind).toBe(
      'claude-usage',
    );
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
