import { describe, expect, it } from 'vitest';
import {
  AGENT_TOOL_COPY,
  AGENT_TOOL_DEFAULTS,
  AGENT_TOOL_SWITCHES,
  agentRecordSchema,
  assignmentSchema,
  buildRecordSchema,
  buildStepActionBodySchema,
  chiefGetResponseSchema,
  chiefThreadSchema,
  chiefThreadTitle,
  createTodoBodySchema,
  daemonJsonSchema,
  deviceJsonSchema,
  filterAgentTools,
  githubIssueSourceRef,
  machineJsonSchema,
  mcpServerRecordSchema,
  memoryRecordSchema,
  mergeAcceptedResponseSchema,
  notificationRecordSchema,
  notificationsResponseSchema,
  orchestrationSourceRef,
  PROVIDER_PRESET_IDS,
  parseOrchestrationSourceRef,
  patchChiefBodySchema,
  providerRecordSchema,
  scheduleRecordSchema,
  searchResponseSchema,
  startBuildsBodySchema,
  teamMemberSchema,
  teamRecordSchema,
  teamStreamEventSchema,
  todoRecordSchema,
} from '../src/index.js';

describe('todo record (02 §4.1 + r3 §3.0 + r5 §3.2)', () => {
  const sample = {
    id: 'todo_01',
    teamId: 'BoZYfvqKSGanlxsXVbXSa',
    projectId: 'prj_r3',
    title: '编写 CONTRIBUTING.md 贡献指南',
    spec: '> 帮 r3-lifecycle 写一份 CONTRIBUTING.md …\n要求：\n- …',
    phase: 'review',
    phaseAt: 1758531600000,
    seqNum: 11,
    orderIndex: 0,
    tagIds: [],
    assignment: { plan: null, build: { agentId: 'SPn3bR8GalngsJm1ge-Sh' } },
    agent: { id: 'SPn3bR8GalngsJm1ge-Sh', displayName: 'r5-scribe' },
    latestBuildId: '01a0b86f-04f9-72a8-bba4-75c5cfd6598f',
    lastRunAt: 1758531600000,
    hasChanges: true,
    hasPlan: true,
    buildHistory: [{ buildId: '01a0b86f-04f9-72a8-bba4-75c5cfd6598f', createdAt: 1758531000000 }],
    sourceTodo: null,
    v: 3,
    createdBy: 'TVv0DxUu3jTIhYpeWh6mn',
    ownerId: 'usr_mon',
    sourceBuildId: 'chief-6ItyfRe7Q7hru5xFmMu-u-',
    sourceKind: null,
    sourceRef: null,
    output: 'code',
  };

  it('parses the full observed field set', () => {
    expect(todoRecordSchema.parse(sample)).toEqual(sample);
  });

  it('two source columns (#446 / ADR 0005 D6): github-issue + reference string pass, unknown kinds rejected', () => {
    const imported = {
      ...sample,
      sourceKind: 'github-issue',
      sourceRef: 'github:octo/alpha#7',
    };
    expect(todoRecordSchema.parse(imported)).toEqual(imported);
    expect(todoRecordSchema.safeParse({ ...sample, sourceKind: 'jira' }).success).toBe(false);
    expect(githubIssueSourceRef('octo', 'alpha', 7)).toBe('github:octo/alpha#7');
  });

  it('orchestration source (#640 / r14 §5.3): orchestration passes + chief ref strictly mutual', () => {
    const dispatched = {
      ...sample,
      sourceKind: 'orchestration',
      sourceRef: 'chief:01a0b86f-04f9-72a8-bba4-75c5cfd6598f',
    };
    expect(todoRecordSchema.parse(dispatched)).toEqual(dispatched);
    expect(orchestrationSourceRef('chief-01a0b86f-04f9-72a8-bba4-75c5cfd6598f')).toBe(
      'chief:01a0b86f-04f9-72a8-bba4-75c5cfd6598f',
    );
    expect(parseOrchestrationSourceRef('chief:01a0b86f-04f9-72a8-bba4-75c5cfd6598f')).toEqual({
      threadId: 'chief-01a0b86f-04f9-72a8-bba4-75c5cfd6598f',
    });
    expect(() => orchestrationSourceRef('01a0b86f-04f9-72a8-bba4-75c5cfd6598f')).toThrow();
    expect(parseOrchestrationSourceRef('github:octo/alpha#7')).toBeNull();
    expect(parseOrchestrationSourceRef('chief:')).toBeNull();
  });

  it('rejects the retired exec guess (r3 §3.0 renamed building)', () => {
    expect(todoRecordSchema.safeParse({ ...sample, phase: 'exec' }).success).toBe(false);
  });

  it('parses the create body verbatim (r3 §3.1 capture {title, spec})', () => {
    expect(createTodoBodySchema.parse({ title: 't', spec: 's' })).toEqual({
      title: 't',
      spec: 's',
    });
  });

  it('assignment is the dual-slot shape (02 §6.2/r5 §3.4)', () => {
    expect(assignmentSchema.parse({ plan: { agentId: 'a1' }, build: { agentId: 'a2' } })).toEqual({
      plan: { agentId: 'a1' },
      build: { agentId: 'a2' },
    });
    expect(assignmentSchema.safeParse({ agentId: 'a1' }).success).toBe(false);
  });
});

