// 词表 schema 快照测试（01 §7.4 验收要点 4 / 04 §3：shared 词表 schema 快照
// vs 02 §5/§6 表，自动化进 CI）。快照文件 = 协议面的冻结镜像：任何词表/形状
// 改动都会在这里显形，改动必须是有意的（并同步回写 02 §11 / 对应票）。

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  apiKeyRowSchema,
  // phase/品牌/表清单
  BOARD_COLUMNS,
  BRAND,
  BRAND_SLOTS,
  // request/response body schemas
  buildStepActionBodySchema,
  // executor/machine 词表
  CLI_COMMANDS,
  CLI_START_OPTIONS,
  CONFIG_KINDS,
  // AgentBackend 缝（01 §5）+ 机器面 wire（02 §5）
  claimedStepSchema,
  conversationMessagesResponseSchema,
  conversationStreamEventSchema,
  createProjectBodySchema,
  createScheduleBodySchema,
  createTodoBodySchema,
  DAEMON_LOG_PREFIXES,
  DB_TABLES,
  // web 词表
  DELETE_FACE,
  daemonJsonSchema,
  deviceJsonSchema,
  ENV_VARS,
  githubConnectionStatusSchema,
  githubReposResponseSchema,
  LOCAL_STATE_DIRS,
  LOCAL_STATE_FILES,
  LOCAL_STORAGE_KEYS,
  MACHINE_CUSTOM_TOOLS,
  MACHINE_ENDPOINTS,
  MACHINE_WIRE,
  MCP_CAPABILITY_GROUPS,
  MCP_TOOLS_READ,
  MCP_TOOLS_WRITE,
  machineClaimBodySchema,
  machineClaimResponseSchema,
  machineDoneBodySchema,
  machineEnrollBodySchema,
  machineEnrollResponseSchema,
  machineJsonSchema,
  machinePresenceBodySchema,
  machineRecoverResponseSchema,
  machineStreamEventSchema,
  machineThinkingDeltaBodySchema,
  machineTokenResponseSchema,
  machineToolBodySchema,
  machineTranscriptDeltaBodySchema,
  machineUploadUrlsBodySchema,
  machineUploadUrlsResponseSchema,
  mergeAcceptedResponseSchema,
  NON_REPLICATED_ENDPOINTS,
  notificationsResponseSchema,
  ONLINE_SEQUENCE_CANON,
  PHASE_SEMANTICS,
  PHASE_VALUES,
  PI_STREAM_EVENTS,
  PROVIDER_COMMAND_NOTICE,
  PROVIDER_PRESET_IDS,
  PROXY_ENV_VARS,
  PROXY_PROBE_LOG_CANON,
  patchChiefBodySchema,
  planRowSchema,
  projectBranchesResponseSchema,
  projectFileResponseSchema,
  projectTreeResponseSchema,
  // record 24 表投影
  RECORD_SCHEMAS,
  RELAY_TOOLS,
  SSE_CHANNELS,
  STEP_LIFECYCLE_LOG_LINES,
  STREAM_TIMEOUTS_MS,
  searchResponseSchema,
  setSecretBodySchema,
  startBuildsBodySchema,
  stepEventSchema,
  stepJournalRowSchema,
  THIRD_PARTY_CLIENT_KEYS,
  teamStreamEventSchema,
  transcriptUploadSchema,
  WEB_FETCH_CHAR_LIMIT,
  WEB_REST_ENDPOINTS,
  WORKTREE_CONTRACT,
} from '../src/index.js';

describe('record 形状 24 表投影——zod → JSON Schema 快照', () => {
  for (const [table, schema] of Object.entries(RECORD_SCHEMAS)) {
    it(`${table}`, () => {
      expect(z.toJSONSchema(schema)).toMatchSnapshot(`${table}.json`);
    });
  }
});

describe('body/封套 schema 快照', () => {
  const bodies = {
    createTodoBody: createTodoBodySchema,
    createScheduleBody: createScheduleBodySchema,
    // spec 12 / #359：POST /api/projects body 单源（kind/repoKind 双名 +
    // localPath + githubRepo 双面）+ repo picker 封套。
    createProjectBody: createProjectBodySchema,
    githubReposResponse: githubReposResponseSchema,
    // #361 G2-T4：GitHub 连接认证状态读面封套（login/scope，无 token 位）。
    githubConnectionStatus: githubConnectionStatusSchema,
    projectTreeResponse: projectTreeResponseSchema,
    projectFileResponse: projectFileResponseSchema,
    projectBranchesResponse: projectBranchesResponseSchema,
    startBuildsBody: startBuildsBodySchema,
    mergeAcceptedResponse: mergeAcceptedResponseSchema,
    buildStepActionBody: buildStepActionBodySchema,
    patchChiefBody: patchChiefBodySchema,
    conversationMessagesResponse: conversationMessagesResponseSchema,
    notificationsResponse: notificationsResponseSchema,
    searchResponse: searchResponseSchema,
    setSecretBody: setSecretBodySchema,
    teamStreamEvent: teamStreamEventSchema,
    conversationStreamEvent: conversationStreamEventSchema,
    // M5 [推断] 读面行形（双端单源，wire.test INFERRED_ROUTES 登记族）
    planRow: planRowSchema,
    stepJournalRow: stepJournalRowSchema,
    apiKeyRow: apiKeyRowSchema,
    machineJson: machineJsonSchema,
    deviceJson: deviceJsonSchema,
    daemonJson: daemonJsonSchema,
  } as const;

  for (const [name, schema] of Object.entries(bodies)) {
    it(`${name}`, () => {
      expect(z.toJSONSchema(schema)).toMatchSnapshot(`${name}.json`);
    });
  }
});

