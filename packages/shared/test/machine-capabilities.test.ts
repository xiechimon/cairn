import { describe, expect, it } from 'vitest';
import {
  agentMachineFitResponseSchema,
  agentRecordSchema,
  createAgentBodySchema,
  machineCapabilitiesSchema,
  machineEnrollBodySchema,
  machineHardwareSchema,
  machinePresenceBodySchema,
  machineRecordSchema,
  parseReportedCapabilities,
  requiredCapabilitiesSchema,
  stepJournalRowSchema,
} from '../src/index.js';

describe('machineCapabilitiesSchema (daemon-reported machine capability list)', () => {
  it('valid list: mcpServers slug set + local skill name set', () => {
    const parsed = machineCapabilitiesSchema.parse({
      mcpServers: ['figma', 'context7'],
      skills: ['verify-cairn', 'pr-cairn'],
    });
    expect(parsed.mcpServers).toEqual(['figma', 'context7']);
    expect(parsed.skills).toEqual(['verify-cairn', 'pr-cairn']);
  });

  it('empty set legal (machine without MCP / without local skills)', () => {
    expect(machineCapabilitiesSchema.parse({ mcpServers: [], skills: [] })).toEqual({
      mcpServers: [],
      skills: [],
    });
  });

  it('type error = reject (server safeParse criterion: bad fields dropped, heartbeat unblocked)', () => {
    expect(machineCapabilitiesSchema.safeParse({ mcpServers: 'figma', skills: [] }).success).toBe(
      false,
    );
    expect(machineCapabilitiesSchema.safeParse({ mcpServers: [1], skills: [] }).success).toBe(
      false,
    );
    expect(machineCapabilitiesSchema.safeParse('figma').success).toBe(false);
    expect(machineCapabilitiesSchema.safeParse(null).success).toBe(false);
  });
});

describe('requiredCapabilitiesSchema (agent capability-requirement declaration)', () => {
  it('each dimension optional; empty object = explicit no requirement', () => {
    expect(requiredCapabilitiesSchema.parse({})).toEqual({});
    expect(requiredCapabilitiesSchema.parse({ mcpServers: ['figma'] })).toEqual({
      mcpServers: ['figma'],
    });
    expect(requiredCapabilitiesSchema.parse({ models: ['glm-5.3'] })).toEqual({
      models: ['glm-5.3'],
    });
  });

  it('type error = reject (write-side 400 criterion)', () => {
    expect(requiredCapabilitiesSchema.safeParse({ mcpServers: 'figma' }).success).toBe(false);
    expect(requiredCapabilitiesSchema.safeParse({ models: [3] }).success).toBe(false);
  });
});

describe('heartbeat red line: the capabilities field is always lenient at the body-parsing layer (02 §5.4)', () => {
  it('presence body: with valid capabilities / without (old daemon) / with malformed shape, all three pass body parsing', () => {
    expect(
      machinePresenceBodySchema.parse({
        cliVersion: '0.1.0',
        capabilities: { mcpServers: ['figma'], skills: [] },
      }).capabilities,
    ).toEqual({ mcpServers: ['figma'], skills: [] });
    expect(machinePresenceBodySchema.parse({ cliVersion: '0.1.0' }).capabilities).toBeUndefined();
    expect(
      machinePresenceBodySchema.parse({ capabilities: { mcpServers: 'oops' } }).capabilities,
    ).toEqual({ mcpServers: 'oops' });
    expect(machinePresenceBodySchema.parse({ capabilities: 42 }).capabilities).toBe(42);
  });

  it('enroll body: same rule (capabilities reported at registration; malformed shapes do not block enrollment)', () => {
    expect(
      machineEnrollBodySchema.parse({
        teamId: 'team-1',
        capabilities: { mcpServers: [], skills: ['a'] },
      }).capabilities,
    ).toEqual({ mcpServers: [], skills: ['a'] });
    expect(machineEnrollBodySchema.parse({ teamId: 'team-1' }).capabilities).toBeUndefined();
    expect(
      machineEnrollBodySchema.parse({ teamId: 'team-1', capabilities: 'x' }).capabilities,
    ).toBe('x');
  });
});