describe('build record (02 §6.2, r5 §3.4/§7.2 SSE measured)', () => {
  const sample = {
    id: '01a0b86f-04f9-72a8-bba4-75c5cfd6598f',
    todoId: 'todo_01',
    withPlan: false,
    prevPhase: 'todo',
    triggerSource: 'chief',
    planDocId: null,
    errorMessage: null,
    prUrl: null,
    prNumber: null,
    diffHash: null,
    createdAt: 1758531000000,
  };

  it('parses the observed doc', () => {
    expect(buildRecordSchema.parse(sample)).toEqual(sample);
  });

  it('accepts the three observed triggerSource values, rejects others', () => {
    for (const triggerSource of ['user', 'chief', 'schedule'] as const) {
      expect(buildRecordSchema.safeParse({ ...sample, triggerSource }).success).toBe(true);
    }
    expect(buildRecordSchema.safeParse({ ...sample, triggerSource: 'timer' }).success).toBe(false);
  });

  it('errorMessage carries "Cancelled" on scheduled re-run (r5 §7.2)', () => {
    expect(buildRecordSchema.safeParse({ ...sample, errorMessage: 'Cancelled' }).success).toBe(
      true,
    );
  });

  it('start body = {todoIds[], assignment, withPlan} (r5 §3.4 capture)', () => {
    expect(
      startBuildsBodySchema.parse({
        todoIds: ['todo_01'],
        assignment: { build: { agentId: 'a1' }, plan: { agentId: 'a2' } },
        withPlan: true,
      }),
    ).toMatchObject({ todoIds: ['todo_01'], withPlan: true });
  });

  it('merge responds 202 {"delegated":true} (r3 §3.6)', () => {
    expect(mergeAcceptedResponseSchema.parse({ delegated: true })).toEqual({ delegated: true });
    expect(mergeAcceptedResponseSchema.safeParse({ delegated: false }).success).toBe(false);
  });
});

describe('steps action body (02 §4.2 confirm loop, r5 §4 capture)', () => {
  it('parses the revision (rejection) body verbatim', () => {
    expect(
      buildStepActionBodySchema.parse({
        action: 'revision',
        side: 'plan',
        feedback: '后缀不要重复项目名',
        clientMessageId: '01a0c86f-c1fb-7171-9666-64a3db176b5b',
      }),
    ).toMatchObject({ action: 'revision', side: 'plan' });
  });

  it('parses the confirm body', () => {
    expect(buildStepActionBodySchema.parse({ action: 'confirm' })).toEqual({ action: 'confirm' });
  });

  it('rejects unknown actions', () => {
    expect(buildStepActionBodySchema.safeParse({ action: 'approve' }).success).toBe(false);
  });
});

describe('schedule record (r3 §8.3 measured verbatim)', () => {
  const sample = {
    id: 'sch_01',
    teamId: 'BoZYfvqKSGanlxsXVbXSa',
    projectId: 'prj_r3',
    todoId: 'todo_01',
    kind: 'once',
    at: 1758263400000,
    tz: 'Asia/Shanghai',
    nextRunAt: 1758263400000,
    createdBy: 'usr_mon',
    todo: {
      seqNum: 1,
      title: 'r3 lifecycle probe',
      phase: 'done',
      projectName: 'r3-lifecycle',
      ownerId: 'usr_mon',
    },
  };

  it('parses the observed once record', () => {
    expect(scheduleRecordSchema.parse(sample)).toEqual(sample);
  });

  it('accepts the [inferred] recurring kinds (02 §6.2 candidates hourly/daily/weekly)', () => {
    for (const kind of ['hourly', 'daily', 'weekly'] as const) {
      expect(scheduleRecordSchema.safeParse({ ...sample, kind }).success).toBe(true);
    }
    expect(scheduleRecordSchema.safeParse({ ...sample, kind: 'minutely' }).success).toBe(false);
  });
});

