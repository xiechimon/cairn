// Record-schema seam: every schema must accept the verbatim wire samples
// observed in the research canon (r3/r5/r2 as cited per case) and reject
// values outside the canonical vocabulary. Sample values are the real
// observed ones (team BoZYfvqKSGanlxsXVbXSa, machine TlZ2sSD4EJCxjNJqVhdo_,
// conv 01a0b86f-…, gateway r3-gw) with credentials形态-only per r3 §0 hygiene.

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
  chiefRecordSchema,
  chiefThreadSchema,
  chiefThreadTitle,
  createTodoBodySchema,
  daemonJsonSchema,
  deviceJsonSchema,
  filterAgentTools,
  githubIssueSourceRef,
  type ModelSource,
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
  resolveChiefModelFallback,
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
  };

  it('parses the full observed field set', () => {
    expect(todoRecordSchema.parse(sample)).toEqual(sample);
  });

  it('来源两列（#446 / ADR 0005 D6）：github-issue + 引用串过闸，未知种类拒', () => {
    const imported = {
      ...sample,
      sourceKind: 'github-issue',
      sourceRef: 'github:octo/alpha#7',
    };
    expect(todoRecordSchema.parse(imported)).toEqual(imported);
    expect(todoRecordSchema.safeParse({ ...sample, sourceKind: 'jira' }).success).toBe(false);
    expect(githubIssueSourceRef('octo', 'alpha', 7)).toBe('github:octo/alpha#7');
  });

  it('编排来源（#640 / r14 §5.3）：orchestration 过闸 + chief ref 严格互逆', () => {
    const dispatched = {
      ...sample,
      sourceKind: 'orchestration',
      sourceRef: 'chief:01a0b86f-04f9-72a8-bba4-75c5cfd6598f',
    };
    expect(todoRecordSchema.parse(dispatched)).toEqual(dispatched);
    // 单源格式：写入面 = chief 线程 id 剥前缀加 scheme；解析面严格互逆。
    expect(orchestrationSourceRef('chief-01a0b86f-04f9-72a8-bba4-75c5cfd6598f')).toBe(
      'chief:01a0b86f-04f9-72a8-bba4-75c5cfd6598f',
    );
    expect(parseOrchestrationSourceRef('chief:01a0b86f-04f9-72a8-bba4-75c5cfd6598f')).toEqual({
      threadId: 'chief-01a0b86f-04f9-72a8-bba4-75c5cfd6598f',
    });
    // 非 chief 线程 id 拒写（防裸 uuid / build id 混入格式位）。
    expect(() => orchestrationSourceRef('01a0b86f-04f9-72a8-bba4-75c5cfd6598f')).toThrow();
    // 畸形 ref 降级 null（scheme 错 / 空段），github 形不串档。
    expect(parseOrchestrationSourceRef('github:octo/alpha#7')).toBeNull();
    expect(parseOrchestrationSourceRef('chief:')).toBeNull();
  });

  it('rejects the作废 exec猜测 (r3 §3.0 正名 building)', () => {
    expect(todoRecordSchema.safeParse({ ...sample, phase: 'exec' }).success).toBe(false);
  });

  it('parses the create body verbatim (r3 §3.1 抓包 {title, spec})', () => {
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

describe('build record (02 §6.2, r5 §3.4/§7.2 SSE 实测)', () => {
  const sample = {
    id: '01a0b86f-04f9-72a8-bba4-75c5cfd6598f', // buildId ≡ conversationId (r3 §3.0)
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

  it('start body = {todoIds[], assignment, withPlan} (r5 §3.4 抓包)', () => {
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

describe('steps action body (02 §4.2 确认回路, r5 §4 抓包)', () => {
  it('parses the revision (驳回) body verbatim', () => {
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

describe('schedule record (r3 §8.3 实测原样)', () => {
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

  it('accepts the [推断] recurring kinds (02 §6.2 候选词 hourly/daily/weekly)', () => {
    for (const kind of ['hourly', 'daily', 'weekly'] as const) {
      expect(scheduleRecordSchema.safeParse({ ...sample, kind }).success).toBe(true);
    }
    expect(scheduleRecordSchema.safeParse({ ...sample, kind: 'minutely' }).success).toBe(false);
  });
});

describe('provider record (r3 §2 实测原样, key 打码)', () => {
  const sample = {
    kind: 'custom',
    providerId: 'r3-gw',
    label: 'r3-gw',
    baseUrl: 'http://100.65.44.76:3000',
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

  it('never models apiKey — 只写不读 (02 §8/r3 §2)', () => {
    const shape = providerRecordSchema.shape;
    expect('apiKey' in shape).toBe(false);
  });

  it('preset目录 is the 38-item r3 §2 list with oauth only on the two订阅项', () => {
    expect(PROVIDER_PRESET_IDS).toHaveLength(38);
    expect(PROVIDER_PRESET_IDS).toContain('github-copilot');
    expect(PROVIDER_PRESET_IDS).toContain('openai-codex');
    expect(PROVIDER_PRESET_IDS).toContain('xai');
  });
});

describe('mcp-server record (r3 §5.1 实测原样)', () => {
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

describe('agent record (r3 §4 实测原样)', () => {
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

  it('rejects unobserved status values ([推断] note guards the enum)', () => {
    expect(agentRecordSchema.safeParse({ ...sample, status: 'archived' }).success).toBe(false);
  });

  // #1169 拆字段失败方式（先于实现固化）：
  // 1. null 被读成全拒 → 「不限制」塌缩成「全拒」，新建 agent 出生即残废
  //    （本票主修位）。schema 两态都必须可承载：null/[]/子集三态不得混淆。
  // 2. 单值写进数组位 → defaultSkill 收到 ['x']，消费面 skills[0] 复活。
  // 3. 旧 skills 字段残留在 wire → 两消费面（概览 Select / deny 白名单）
  //    有一处还读旧名 = 拆字段不完整。
  it('skillsAllowlist 三态：null（不限制）/ []（显式全拒）/ 子集，互不塌缩', () => {
    expect(
      agentRecordSchema.parse({ ...sample, skillsAllowlist: null }).skillsAllowlist,
    ).toBeNull();
    expect(agentRecordSchema.parse({ ...sample, skillsAllowlist: [] }).skillsAllowlist).toEqual([]);
    expect(
      agentRecordSchema.parse({ ...sample, skillsAllowlist: ['deploy'] }).skillsAllowlist,
    ).toEqual(['deploy']);
  });

  it('defaultSkill 单值槽：string 与 null 过；数组（含单元素）拒', () => {
    expect(agentRecordSchema.parse({ ...sample, defaultSkill: 'deploy' }).defaultSkill).toBe(
      'deploy',
    );
    expect(agentRecordSchema.parse({ ...sample, defaultSkill: null }).defaultSkill).toBeNull();
    expect(agentRecordSchema.safeParse({ ...sample, defaultSkill: [] }).success).toBe(false);
    expect(agentRecordSchema.safeParse({ ...sample, defaultSkill: ['deploy'] }).success).toBe(
      false,
    );
  });

  it('旧 skills 字段下线：schema 无此槽（读写面同名迁移，无兼容残留）', () => {
    expect('skills' in agentRecordSchema.shape).toBe(false);
    expect('defaultSkill' in agentRecordSchema.shape).toBe(true);
    expect('skillsAllowlist' in agentRecordSchema.shape).toBe(true);
  });
});

describe('agent 权限开关词表（XMON-84 用户拍板 B：六档全保留）', () => {
  // 失败方式（先于实现固化）：
  // 1. 词表恢复不全（六档缺任一）→ UI 少摆开关，用户拍板 B 未被执行。
  // 2. AGENT_TOOL_COPY 键与词表脱钩 → 某档无副文案（渲染面 undefined）。
  // 3. filterAgentTools 误伤词表内值（如把恢复的四档也丢掉）→ 授权面静默失能。
  // 4. filterAgentTools 放行词表外值（自造档）→ 死存储永不清退。
  // 5. AGENT_TOOL_DEFAULTS 漏「推送分支」→ 新建 Agent 默认推不了工作分支
  //    （B4 不破坏交付判据）；混入「合并分支」→ 新建即可发布（越权）。

  it('开关词表 = 六档全保留（用户拍板 B；两执法档 + 四待本体档）', () => {
    expect([...AGENT_TOOL_SWITCHES]).toEqual([
      '远程 shell',
      '合并分支',
      '创建标签',
      '推送分支',
      '创建技能',
      '更新技能',
    ]);
    expect(Object.keys(AGENT_TOOL_COPY)).toEqual([...AGENT_TOOL_SWITCHES]);
  });

  it('filterAgentTools：词表内全保留 + 顺序保持，词表外（自造档）静默丢弃', () => {
    expect(
      filterAgentTools(['推送分支', '远程 shell', '合并分支', '创建标签', '自造档', '更新技能']),
    ).toEqual(['推送分支', '远程 shell', '合并分支', '创建标签', '更新技能']);
    expect(filterAgentTools([])).toEqual([]);
  });

  it('新建默认集 = [推送分支]（不破坏交付；合并/四无本体档不默认开）', () => {
    expect([...AGENT_TOOL_DEFAULTS]).toEqual(['推送分支']);
  });

  it('读侧宽：存量行的词表内值仍可 parse（清退走写侧过滤，不炸读面）', () => {
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

describe('notification (02 §9.1, r5 §7.2 实测改判)', () => {
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

  it('accepts chief_message with snippet = 消息全文', () => {
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

  it('rejects types outside the three-event matrix (done/failed 无 in-app 事件)', () => {
    expect(notificationRecordSchema.safeParse({ ...sample, type: 'build_done' }).success).toBe(
      false,
    );
    expect(notificationRecordSchema.safeParse({ ...sample, type: 'build_failed' }).success).toBe(
      false,
    );
  });

  it('channels 恒 ["in_app"] (r5 §7.2 实测 + R1 divergence 04 §5)', () => {
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

describe('agent memory (02 §4.4, r5 §6 实测改判)', () => {
  it('parses the observed entry with three-level溯源', () => {
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

describe('chief (02 §4.3, r5 §2/§3 实测)', () => {
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
    // r5 原样封套不带 orchestration（#895 加法契约：optional——老封套/老
    // web 忽略即退化现状，不以 fixture 补键糊成破坏性契约）。
    expect(chiefGetResponseSchema.parse(sample)).toEqual(sample);
  });

  it('parses the chief GET envelope with the orchestration block (#895)', () => {
    const sample = {
      chief: {
        id: 'chief-usr_mon-BoZYfvqKSGanlxsXVbXSa',
        userId: 'usr_mon',
        teamId: 'BoZYfvqKSGanlxsXVbXSa',
        agent: { agentId: 'TVv0DxUu3jTIhYpeWh6mn' },
        charter: null,
        machineId: 'mach_895',
        lastTurnAt: 1758532000000,
        createdAt: 1758531000000,
      },
      agentActor: null,
      context: null,
      watches: [],
      wakes: [],
      orchestration: {
        defaultMachineId: 'mach_895',
        activity: [{ machineId: 'mach_895', running: 1, waiting: 0 }],
      },
    };
    expect(chiefGetResponseSchema.parse(sample)).toEqual(sample);
  });

  it('parses the PATCH chief body verbatim (r5 §2 抓包)', () => {
    expect(
      patchChiefBodySchema.parse({
        agent: { agentId: 'TVv0DxUu3jTIhYpeWh6mn', thinkingLevel: null },
      }),
    ).toEqual({ agent: { agentId: 'TVv0DxUu3jTIhYpeWh6mn', thinkingLevel: null } });
  });

  it('PATCH chief body compactionModel 槽：对象/null 收，裸串/缺字段/空 body 拒（#203）', () => {
    // 对象往返（model id 只在 provider 内有意义——records/agent.ts provider+modelId
    // 同构——裸字符串跨 provider 撞名，故收对象形）。
    expect(
      patchChiefBodySchema.parse({ compactionModel: { provider: 'r3-gw', modelId: 'm-fast' } }),
    ).toEqual({ compactionModel: { provider: 'r3-gw', modelId: 'm-fast' } });
    // null = 清空（回默认「与 Chief 相同」）。
    expect(patchChiefBodySchema.parse({ compactionModel: null })).toEqual({
      compactionModel: null,
    });
    // 裸字符串拒。
    expect(patchChiefBodySchema.safeParse({ compactionModel: 'm-fast' }).success).toBe(false);
    // 缺 modelId 拒。
    expect(patchChiefBodySchema.safeParse({ compactionModel: { provider: 'r3-gw' } }).success).toBe(
      false,
    );
    // 三槽全缺仍被 refine 拒。
    expect(patchChiefBodySchema.safeParse({}).success).toBe(false);
  });

  it('chief record 回显 compactionModel（server 长槽 [设计]，null = 默认与 Chief 相同）', () => {
    const record = {
      id: 'chief-usr_mon-BoZYfvqKSGanlxsXVbXSa',
      userId: 'usr_mon',
      teamId: 'BoZYfvqKSGanlxsXVbXSa',
      agent: null,
      charter: null,
      lastTurnAt: null,
      createdAt: 1758531000000,
      compactionModel: { provider: 'r3-gw', modelId: 'm-fast' },
    };
    expect(chiefRecordSchema.parse(record)).toEqual(record);
    expect(chiefRecordSchema.parse({ ...record, compactionModel: null })).toEqual({
      ...record,
      compactionModel: null,
    });
  });

  it('收单回落判定 resolveChiefModelFallback（#774：一槽一判六态）', () => {
    const sources: ModelSource[] = [
      { runtime: 'pi', installed: true, hostname: 'h', models: [] },
      {
        runtime: 'claude-code',
        installed: true,
        hostname: 'h',
        models: [{ id: 'new-model', name: 'new-model', slot: 'default' }],
      },
    ];
    // F1 槽 null → 无动作。
    expect(resolveChiefModelFallback(null, sources)).toEqual({
      effective: null,
      fellBackFrom: null,
    });
    // F2 命中候选 → 保留。
    const hit = { provider: 'claude-code', modelId: 'new-model' };
    expect(resolveChiefModelFallback(hit, sources)).toEqual({
      effective: hit,
      fellBackFrom: null,
    });
    // F3 claude-code 旧 id → 愈合 null + 上报原值。
    const stale = { provider: 'claude-code', modelId: 'old-model' };
    expect(resolveChiefModelFallback(stale, sources)).toEqual({
      effective: null,
      fellBackFrom: stale,
    });
    // F4 custom provider 存量值（无对应段）→ 不动（候选面无权裁决）。
    const custom = { provider: 'my-relay', modelId: 'm-x' };
    expect(resolveChiefModelFallback(custom, sources)).toEqual({
      effective: custom,
      fellBackFrom: null,
    });
    // F5 provider 为 pi → 不动（picker 从无此行）。
    const pi = { provider: 'pi', modelId: 'm-x' };
    expect(resolveChiefModelFallback(pi, sources)).toEqual({
      effective: pi,
      fellBackFrom: null,
    });
    // F6 段缺席（settings.json 缺失态）→ 该段存量值照样 stale。
    expect(resolveChiefModelFallback(stale, [])).toEqual({
      effective: null,
      fellBackFrom: stale,
    });
  });
});

describe('team record (r2 §1.5 teams-v1 缓存实测值)', () => {
  it('parses with plan field保留 (02 §2.4/A3: shape kept, never gates)', () => {
    const sample = {
      id: 'BoZYfvqKSGanlxsXVbXSa',
      name: "Xmon Dai's team",
      createdAt: 1758000000000,
      plan: 'free',
      avatarStyle: 'notionist',
    };
    expect(teamRecordSchema.parse(sample)).toEqual(sample);
  });

  it('member rows accept the embedded actor full record (r5 §1: agent 列表走 members)', () => {
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
        activeTaskCount: 1, // r5 §1 实测增量字段
      },
    };
    const parsed = teamMemberSchema.parse(agentRow);
    expect(parsed).toEqual(agentRow); // loose：未采余量字段原样保留
    expect(teamMemberSchema.safeParse({ ...agentRow, memberType: 'bot' }).success).toBe(false);
  });
});

describe('daemon local state files (02 §5.3, r3 §1.3 实测)', () => {
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

describe('team stream SSE events (02 §1.2, r5 §7.2 实测扩充)', () => {
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

describe('search response (02 §6.3 [设计] 自设 wire)', () => {
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

describe('chiefThreadTitle (#757：附件 token 行不裸路径)', () => {
  it('纯文本首句照旧截断', () => {
    expect(chiefThreadTitle('帮 r3-lifecycle 写一份构建文档吧')).toBe('帮 r3-lifecyc…');
  });

  it('首行是附件 token 行时取其后首个正文行', () => {
    expect(
      chiefThreadTitle('![pasted-image-1.png](attachment:team-1/att-1.png)\n看看这个报错'),
    ).toBe('看看这个报错');
  });

  it('全是 token 行时取首个 token 的文件名（12 字同律截断）', () => {
    expect(chiefThreadTitle('![pasted-image-1.png](attachment:team-1/att-1.png)')).toBe(
      'pasted-image…',
    );
  });

  it('行中内联 token 只留文件名（仍受 12 字截断）', () => {
    expect(chiefThreadTitle('看这个 ![a.png](attachment:t/i.png) 很重要')).toBe(
      '看这个 a.png 很重…',
    );
  });
});