describe('record additive contract (old server / old daemon parse both ways)', () => {
  const agentBase = {
    id: 'agent-1',
    displayName: 'Implementer',
    description: null,
    status: 'active' as const,
    avatarUrl: null,
    provider: null,
    modelId: null,
    thinkingLevel: null,
    tools: [],
    secrets: [],
    defaultSkill: null,
    skillsAllowlist: null,
    mcpServers: [],
  };

  it('agentRecordSchema: without requiredCapabilities (existing rows / old server) still parses', () => {
    const parsed = agentRecordSchema.parse(agentBase);
    expect(parsed.requiredCapabilities ?? null).toBeNull();
  });

  it('agentRecordSchema: with requiredCapabilities passed through verbatim', () => {
    const parsed = agentRecordSchema.parse({
      ...agentBase,
      requiredCapabilities: { mcpServers: ['figma'] },
    });
    expect(parsed.requiredCapabilities).toEqual({ mcpServers: ['figma'] });
  });

  it('createAgentBodySchema: requiredCapabilities writable, optional, null = clear', () => {
    expect(
      createAgentBodySchema.parse({
        displayName: 'a',
        machineId: 'machine-1',
        requiredCapabilities: { models: ['m'] },
      }).requiredCapabilities,
    ).toEqual({ models: ['m'] });
    expect(
      createAgentBodySchema.parse({ displayName: 'a', machineId: 'machine-1' })
        .requiredCapabilities,
    ).toBeUndefined();
    expect(
      createAgentBodySchema.parse({
        displayName: 'a',
        machineId: 'machine-1',
        requiredCapabilities: null,
      }).requiredCapabilities,
    ).toBeNull();
    expect(
      createAgentBodySchema.safeParse({
        displayName: 'a',
        machineId: 'machine-1',
        requiredCapabilities: { mcpServers: 1 },
      }).success,
    ).toBe(false);
  });

  const machineBase = {
    id: 'machine-1',
    name: 'mbp',
    teamId: 'team-1',
    online: true,
    latestCliVersion: null,
    kind: 'local' as const,
    enabledRuntimes: ['pi'],
    shellEnabled: false,
  };

  it('machineRecordSchema: capabilities three states -- absent (old server) / null (never reported) / list', () => {
    expect(machineRecordSchema.parse(machineBase).capabilities).toBeUndefined();
    expect(
      machineRecordSchema.parse({ ...machineBase, capabilities: null }).capabilities,
    ).toBeNull();
    expect(
      machineRecordSchema.parse({
        ...machineBase,
        capabilities: { mcpServers: ['figma'], skills: [] },
      }).capabilities,
    ).toEqual({ mcpServers: ['figma'], skills: [] });
  });
});

describe('queue projection blocked bit (#1251 visible pending reason)', () => {
  const rowBase = {
    id: 'step-1',
    buildId: 'build-1',
    kind: 'build' as const,
    machineId: null,
    createdAt: 1,
    status: 'pending' as const,
    checkpointCommit: null,
    skillInjection: null,
  };

  it('blocked absent = old server (queue rendering degrades, zero regression)', () => {
    const parsed = stepJournalRowSchema.parse({
      ...rowBase,
      queue: { position: 1, waitingFor: null },
    });
    expect(parsed.queue?.blocked).toBeUndefined();
  });

  it('capability-missing: missing item names in readable form travel with the row', () => {
    const parsed = stepJournalRowSchema.parse({
      ...rowBase,
      queue: {
        position: 1,
        waitingFor: null,
        blocked: { kind: 'capability-missing', missing: ['MCP server "figma"'] },
      },
    });
    expect(parsed.queue?.blocked).toEqual({
      kind: 'capability-missing',
      missing: ['MCP server "figma"'],
    });
  });

  it('machine-offline: waiting for the machine to come online (missing empty)', () => {
    const parsed = stepJournalRowSchema.parse({
      ...rowBase,
      queue: { position: 1, waitingFor: null, blocked: { kind: 'machine-offline', missing: [] } },
    });
    expect(parsed.queue?.blocked?.kind).toBe('machine-offline');
  });

  it('kinds outside the vocabulary = rejected', () => {
    expect(
      stepJournalRowSchema.safeParse({
        ...rowBase,
        queue: { position: 1, waitingFor: null, blocked: { kind: 'vibes', missing: [] } },
      }).success,
    ).toBe(false);
  });
});