describe('provider record (r3 §2 measured verbatim, key masked)', () => {
  const sample = {
    kind: 'custom',
    providerId: 'r3-gw',
    label: 'r3-gw',
    baseUrl: 'http://203.0.113.7:3000',
    api: 'anthropic-messages',
    authHeader: true,
    compat: { supportsDeveloperRole: false },
    models: [{ id: 'claude-sonnet-5', name: 'claude-sonnet-5' }],
    id: 'prov_01',
    createdBy: 'usr_mon',
    createdAt: 1758260000000,
    updatedAt: 1758260000000,
  };

  it('parses the observed custom record', () => {
    expect(providerRecordSchema.parse(sample)).toEqual(sample);
  });

  it('keeps optional per-model contextWindow/maxTokens (#1526) and rejects non-positive values', () => {
    const declared = {
      ...sample,
      models: [{ id: 'glm-5.3', name: 'glm-5.3', contextWindow: 1_000_000, maxTokens: 32_768 }],
    };
    expect(providerRecordSchema.parse(declared)).toEqual(declared);
    expect(
      providerRecordSchema.safeParse({
        ...sample,
        models: [{ id: 'm', name: 'm', contextWindow: 0 }],
      }).success,
    ).toBe(false);
  });

  it('keeps optional per-model input capability (#1671) and rejects empty or unknown values', () => {
    const declared = {
      ...sample,
      models: [{ id: 'glm-5v', name: 'glm-5v', input: ['text', 'image'] }],
    };
    expect(providerRecordSchema.parse(declared)).toEqual(declared);
    expect(
      providerRecordSchema.safeParse({
        ...sample,
        models: [{ id: 'm', name: 'm', input: [] }],
      }).success,
    ).toBe(false);
    expect(
      providerRecordSchema.safeParse({
        ...sample,
        models: [{ id: 'm', name: 'm', input: ['text', 'video'] }],
      }).success,
    ).toBe(false);
  });

  it('never models apiKey -- write-only (02 §8/r3 §2)', () => {
    const shape = providerRecordSchema.shape;
    expect('apiKey' in shape).toBe(false);
  });

  it('preset catalog is the 38-item r3 §2 list with oauth only on the two subscription items', () => {
    expect(PROVIDER_PRESET_IDS).toHaveLength(38);
    expect(PROVIDER_PRESET_IDS).toContain('github-copilot');
    expect(PROVIDER_PRESET_IDS).toContain('openai-codex');
    expect(PROVIDER_PRESET_IDS).toContain('xai');
  });
});

describe('mcp-server record (r3 §5.1 measured verbatim)', () => {
  it('parses the observed record', () => {
    const sample = {
      teamId: 'BoZYfvqKSGanlxsXVbXSa',
      label: 'r3mcp',
      slug: 'r3mcp',
      transport: 'http',
      url: 'https://mcp.example.com/mcp',
      hasCredential: false,
      credentialKeys: [],
      createdBy: 'usr_mon',
      id: 'mcp_01',
      createdAt: 1758260000000,
      updatedAt: 1758260000000,
    };
    expect(mcpServerRecordSchema.parse(sample)).toEqual(sample);
    expect(mcpServerRecordSchema.safeParse({ ...sample, transport: 'sse' }).success).toBe(false);
  });
});

