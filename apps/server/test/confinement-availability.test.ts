import { parseReportedCapabilities } from '@cairn/shared';
import { expect, test } from 'vitest';
import { type EligibilityInput, machineEligibility } from '../src/services/dispatch-eligibility.js';

const checking = {
  state: 'checking',
  invocation: 'a6f64985-e79a-4c69-a840-5d8c0853188d',
  generation: 1,
  revision: 1,
};

function eligibility(confinement: unknown, osPlatform = 'linux') {
  const capabilities = parseReportedCapabilities({
    mcpServers: [],
    skills: [],
    osPlatform,
    confinement,
  });
  const input: EligibilityInput = {
    machine: {
      id: 'machine-one',
      name: 'machine-one',
      enabledRuntimes: ['pi', 'claude-code', 'gemini'],
      claudeCodeReport: null,
      capabilities: capabilities ?? null,
    },
    agent: { machineId: 'machine-one', requiredCapabilities: null },
    model: { provider: 'test-provider', modelId: 'test-model' },
    catalog: [],
    localProject: false,
    claudeRateBlocked: false,
    claudeLoginBlocked: false,
    claudeUsageRefused: false,
  };
  return machineEligibility(input);
}

test('preflight checking blocks dispatch without disabling owner runtimes', () => {
  expect(eligibility(checking)).toEqual({ kind: 'confinement' });
});

test('startup infrastructure failure blocks dispatch', () => {
  expect(
    eligibility({ ...checking, state: 'unavailable', reason: 'startup-failed', revision: 2 }),
  ).toEqual({ kind: 'confinement' });
});

test('uncertain cleanup blocks dispatch', () => {
  expect(
    eligibility({ ...checking, state: 'unavailable', reason: 'cleanup-failed', revision: 2 }),
  ).toEqual({ kind: 'confinement' });
});

test('missing Linux confinement readiness fails closed', () => {
  expect(eligibility(undefined)).toEqual({ kind: 'confinement' });
});

test('malformed readiness cannot enable dispatch', () => {
  expect(eligibility({ state: 'ready' })).toEqual({ kind: 'confinement' });
});

test('validated confinement observations survive the shared capability parser', () => {
  expect(parseReportedCapabilities({ mcpServers: [], skills: [], confinement: checking })).toEqual({
    mcpServers: [],
    skills: [],
    confinement: checking,
  });
});

test('macOS not-applicable preserves dispatch and survives parsing', () => {
  const report = { ...checking, state: 'not-applicable' };
  expect(
    parseReportedCapabilities({ mcpServers: [], skills: [], confinement: report })?.confinement,
  ).toEqual(report);
  expect(eligibility(report, 'darwin')).toBeNull();
});

test('legacy unknown platform and non-Linux reports never gate eligibility', () => {
  expect(eligibility(undefined, 'legacy')).toBeNull();
  expect(eligibility(undefined, 'darwin')).toBeNull();
  expect(eligibility(checking, 'darwin')).toBeNull();
});

test('Linux cannot use a not-applicable report to bypass readiness', () => {
  expect(eligibility({ ...checking, state: 'not-applicable' })).toEqual({ kind: 'confinement' });
});