describe('agentMachineFitResponseSchema (agent-facing "which machines can run it")', () => {
  it('row shape: canRun verdict + missing/mcpGaps three states (null = no snapshot reported)', () => {
    const parsed = agentMachineFitResponseSchema.parse({
      machines: [
        {
          machineId: 'm1',
          name: 'mbp',
          online: true,
          runtimeOk: true,
          missing: [],
          mcpGaps: ['figma'],
          canRun: true,
        },
        {
          machineId: 'm2',
          name: 'mea',
          online: false,
          runtimeOk: true,
          missing: null,
          mcpGaps: null,
          canRun: true,
        },
      ],
    });
    expect(parsed.machines).toHaveLength(2);
    expect(parsed.machines[0]?.mcpGaps).toEqual(['figma']);
    expect(parsed.machines[1]?.missing).toBeNull();
  });

  it('missing machines / row missing fields = reject (read surface always sends the full block)', () => {
    expect(agentMachineFitResponseSchema.safeParse({}).success).toBe(false);
    expect(
      agentMachineFitResponseSchema.safeParse({ machines: [{ machineId: 'm1' }] }).success,
    ).toBe(false);
  });
});

describe('#1241 parseReportedCapabilities (field-level tightening)', () => {
  const hardware = {
    cpuCores: 8,
    memoryTotalMb: 16384,
    memoryAvailableMb: 4096,
    loadAvg1: 0.5,
    diskFreeMb: 20480,
  };

  it('7 valid fingerprints preserved verbatim in the bundle', () => {
    expect(
      parseReportedCapabilities({ mcpServers: ['figma'], skills: ['deploy'], hardware }),
    ).toEqual({ mcpServers: ['figma'], skills: ['deploy'], hardware });
  });

  it('7 malformed fingerprint shape (zero cores): only hardware dropped, mcp/skills still accepted', () => {
    expect(
      parseReportedCapabilities({
        mcpServers: ['figma'],
        skills: [],
        hardware: { ...hardware, cpuCores: 0 },
      }),
    ).toEqual({ mcpServers: ['figma'], skills: [] });
  });

  it('7 pre-upgrade fingerprints without memoryTotalMb accepted as-is (read side does not fail whole rows on new fields)', () => {
    const { memoryTotalMb: _dropped, ...legacy } = hardware;
    expect(parseReportedCapabilities({ mcpServers: [], skills: [], hardware: legacy })).toEqual({
      mcpServers: [],
      skills: [],
      hardware: legacy,
    });
  });

  it('7 old daemon without hardware: list accepted, hardware absent', () => {
    expect(parseReportedCapabilities({ mcpServers: [], skills: ['a'] })).toEqual({
      mcpServers: [],
      skills: ['a'],
    });
  });

  it('7 malformed list itself (mcpServers not an array) -> whole bundle undefined, regardless of hardware validity', () => {
    expect(
      parseReportedCapabilities({ mcpServers: 'figma', skills: [], hardware }),
    ).toBeUndefined();
  });

  it('7 non-object / array -> undefined', () => {
    expect(parseReportedCapabilities(null)).toBeUndefined();
    expect(parseReportedCapabilities(['figma'])).toBeUndefined();
  });

  it('7 machineHardwareSchema rejects negative memory and non-integer cores', () => {
    expect(machineHardwareSchema.safeParse({ ...hardware, memoryAvailableMb: -1 }).success).toBe(
      false,
    );
    expect(machineHardwareSchema.safeParse({ ...hardware, memoryTotalMb: -1 }).success).toBe(false);
    expect(machineHardwareSchema.safeParse({ ...hardware, cpuCores: 2.5 }).success).toBe(false);
  });
});