describe('agent record (r3 §4 measured verbatim)', () => {
  const sample = {
    id: 'TVv0DxUu3jTIhYpeWh6mn',
    displayName: 'r3-builder',
    description: '负责代码实现与工程修改',
    status: 'active',
    avatarUrl: null,
    provider: 'r3-gw',
    modelId: 'claude-sonnet-5',
    thinkingLevel: null,
    tools: [],
    secrets: [],
    defaultSkill: null,
    skillsAllowlist: null,
    mcpServers: [],
  };

  it('parses the observed record', () => {
    expect(agentRecordSchema.parse(sample)).toEqual(sample);
  });

  it('rejects unobserved status values ([inferred] note guards the enum)', () => {
    expect(agentRecordSchema.safeParse({ ...sample, status: 'archived' }).success).toBe(false);
  });

  it('skillsAllowlist three states: null (no restriction) / [] (explicit deny-all) / subset, none collapsing into another', () => {
    expect(
      agentRecordSchema.parse({ ...sample, skillsAllowlist: null }).skillsAllowlist,
    ).toBeNull();
    expect(agentRecordSchema.parse({ ...sample, skillsAllowlist: [] }).skillsAllowlist).toEqual([]);
    expect(
      agentRecordSchema.parse({ ...sample, skillsAllowlist: ['deploy'] }).skillsAllowlist,
    ).toEqual(['deploy']);
  });

  it('defaultSkill single-value slot: string and null pass; arrays (even single-element) rejected', () => {
    expect(agentRecordSchema.parse({ ...sample, defaultSkill: 'deploy' }).defaultSkill).toBe(
      'deploy',
    );
    expect(agentRecordSchema.parse({ ...sample, defaultSkill: null }).defaultSkill).toBeNull();
    expect(agentRecordSchema.safeParse({ ...sample, defaultSkill: [] }).success).toBe(false);
    expect(agentRecordSchema.safeParse({ ...sample, defaultSkill: ['deploy'] }).success).toBe(
      false,
    );
  });

  it('old skills field retired: schema has no such slot (same-name migration on read/write surfaces, no compatibility residue)', () => {
    expect('skills' in agentRecordSchema.shape).toBe(false);
    expect('defaultSkill' in agentRecordSchema.shape).toBe(true);
    expect('skillsAllowlist' in agentRecordSchema.shape).toBe(true);
  });
});

describe('agent permission-toggle vocabulary', () => {
  it('toggle vocabulary keeps the five remaining switches', () => {
    expect([...AGENT_TOOL_SWITCHES]).toEqual([
      '合并分支',
      '创建标签',
      '推送分支',
      '创建技能',
      '更新技能',
    ]);
    expect(Object.keys(AGENT_TOOL_COPY)).toEqual([...AGENT_TOOL_SWITCHES]);
  });

  it('filterAgentTools: in-vocabulary kept all + order preserved; out-of-vocabulary (custom tiers) silently dropped', () => {
    expect(
      filterAgentTools(['推送分支', '远程 shell', '合并分支', '创建标签', '自造档', '更新技能']),
    ).toEqual(['推送分支', '合并分支', '创建标签', '更新技能']);
    expect(filterAgentTools([])).toEqual([]);
  });

  it('new default set = [push branch] (delivery unbroken; merge/four no-ontology tiers off by default)', () => {
    expect([...AGENT_TOOL_DEFAULTS]).toEqual(['推送分支']);
  });

  it('read side lenient: in-vocabulary values in existing rows still parse (retirement enforced on the write side, read side does not blow up)', () => {
    const row = {
      id: 'xmon84-legacy',
      displayName: 'legacy-agent',
      description: '',
      status: 'active',
      avatarUrl: null,
      provider: 'p',
      modelId: 'm',
      thinkingLevel: null,
      tools: ['远程 shell'],
      secrets: [],
      defaultSkill: null,
      skillsAllowlist: null,
      mcpServers: [],
    };
    expect(agentRecordSchema.parse(row).tools).toEqual(['远程 shell']);
  });
});