describe('AgentBackend 缝 + 机器面 wire schema 快照（01 §5 / 02 §5 canonical）', () => {
  it('stepEvent = 02 §5.6 pi 词表会话内 15 件 1:1（01 §5 锁定）', () => {
    expect(z.toJSONSchema(stepEventSchema)).toMatchSnapshot('stepEvent.json');
  });

  it('机器面 13 端点动词 + 路径（MACHINE_WIRE，动词 [推断] 登记面）', () => {
    expect(MACHINE_WIRE.map(({ method, path }) => `${method} ${path}`)).toMatchSnapshot();
  });

  const machineBodies = {
    claimedStep: claimedStepSchema,
    machineClaimBody: machineClaimBodySchema,
    machineClaimResponse: machineClaimResponseSchema,
    machineDoneBody: machineDoneBodySchema,
    machineEnrollBody: machineEnrollBodySchema,
    machineEnrollResponse: machineEnrollResponseSchema,
    machinePresenceBody: machinePresenceBodySchema,
    machineRecoverResponse: machineRecoverResponseSchema,
    machineStreamEvent: machineStreamEventSchema,
    machineToolBody: machineToolBodySchema,
    machineThinkingDeltaBody: machineThinkingDeltaBodySchema,
    machineTranscriptDeltaBody: machineTranscriptDeltaBodySchema,
    machineTokenResponse: machineTokenResponseSchema,
    machineUploadUrlsBody: machineUploadUrlsBodySchema,
    machineUploadUrlsResponse: machineUploadUrlsResponseSchema,
    transcriptUpload: transcriptUploadSchema,
  } as const;

  for (const [name, schema] of Object.entries(machineBodies)) {
    it(`${name}`, () => {
      expect(z.toJSONSchema(schema)).toMatchSnapshot(`${name}.json`);
    });
  }
});

describe('协议词表快照（02 §5/§6 canonical）', () => {
  it('web REST 端点词表（02 §6.1）', () => {
    expect(WEB_REST_ENDPOINTS).toMatchSnapshot();
  });

  it('DELETE 面规则（[推断]，02 §6.1）与 divergence 登记', () => {
    expect({ DELETE_FACE, NON_REPLICATED_ENDPOINTS }).toMatchSnapshot();
  });

  it('机器面 13 端点（02 §5/r3 §1.6）', () => {
    expect(MACHINE_ENDPOINTS).toMatchSnapshot();
  });

  it('SSE 三通道（02 §1.2）', () => {
    expect(SSE_CHANNELS).toMatchSnapshot();
  });

  it('executor CLI 面（02 §5.1）', () => {
    expect({
      CLI_COMMANDS,
      CLI_START_OPTIONS,
      ENV_VARS,
      PROVIDER_COMMAND_NOTICE,
    }).toMatchSnapshot();
  });

  it('本地状态布局与日志前缀（02 §5.3）', () => {
    expect({ LOCAL_STATE_FILES, LOCAL_STATE_DIRS, DAEMON_LOG_PREFIXES }).toMatchSnapshot();
  });

  it('worktree 契约（02 §5.5）', () => {
    expect(WORKTREE_CONTRACT).toMatchSnapshot();
  });

  it('pi 流事件/配置 kind/流超时/机器工具/代理探测（02 §5.6）', () => {
    expect({
      PI_STREAM_EVENTS,
      CONFIG_KINDS,
      STREAM_TIMEOUTS_MS,
      MACHINE_CUSTOM_TOOLS,
      WEB_FETCH_CHAR_LIMIT,
      RELAY_TOOLS,
      PROXY_ENV_VARS,
      PROXY_PROBE_LOG_CANON,
    }).toMatchSnapshot();
  });

  it('步骤生命周期行序（02 §5.7）与上线序列 canon（02 §5.4）', () => {
    expect({ STEP_LIFECYCLE_LOG_LINES, ONLINE_SEQUENCE_CANON }).toMatchSnapshot();
  });

  it('MCP server 面 24 工具白名单 + 能力六组（02 §7.2）', () => {
    expect({ MCP_TOOLS_READ, MCP_TOOLS_WRITE, MCP_CAPABILITY_GROUPS }).toMatchSnapshot();
  });

  it('provider presets 38 项目录（r3 §2/02 §6.2）', () => {
    expect(PROVIDER_PRESET_IDS).toMatchSnapshot();
  });

  it('localStorage 键名契约（02 §6.4/r2 §1.5）', () => {
    expect({ LOCAL_STORAGE_KEYS, THIRD_PARTY_CLIENT_KEYS }).toMatchSnapshot();
  });

  it('phase 九值 + 看板列 + 语义（02 §4.1）', () => {
    expect({ PHASE_VALUES, PHASE_SEMANTICS, BOARD_COLUMNS }).toMatchSnapshot();
  });

  it('品牌串命名常量表（02 §5.8 + 素材替换计划 §2）', () => {
    expect({ BRAND_SLOTS, BRAND }).toMatchSnapshot();
  });

  it('存储表清单（01 §6）', () => {
    expect(DB_TABLES).toMatchSnapshot();
  });
});
