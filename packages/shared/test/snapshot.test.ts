import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  apiKeyRowSchema,
  BOARD_COLUMNS,
  BRAND,
  BRAND_SLOTS,
  buildStepActionBodySchema,
  CLI_COMMANDS,
  CLI_START_OPTIONS,
  CONFIG_KINDS,
  claimedStepSchema,
  conversationMessagesResponseSchema,
  conversationStreamEventSchema,
  createProjectBodySchema,
  createScheduleBodySchema,
  createTodoBodySchema,
  DAEMON_LOG_PREFIXES,
  DB_TABLES,
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
  MERGE_BLOCKERS,
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

describe('record shapes, 24-table projection -- zod -> JSON Schema snapshot', () => {
  for (const [table, schema] of Object.entries(RECORD_SCHEMAS)) {
    it(`${table}`, () => {
      expect(z.toJSONSchema(schema)).toMatchSnapshot(`${table}.json`);
    });
  }
});

describe('body/envelope schema snapshots', () => {
  const bodies = {
    createTodoBody: createTodoBodySchema,
    createScheduleBody: createScheduleBodySchema,
    createProjectBody: createProjectBodySchema,
    githubReposResponse: githubReposResponseSchema,
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

describe('AgentBackend seam + machine-wire schema snapshot (01 §5 / 02 §5 canonical)', () => {
  it('stepEvent = 02 §5.6 pi vocabulary, 15 session events 1:1 (locked by 01 §5)', () => {
    expect(z.toJSONSchema(stepEventSchema)).toMatchSnapshot('stepEvent.json');
  });

  it('machine surface 13 endpoint verbs + paths (MACHINE_WIRE, verb [inferred] registry surface)', () => {
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

describe('protocol vocabulary snapshot (02 §5/§6 canonical)', () => {
  it('web REST endpoint vocabulary (02 §6.1)', () => {
    expect(WEB_REST_ENDPOINTS).toMatchSnapshot();
  });

  it('DELETE surface rules ([inferred], 02 §6.1) and divergence registry', () => {
    expect({ DELETE_FACE, NON_REPLICATED_ENDPOINTS }).toMatchSnapshot();
  });

  it('machine surface 13 endpoints (02 §5/r3 §1.6)', () => {
    expect(MACHINE_ENDPOINTS).toMatchSnapshot();
  });

  it("SSE's three channels (02 §1.2)", () => {
    expect(SSE_CHANNELS).toMatchSnapshot();
  });

  it('executor minimum-version gate shape (02 §7.1: value self-determined per replica version line [design])', () => {
    expect({
      CLI_COMMANDS,
      CLI_START_OPTIONS,
      ENV_VARS,
      PROVIDER_COMMAND_NOTICE,
    }).toMatchSnapshot();
  });

  it('local state layout and log prefixes (02 §5.3)', () => {
    expect({ LOCAL_STATE_FILES, LOCAL_STATE_DIRS, DAEMON_LOG_PREFIXES }).toMatchSnapshot();
  });

  it('worktree contract (02 §5.5)', () => {
    expect(WORKTREE_CONTRACT).toMatchSnapshot();
  });

  it('pi stream events / config kinds / stream timeouts / machine tools / proxy probing (02 §5.6)', () => {
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

  it('step lifecycle line order (02 §5.7) and bring-up sequence canon (02 §5.4)', () => {
    expect({ STEP_LIFECYCLE_LOG_LINES, ONLINE_SEQUENCE_CANON }).toMatchSnapshot();
  });

  it('MCP server surface: 24-tool whitelist + six capability groups (02 §7.2)', () => {
    expect({ MCP_TOOLS_READ, MCP_TOOLS_WRITE, MCP_CAPABILITY_GROUPS }).toMatchSnapshot();
  });

  it('provider presets 38-item catalog (r3 §2/02 §6.2)', () => {
    expect(PROVIDER_PRESET_IDS).toMatchSnapshot();
  });

  it('localStorage key contract (02 §6.4/r2 §1.5)', () => {
    expect({ LOCAL_STORAGE_KEYS, THIRD_PARTY_CLIENT_KEYS }).toMatchSnapshot();
  });

  it('phase nine values + board columns + semantics (02 §4.1)', () => {
    expect({ PHASE_VALUES, PHASE_SEMANTICS, BOARD_COLUMNS }).toMatchSnapshot();
  });

  it('brand-string naming table (02 §5.8 + replacement plan §2)', () => {
    expect({ BRAND_SLOTS, BRAND }).toMatchSnapshot();
  });

  it('storage table list (01 §6)', () => {
    expect(DB_TABLES).toMatchSnapshot();
  });

  it('merge-gate blocker vocabulary: codes, categories, and copy, in fixed order (#1404; S5-S9 routed by category, first blocker is the status description)', () => {
    expect(MERGE_BLOCKERS.map((b) => `${b.code}: ${b.class}, ${b.label}`)).toMatchSnapshot();
  });
});