describe('notification (02 §9.1, r5 §7.2 measured override)', () => {
  const sample = {
    teamId: 'BoZYfvqKSGanlxsXVbXSa',
    userId: 'usr_mon',
    type: 'build_review',
    entityId: 'todo_01',
    entityRef: { title: 'r3 lifecycle probe', projectId: 'prj_r3', seqNum: 1 },
    agent: { name: 'r3-builder', avatarUrl: null },
    snippet: null,
    id: 'usr_mon:todo_01',
    readAt: null,
    createdAt: 1758531600000,
    channels: ['in_app'],
  };

  it('parses the observed in-app event record', () => {
    expect(notificationRecordSchema.parse(sample)).toEqual(sample);
  });

  it('accepts chief_message with snippet = full message text', () => {
    expect(
      notificationRecordSchema.safeParse({
        ...sample,
        type: 'chief_message',
        entityId: 'chief-01a0c86f-c1fb-7171-9666-64a3db176b5b',
        entityRef: { title: '编写 CONTRIBUTING.md…', projectId: null, seqNum: null },
        snippet: '已创建并派工 #11 …',
      }).success,
    ).toBe(true);
  });

  it('rejects types outside the three-event matrix (done/failed have no in-app events)', () => {
    expect(notificationRecordSchema.safeParse({ ...sample, type: 'build_done' }).success).toBe(
      false,
    );
    expect(notificationRecordSchema.safeParse({ ...sample, type: 'build_failed' }).success).toBe(
      false,
    );
  });

  it('channels always ["in_app"] (r5 §7.2 measured + R1 divergence 04 §5)', () => {
    expect(notificationRecordSchema.safeParse({ ...sample, channels: ['web_push'] }).success).toBe(
      false,
    );
  });

  it('unread response = {unreadThreadIds} (02 §9.1)', () => {
    expect(notificationsResponseSchema.parse({ unreadThreadIds: ['t1'] })).toEqual({
      unreadThreadIds: ['t1'],
    });
  });
});

describe('agent memory (02 §4.4, r5 §6 measured override)', () => {
  it('parses the observed entry with three-level provenance', () => {
    const sample = {
      id: 'mem_01',
      agentId: 'SPn3bR8GalngsJm1ge-Sh',
      teamId: 'BoZYfvqKSGanlxsXVbXSa',
      title: 'r3-lifecycle README 只在末尾追加小节，文件引用用相对链接',
      content: 'r3-lifecycle 的 README.md 约定：新增说明一律在文件末尾追加二级标题小节…',
      projectId: 'prj_r3',
      sourceTodoId: 'todo_13',
      sourceBuildId: '01a0c87a-0000-7000-8000-000000000000',
      createdAt: 1758535340000,
      updatedAt: 1758535340000,
    };
    expect(memoryRecordSchema.parse(sample)).toEqual(sample);
  });
});

describe('chief (02 §4.3, r5 §2/§3 measured)', () => {
  it('parses the thread record verbatim (r5 §3.6)', () => {
    const sample = {
      id: 'chief-01a0c86f-c1fb-7171-9666-64a3db176b5b',
      chiefId: 'chief-usr_mon-BoZYfvqKSGanlxsXVbXSa',
      userId: 'usr_mon',
      teamId: 'BoZYfvqKSGanlxsXVbXSa',
      title: '帮 r3-lifecycle 写一份 CONTRIBUTING.md…',
      createdAt: 1758531000000,
      updatedAt: 1758532000000,
      lastTurnAt: 1758532000000,
      session: { runtime: 'pi', id: 'sess_01', openedAt: 1758531000000 },
      pendingSessionResumeAt: null,
      toolDefHashes: { projects: 'h1', todos: 'h2' },
      toolResultHashes: {},
      activeRun: null,
    };
    expect(chiefThreadSchema.parse(sample)).toEqual(sample);
    expect(
      chiefThreadSchema.safeParse({ ...sample, session: { ...sample.session, runtime: 'other' } })
        .success,
    ).toBe(false);
  });

  it('parses the chief GET response envelope with watch entry (r5 §3.5/§3.6)', () => {
    const sample = {
      chief: {
        id: 'chief-usr_mon-BoZYfvqKSGanlxsXVbXSa',
        userId: 'usr_mon',
        teamId: 'BoZYfvqKSGanlxsXVbXSa',
        agent: { agentId: 'TVv0DxUu3jTIhYpeWh6mn' },
        charter: null,
        lastTurnAt: 1758532000000,
        createdAt: 1758531000000,
      },
      agentActor: null,
      context: { tokens: 27065, contextWindow: 128000 },
      watches: [
        {
          todoId: 'todo_11',
          projectId: 'prj_r3',
          seqNum: 11,
          title: '编写 CONTRIBUTING.md 贡献指南',
          projectName: 'r3-lifecycle',
          phase: 'building',
          reason: 'Dispatched by the chief: report back when it parks at a gate or settles.',
          createdAt: 1758531000000,
          threadId: 'chief-01a0c86f-c1fb-7171-9666-64a3db176b5b',
          threadTitle: '帮 r3-lifecycle 写一份 CONTRIBUTING.md…',
        },
      ],
      wakes: [],
    };
    expect(chiefGetResponseSchema.parse(sample)).toEqual(sample);
  });

  it('parses the chief GET envelope with the orchestration block (#895; #1260 homeMachineId source switch)', () => {
    const sample = {
      chief: {
        id: 'chief-usr_mon-BoZYfvqKSGanlxsXVbXSa',
        userId: 'usr_mon',
        teamId: 'BoZYfvqKSGanlxsXVbXSa',
        agent: { agentId: 'TVv0DxUu3jTIhYpeWh6mn' },
        charter: null,
        lastTurnAt: 1758532000000,
        createdAt: 1758531000000,
      },
      agentActor: null,
      context: null,
      watches: [],
      wakes: [],
      orchestration: {
        homeMachineId: 'mach_895',
        activity: [{ machineId: 'mach_895', running: 1, waiting: 0 }],
      },
    };
    expect(chiefGetResponseSchema.parse(sample)).toEqual(sample);
  });

  it('parses the PATCH chief body verbatim (r5 §2 capture; from #1260 thinkingLevel override keys stripped)', () => {
    expect(
      patchChiefBodySchema.parse({
        agent: { agentId: 'TVv0DxUu3jTIhYpeWh6mn', thinkingLevel: null },
      }),
    ).toEqual({ agent: { agentId: 'TVv0DxUu3jTIhYpeWh6mn' } });
  });

  it('PATCH chief body retired slots (#1260): machineId/model/compactionModel stripped; a body with only retired slots is rejected by refine', () => {
    expect(patchChiefBodySchema.parse({ charter: '常设指示' })).toEqual({ charter: '常设指示' });
    expect(
      patchChiefBodySchema.parse({
        charter: 'x',
        machineId: 'm-1',
        model: { provider: 'pi', modelId: 'm' },
      }),
    ).toEqual({ charter: 'x' });
    expect(patchChiefBodySchema.safeParse({ machineId: 'm-1' }).success).toBe(false);
    expect(patchChiefBodySchema.safeParse({ compactionModel: null }).success).toBe(false);
    expect(patchChiefBodySchema.safeParse({}).success).toBe(false);
  });
});

