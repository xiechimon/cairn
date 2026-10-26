import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { claimStep, meetsMcpVersionGate } from '../src/services/machine-claim.js';
import { isChiefConversation, ownedStep } from '../src/services/machine-deps.js';
import { finishStep } from '../src/services/machine-finish-step.js';
import { MERGE_NOT_LANDED_NOTE } from '../src/services/machine-merge-landing.js';
import { stepToken, toProviderConfig } from '../src/services/machine-step-token.js';
import * as machines from '../src/services/machines.js';

const servicesDir = join(import.meta.dirname, '../src/services');
const splitModules = [
  'machine-deps',
  'machine-claim',
  'machine-step-token',
  'machine-finish-step',
  'machine-merge-landing',
];

describe('machines.ts facade', () => {
  test('keeps its public export surface', () => {
    expect(Object.keys(machines).sort()).toEqual([
      'MACHINE_STALE_OFFLINE_MS',
      'MERGE_NOT_LANDED_NOTE',
      'agentForStep',
      'authorizeEnrollmentMachine',
      'backfillMachineConcurrency',
      'claimStep',
      'enrollMachine',
      'fetchSteer',
      'fetchStop',
      'findApiKeyByPlain',
      'findMachineByToken',
      'finishStep',
      'heartbeatStep',
      'isChiefConversation',
      'machineAttachmentDownload',
      'machineConcurrencyPatch',
      'machineRunningCount',
      'machineSkillFile',
      'machineSkillsManifest',
      'markOffline',
      'markPresence',
      'meetsMcpVersionGate',
      'ownedStep',
      'publishStepStatus',
      'recoverSteps',
      'reportActivity',
      'reportAgentTodo',
      'reportThinkingDelta',
      'reportTool',
      'reportTranscriptDelta',
      'reportTranscriptRow',
      'seedLocalMachine',
      'stepToken',
      'sweepStaleMachines',
      'toMachineRecord',
      'toProviderConfig',
      'upsertChiefRow',
      'upsertMessage',
    ]);
  });

  test('re-exports the split modules by identity', () => {
    expect(machines.claimStep).toBe(claimStep);
    expect(machines.meetsMcpVersionGate).toBe(meetsMcpVersionGate);
    expect(machines.isChiefConversation).toBe(isChiefConversation);
    expect(machines.ownedStep).toBe(ownedStep);
    expect(machines.finishStep).toBe(finishStep);
    expect(machines.MERGE_NOT_LANDED_NOTE).toBe(MERGE_NOT_LANDED_NOTE);
    expect(machines.stepToken).toBe(stepToken);
    expect(machines.toProviderConfig).toBe(toProviderConfig);
  });

  test('split modules never import the facade', () => {
    for (const name of splitModules) {
      const source = readFileSync(join(servicesDir, `${name}.ts`), 'utf8');
      expect(source, name).not.toMatch(/from '\.\/machines\.js'/);
    }
  });
});
