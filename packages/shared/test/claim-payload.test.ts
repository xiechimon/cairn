import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  CLAIM_PAYLOAD_VERSION,
  claimedStepSchema,
  claimedStepV1Schema,
  claimPayloadVersionOf,
  claimPayloadVersionSchema,
  machineClaimResponseSchema,
} from '../src/index.js';

const FROZEN_PRE_V1_CLAIMED_STEP_SCHEMA = z.object({
  step: z.object({
    id: z.string(),
    buildId: z.string(),
    kind: z.enum(['plan', 'build', 'session', 'merge', 'review', 'verify', 'chief']),
    machineId: z.string().nullable(),
    createdAt: z.number(),
    generation: z.number().optional(),
  }),
  conversationId: z.string(),
  session: z.object({
    action: z.enum(['new', 'continue']),
    sessionId: z.string().nullable(),
    priorMachineId: z.string().optional(),
  }),
  instruction: z.string().nullable().optional(),
  answerIds: z.array(z.string().min(1)).optional(),
  agent: z
    .object({
      id: z.string(),
      displayName: z.string(),
      description: z.string().nullable(),
      provider: z.string().nullable(),
      modelId: z.string().nullable(),
      thinkingLevel: z.string().nullable(),
      memories: z.array(z.object({ title: z.string(), content: z.string() })).optional(),
    })
    .nullable(),
  mcpServers: z.array(z.string()).optional(),
});

function sampleClaimPayload() {
  return {
    step: {
      id: 'step-1',
      buildId: 'build-1',
      kind: 'build' as const,
      machineId: 'machine-1',
      createdAt: 1_700_000_000_000,
      generation: 1_700_000_000_001,
    },
    conversationId: 'build-1',
    session: { action: 'new' as const, sessionId: null },
    instruction: 'implement feature',
    agent: {
      id: 'agent-1',
      displayName: 'Builder',
      description: null,
      provider: 'openai',
      modelId: 'gpt-5',
      thinkingLevel: null,
    },
  };
}

describe('claim payload protocol versioning', () => {
  test('parses v1 payloads and retains payloadVersion = 1', () => {
    expect(CLAIM_PAYLOAD_VERSION).toBe(1);
    expect(claimPayloadVersionSchema.parse(1)).toBe(1);

    const parsed = claimedStepSchema.parse({
      ...sampleClaimPayload(),
      payloadVersion: CLAIM_PAYLOAD_VERSION,
    });
    expect(parsed.payloadVersion).toBe(1);
    expect(claimPayloadVersionOf(parsed)).toBe(1);

    const envelope = machineClaimResponseSchema.parse({ step: parsed });
    expect(envelope.step?.payloadVersion).toBe(1);
  });

  test('defaults legacy unversioned claim payloads to version 1 and preserves null claims', () => {
    const legacyParsed = claimedStepV1Schema.parse(sampleClaimPayload());
    expect(legacyParsed.payloadVersion).toBeUndefined();
    expect(claimPayloadVersionOf(legacyParsed)).toBe(1);

    expect(machineClaimResponseSchema.parse({ step: null })).toEqual({ step: null });
  });

  test('rejects unsupported payloadVersion values', () => {
    for (const invalidVersion of [0, 2, '1', null]) {
      expect(() =>
        claimedStepSchema.parse({
          ...sampleClaimPayload(),
          payloadVersion: invalidVersion,
        }),
      ).toThrow();
    }
  });

  test('frozen pre-versioning runner schema strips payloadVersion from a v1 server payload', () => {
    const serverPayload = claimedStepSchema.parse({
      ...sampleClaimPayload(),
      payloadVersion: CLAIM_PAYLOAD_VERSION,
    });
    const decodedByOldRunner = FROZEN_PRE_V1_CLAIMED_STEP_SCHEMA.parse(serverPayload);
    expect('payloadVersion' in decodedByOldRunner).toBe(false);
    expect(decodedByOldRunner.step.id).toBe('step-1');
  });
});