describe('team record (r2 §1.5 teams-v1 cache measured values)', () => {
  it('parses with plan field kept (02 §2.4/A3: shape kept, never gates)', () => {
    const sample = {
      id: 'BoZYfvqKSGanlxsXVbXSa',
      name: "Xmon Dai's team",
      createdAt: 1758000000000,
      plan: 'free',
      avatarStyle: 'notionist',
    };
    expect(teamRecordSchema.parse(sample)).toEqual(sample);
  });

  it('member rows accept the embedded actor full record (r5 §1: agent list goes through members)', () => {
    const agentRow = {
      id: 'mem_01',
      teamId: 'BoZYfvqKSGanlxsXVbXSa',
      actorId: 'TVv0DxUu3jTIhYpeWh6mn',
      memberType: 'agent',
      actor: {
        id: 'TVv0DxUu3jTIhYpeWh6mn',
        displayName: 'r3-builder',
        description: null,
        status: 'active',
        avatarUrl: null,
        provider: 'r3-gw',
        modelId: 'claude-sonnet-5',
        thinkingLevel: null,
        tools: [],
        secrets: [],
        defaultSkill: null,
        skillsAllowlist: null,
        mcpServers: [],
        activeTaskCount: 1,
      },
    };
    const parsed = teamMemberSchema.parse(agentRow);
    expect(parsed).toEqual(agentRow);
    expect(teamMemberSchema.safeParse({ ...agentRow, memberType: 'bot' }).success).toBe(false);
  });
});

describe('daemon local state files (02 §5.3, r3 §1.3 measured)', () => {
  it('machine.json = {machineId, token(64hex), teamId, serverUrl}', () => {
    const sample = {
      machineId: 'TlZ2sSD4EJCxjNJqVhdo_',
      token: 'a'.repeat(64),
      teamId: 'BoZYfvqKSGanlxsXVbXSa',
      serverUrl: 'https://todos.dev',
    };
    expect(machineJsonSchema.parse(sample)).toEqual(sample);
    expect(machineJsonSchema.safeParse({ ...sample, token: 'a'.repeat(63) }).success).toBe(false);
  });

  it('device.json = {deviceId(32hex)}', () => {
    expect(deviceJsonSchema.parse({ deviceId: 'b'.repeat(32) })).toEqual({
      deviceId: 'b'.repeat(32),
    });
    expect(deviceJsonSchema.safeParse({ deviceId: 'b'.repeat(31) }).success).toBe(false);
  });

  it('daemon.json = {pid, startedAt, runner:"cli"}', () => {
    expect(daemonJsonSchema.parse({ pid: 4242, startedAt: 1758531000000, runner: 'cli' })).toEqual({
      pid: 4242,
      startedAt: 1758531000000,
      runner: 'cli',
    });
  });
});

