// #1251 机器能力上报 + agent 能力要求（ADR 0018 决策 4）：wire/record 形状。
// 失败方式（先于实现固化）：
// 1. 心跳红线（02 §5.4）：presence/enroll body 的 capabilities 位必须是
//    wire 级宽松（z.unknown）——坏形状（类型错、非对象）在 body 解析层
//    恒通过，不得 400 整个心跳；收严发生在 server 侧 safeParse
//    （machineCapabilitiesSchema），失败丢弃该字段保留旧值。
// 2. 加法契约：不带 capabilities 的 body（老 daemon）照常解析；不带
//    requiredCapabilities 的 agent record / 不带 capabilities 的 machine
//    record（老 server 响应）照常解析。
// 3. machineCapabilitiesSchema 本体是严的：mcpServers/skills 必须 string[]，
//    类型错 = 拒（server safeParse 的判据面）。
// 4. requiredCapabilitiesSchema：两维各自可选（mcpServers/models），空对象
//    合法（显式「无要求」与缺省 null 同值）；类型错 = 拒（写侧 400 判据）。
// 5. queue 投影的 blocked 位：kind 词表钉死 machine-offline /
//    capability-missing；缺席 = 老 server（排队呈现退化，零回归）。
// 6. machine-fit 读面（agent 面「哪些机器可跑它」）：形状钉死——canRun /
//    runtimeOk / missing（null = 该机未上报快照）/ mcpGaps（对账面，null 同律）。

import { describe, expect, it } from 'vitest';
import {
  agentMachineFitResponseSchema,
  agentRecordSchema,
  createAgentBodySchema,
  machineCapabilitiesSchema,
  machineEnrollBodySchema,
  machinePresenceBodySchema,
  machineRecordSchema,
  requiredCapabilitiesSchema,
  stepJournalRowSchema,
} from '../src/index.js';

describe('machineCapabilitiesSchema（daemon 上报的机器能力清单）', () => {
  it('合法清单：mcpServers slug 集 + 本机技能名集', () => {
    const parsed = machineCapabilitiesSchema.parse({
      mcpServers: ['figma', 'context7'],
      skills: ['verify-pacman', 'pr-pacman'],
    });
    expect(parsed.mcpServers).toEqual(['figma', 'context7']);
    expect(parsed.skills).toEqual(['verify-pacman', 'pr-pacman']);
  });

  it('空集合法（机器没装 MCP / 没有本机技能）', () => {
    expect(machineCapabilitiesSchema.parse({ mcpServers: [], skills: [] })).toEqual({
      mcpServers: [],
      skills: [],
    });
  });

  it('类型错 = 拒（server safeParse 判据：坏字段丢弃、心跳不阻）', () => {
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

describe('requiredCapabilitiesSchema（agent 能力要求声明）', () => {
  it('两维各自可选；空对象 = 显式无要求', () => {
    expect(requiredCapabilitiesSchema.parse({})).toEqual({});
    expect(requiredCapabilitiesSchema.parse({ mcpServers: ['figma'] })).toEqual({
      mcpServers: ['figma'],
    });
    expect(requiredCapabilitiesSchema.parse({ models: ['glm-5.3'] })).toEqual({
      models: ['glm-5.3'],
    });
  });

  it('类型错 = 拒（写侧 400 判据）', () => {
    expect(requiredCapabilitiesSchema.safeParse({ mcpServers: 'figma' }).success).toBe(false);
    expect(requiredCapabilitiesSchema.safeParse({ models: [3] }).success).toBe(false);
  });
});

describe('心跳红线：capabilities 位在 body 解析层恒宽（02 §5.4）', () => {
  it('presence body：带合法 capabilities / 不带（老 daemon）/ 带坏形状，三形皆过 body 解析', () => {
    expect(
      machinePresenceBodySchema.parse({
        cliVersion: '0.1.0',
        capabilities: { mcpServers: ['figma'], skills: [] },
      }).capabilities,
    ).toEqual({ mcpServers: ['figma'], skills: [] });
    expect(machinePresenceBodySchema.parse({ cliVersion: '0.1.0' }).capabilities).toBeUndefined();
    // 坏形状不得在 wire 层拒——拒它 = 400 整个心跳 = 红线违规；
    // 收严在 server 侧 safeParse（丢弃坏字段保留旧值）。
    expect(
      machinePresenceBodySchema.parse({ capabilities: { mcpServers: 'oops' } }).capabilities,
    ).toEqual({ mcpServers: 'oops' });
    expect(machinePresenceBodySchema.parse({ capabilities: 42 }).capabilities).toBe(42);
  });

  it('enroll body：同律（注册上报能力清单，坏形状不阻注册）', () => {
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

describe('record 加法契约（老 server / 老 daemon 双向可解析）', () => {
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

  it('agentRecordSchema：不带 requiredCapabilities（存量行/老 server）照常解析', () => {
    const parsed = agentRecordSchema.parse(agentBase);
    expect(parsed.requiredCapabilities ?? null).toBeNull();
  });

  it('agentRecordSchema：带 requiredCapabilities 原样透出', () => {
    const parsed = agentRecordSchema.parse({
      ...agentBase,
      requiredCapabilities: { mcpServers: ['figma'] },
    });
    expect(parsed.requiredCapabilities).toEqual({ mcpServers: ['figma'] });
  });

  it('createAgentBodySchema：requiredCapabilities 可写、可缺省、null = 清空', () => {
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

  it('machineRecordSchema：capabilities 三态——缺席（老 server）/ null（从未上报）/ 清单', () => {
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

describe('queue 投影 blocked 位（#1251 可见 pending reason）', () => {
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

  it('blocked 缺席 = 老 server（排队呈现退化，零回归）', () => {
    const parsed = stepJournalRowSchema.parse({
      ...rowBase,
      queue: { position: 1, waitingFor: null },
    });
    expect(parsed.queue?.blocked).toBeUndefined();
  });

  it('capability-missing：缺项名可读形随行', () => {
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

  it('machine-offline：等机器上线（missing 空集）', () => {
    const parsed = stepJournalRowSchema.parse({
      ...rowBase,
      queue: { position: 1, waitingFor: null, blocked: { kind: 'machine-offline', missing: [] } },
    });
    expect(parsed.queue?.blocked?.kind).toBe('machine-offline');
  });

  it('kind 词表外值 = 拒', () => {
    expect(
      stepJournalRowSchema.safeParse({
        ...rowBase,
        queue: { position: 1, waitingFor: null, blocked: { kind: 'vibes', missing: [] } },
      }).success,
    ).toBe(false);
  });
});

describe('agentMachineFitResponseSchema（agent 面「哪些机器可跑它」）', () => {
  it('行形：canRun 判定 + missing/mcpGaps 三态（null = 未上报快照）', () => {
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

  it('缺 machines / 行缺位 = 拒（读面恒发全块）', () => {
    expect(agentMachineFitResponseSchema.safeParse({}).success).toBe(false);
    expect(
      agentMachineFitResponseSchema.safeParse({ machines: [{ machineId: 'm1' }] }).success,
    ).toBe(false);
  });
});