describe('team stream SSE events (02 §1.2, r5 §7.2 measured extension)', () => {
  const todoDoc = todoRecordSchema.parse({
    id: 'todo_01',
    teamId: 't',
    projectId: 'p',
    title: 'x',
    spec: '',
    phase: 'todo',
    phaseAt: 0,
    seqNum: 1,
    orderIndex: 0,
    tagIds: [],
    assignment: null,
    agent: null,
    latestBuildId: null,
    lastRunAt: null,
    hasChanges: false,
    hasPlan: false,
    buildHistory: [],
    sourceTodo: null,
    v: 2,
    createdBy: null,
    ownerId: 'usr_mon',
    sourceBuildId: null,
    sourceKind: null,
    sourceRef: null,
  });

  it('parses the ~15s ping heartbeat', () => {
    expect(teamStreamEventSchema.parse({ type: 'ping', seq: 16 })).toEqual({
      type: 'ping',
      seq: 16,
    });
  });

  it('parses machine_presence', () => {
    expect(
      teamStreamEventSchema.parse({
        type: 'machine_presence',
        machineId: 'TlZ2sSD4EJCxjNJqVhdo_',
        online: true,
      }),
    ).toMatchObject({ type: 'machine_presence', online: true });
  });

  it('parses todo/build full-document events with seq/v', () => {
    expect(teamStreamEventSchema.parse({ type: 'todo', seq: 6, v: 3, doc: todoDoc })).toMatchObject(
      { type: 'todo', seq: 6, v: 3 },
    );
  });

  it('parses the notification envelope {type:"notification", notification:{…}}', () => {
    expect(
      teamStreamEventSchema.parse({
        type: 'notification',
        notification: {
          teamId: 't',
          userId: 'usr_mon',
          type: 'plan_ready',
          entityId: 'todo_01',
          entityRef: { title: 'x', projectId: 'p', seqNum: 1 },
          agent: { name: 'r3-builder', avatarUrl: null },
          snippet: null,
          id: 'usr_mon:todo_01',
          readAt: null,
          createdAt: 0,
          channels: ['in_app'],
        },
      }),
    ).toMatchObject({ type: 'notification' });
  });
});

describe('search response (02 §6.3 [design] self-set wire)', () => {
  it('parses the three-bucket shape verbatim', () => {
    expect(
      searchResponseSchema.parse({
        todos: [{ id: 't1', seqNum: 1, title: 'x', phase: 'todo', phaseAt: 1, projectName: 'p' }],
        projects: [{ id: 'p', name: 'p' }],
        agents: [{ id: 'a', displayName: 'r3-builder' }],
      }),
    ).toMatchObject({ projects: [{ id: 'p', name: 'p' }] });
  });
});

describe('chiefThreadTitle (#757: attachment token lines never bare paths)', () => {
  it('plain-text first sentence truncated as before', () => {
    expect(chiefThreadTitle('帮 r3-lifecycle 写一份构建文档吧')).toBe('帮 r3-lifecyc…');
  });

  it('when the first line is an attachment token line, the first body line after it is used', () => {
    expect(
      chiefThreadTitle('![pasted-image-1.png](attachment:team-1/att-1.png)\n看看这个报错'),
    ).toBe('看看这个报错');
  });

  it("all-token lines take the first token's file name (same 12-char truncation rule)", () => {
    expect(chiefThreadTitle('![pasted-image-1.png](attachment:team-1/att-1.png)')).toBe(
      'pasted-image…',
    );
  });

  it('inline tokens keep only the file name (still subject to 12-char truncation)', () => {
    expect(chiefThreadTitle('看这个 ![a.png](attachment:t/i.png) 很重要')).toBe(
      '看这个 a.png 很重…',
    );
  });
});
