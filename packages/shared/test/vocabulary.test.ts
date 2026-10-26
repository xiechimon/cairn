import { describe, expect, it } from 'vitest';
import {
  API_KEY_PATTERN,
  BACKEND_RUNTIME_IDS,
  BOARD_COLUMNS,
  BOARD_DROP_PHASES,
  BRAND,
  BRAND_SLOTS,
  boardColumnFor,
  CLAIM_BACKOFF_CAP_MS,
  CLAIM_POLL_INTERVAL_MS,
  CLI_COMMANDS,
  CONFIG_KINDS,
  canBoardDrop,
  canOrchestrate,
  capabilitiesResponseSchema,
  DB_TABLES,
  DEVICE_ID_PATTERN,
  ENV_VARS,
  INTERNAL_ONLY_TABLES,
  isBackendRuntimeId,
  JOIN_ONLY_TABLES,
  MACHINE_CUSTOM_TOOLS,
  MACHINE_ENDPOINTS,
  MACHINE_TOKEN_PATTERN,
  MACHINE_WIRE,
  MCP_CAPABILITY_GROUPS,
  MCP_MIN_CLI_VERSION,
  MCP_MIN_CLI_VERSION_GATE_OBSERVED,
  MCP_REGISTRY_BY_NAME,
  MCP_TOOL_REGISTRY,
  MCP_TOOLS_READ,
  MCP_TOOLS_WRITE,
  MEMORY_QUOTA_PER_AGENT,
  MEMORY_TOOLS,
  MODEL_SOURCE_RUNTIMES,
  maskApiKey,
  ORCHESTRATE_PHASES,
  ORPHAN_WORKTREE_TTL_MS,
  PHASE_VALUES,
  PI_STREAM_EVENTS,
  PUBLISHED_PACKAGES,
  RECORD_SCHEMAS,
  remoteToolDefSchema,
  SECRET_BOX_ENVELOPE_VERSION,
  SSE_CHANNELS,
  STEP_EVENT_TYPES,
  STEP_LIFECYCLE_LOG_LINES,
  STREAM_TIMEOUTS_MS,
  THINKING_LEVELS,
  WEB_REST_ENDPOINTS,
  WORKER_MEMORY_REMOTE_TOOLS,
} from '../src/index.js';

describe('phase nine values authoritative single source (02 §4.1, locked)', () => {
  it('is exactly the nine docs-ordered values', () => {
    expect(PHASE_VALUES).toEqual([
      'todo',
      'queued',
      'planning',
      'confirm',
      'building',
      'review',
      'done',
      'failed',
      'closed',
    ]);
  });

  it('board columns are the four #351 workbench columns', () => {
    expect(BOARD_COLUMNS).toEqual(['待开始', '执行中', '待处理', '已完成']);
  });

  it('column mapping is the #351 single-key fold (no hasChanges param)', () => {
    expect(boardColumnFor).toHaveLength(1);
    expect(boardColumnFor('todo')).toBe('待开始');
    expect(boardColumnFor('queued')).toBe('执行中');
    expect(boardColumnFor('planning')).toBe('执行中');
    expect(boardColumnFor('building')).toBe('执行中');
    expect(boardColumnFor('confirm')).toBe('待处理');
    expect(boardColumnFor('review')).toBe('待处理');
    expect(boardColumnFor('failed')).toBe('待处理');
    expect(boardColumnFor('done')).toBe('已完成');
    expect(boardColumnFor('closed')).toBe('已完成');
  });

  it('manual drop targets are the four writable columns (#753)', () => {
    expect(BOARD_DROP_PHASES).toEqual(['todo', 'building', 'review', 'done']);
  });

  it('canBoardDrop → building only for phases orchestrate accepts (#1457)', () => {
    expect(ORCHESTRATE_PHASES).toEqual(['todo', 'failed']);
    for (const phase of PHASE_VALUES) {
      if (canBoardDrop(phase, 'building')) expect(canOrchestrate(phase), phase).toBe(true);
    }
  });

  it('canBoardDrop is the per-source manual matrix (#753)', () => {
    expect(canBoardDrop('todo', 'building')).toBe(true);
    expect(canBoardDrop('todo', 'done')).toBe(true);
    expect(canBoardDrop('todo', 'review')).toBe(false);
    expect(canBoardDrop('confirm', 'todo')).toBe(true);
    expect(canBoardDrop('review', 'todo')).toBe(true);
    expect(canBoardDrop('confirm', 'done')).toBe(true);
    expect(canBoardDrop('review', 'done')).toBe(true);
    expect(canBoardDrop('confirm', 'building')).toBe(false);
    expect(canBoardDrop('review', 'building')).toBe(false);
    expect(canBoardDrop('failed', 'todo')).toBe(true);
    expect(canBoardDrop('failed', 'done')).toBe(true);
    expect(canBoardDrop('done', 'todo')).toBe(true);
    expect(canBoardDrop('done', 'review')).toBe(true);
    expect(canBoardDrop('done', 'building')).toBe(false);
    expect(canBoardDrop('queued', 'todo')).toBe(true);
    expect(canBoardDrop('queued', 'done')).toBe(true);
    expect(canBoardDrop('queued', 'building')).toBe(false);
    expect(canBoardDrop('building', 'todo')).toBe(true);
    expect(canBoardDrop('building', 'done')).toBe(true);
    expect(canBoardDrop('building', 'review')).toBe(false);
    expect(canBoardDrop('todo', 'todo')).toBe(false);
    expect(canBoardDrop('confirm', 'review')).toBe(false);
    expect(canBoardDrop('planning', 'building')).toBe(false);
    expect(canBoardDrop('closed', 'todo')).toBe(true);
    expect(canBoardDrop('done', 'failed')).toBe(false);
    expect(canBoardDrop('done', 'confirm')).toBe(false);
  });
});

describe('machine protocol (02 §5, r3 §1.6)', () => {
  it('has the 13 machine-face endpoints', () => {
    expect(MACHINE_ENDPOINTS).toHaveLength(13);
    expect(MACHINE_ENDPOINTS.map((e) => e.path)).toEqual([
      '/api/machine/enroll',
      '/api/machine/enroll/start',
      '/api/machine/enroll/poll',
      '/api/machine/me',
      '/api/machine/presence',
      '/api/machine/recover',
      '/api/machine/tasks/claim',
      '/api/machine/stream',
      '/api/machine/heartbeat/{stepId}',
      '/api/machine/tool/{stepId}',
      '/api/machine/token/{stepId}',
      '/api/machine/upload-urls/{stepId}',
      '/api/machine/done/{stepId}',
    ]);
  });

  it('pins the observed cadence and retry budgets', () => {
    expect(CLAIM_POLL_INTERVAL_MS).toBe(75_000);
    expect(CLAIM_BACKOFF_CAP_MS).toBe(30_000);
    expect(STREAM_TIMEOUTS_MS).toEqual({
      streamFirstEvent: 300_000,
      streamIdle: 480_000,
      streamBodyTimeout: 540_000,
    });
    expect(ORPHAN_WORKTREE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(MEMORY_QUOTA_PER_AGENT).toBe(100);
  });

  it('pi stream event vocabulary is the 17-item bundle extraction (02 §5.6)', () => {
    expect(PI_STREAM_EVENTS).toHaveLength(17);
    expect(PI_STREAM_EVENTS).toEqual([
      'text_delta',
      'thinking',
      'thinking_delta',
      'toolcall_end',
      'message_update',
      'message_end',
      'message_stop',
      'compaction',
      'compaction_start',
      'compaction_end',
      'auto_retry_start',
      'auto_retry_end',
      'steer',
      'done',
      'error',
      'wake',
      'shutdown',
    ]);
  });

  it('config kinds and machine custom tools (02 §5.6)', () => {
    expect(CONFIG_KINDS).toEqual(['api_key', 'oauth', 'http', 'stdio']);
    expect(MACHINE_CUSTOM_TOOLS).toEqual(['web_fetch', 'push_branch']);
  });

  it('CLI command face copied verbatim (02 §5.1)', () => {
    expect(CLI_COMMANDS).toEqual([
      'start',
      'stop',
      'restart',
      'logs',
      'logout',
      'status',
      'version',
      'provider',
    ]);
  });

  it('step lifecycle log line templates (02 §5.7)', () => {
    expect(STEP_LIFECYCLE_LOG_LINES).toHaveLength(7);
  });
});

describe('web REST vocabulary (02 §6.1 canonical)', () => {
  const has = (method: string, path: string) =>
    WEB_REST_ENDPOINTS.some((e) => e.method === method && e.path === path);

  it('covers the observed GET list', () => {
    for (const [method, path] of [
      ['GET', '/api/auth/session'],
      ['GET', '/api/user/me'],
      ['GET', '/api/teams'],
      ['GET', '/api/teams/{id}/members'],
      ['GET', '/api/teams/{id}/machines'],
      ['GET', '/api/teams/{id}/providers'],
      ['GET', '/api/teams/{id}/mcp-servers'],
      ['GET', '/api/teams/{id}/models'],
      ['GET', '/api/teams/{id}/notifications'],
      ['GET', '/api/teams/{id}/progress'],
      ['GET', '/api/teams/{id}/stream'],
      ['GET', '/api/teams/{id}/skills/{sid}'],
      ['GET', '/api/teams/{id}/skills/{sid}/file'],
      ['GET', '/api/teams/{id}/agents/{aid}'],
      ['GET', '/api/teams/{id}/agents/{aid}/tasks'],
      ['GET', '/api/teams/{id}/agents/{aid}/memories'],
      ['GET', '/api/teams/{id}/chief'],
      ['GET', '/api/teams/{id}/chief/threads'],
      ['GET', '/api/projects'],
      ['GET', '/api/projects/{id}/todos'],
      ['GET', '/api/projects/{id}/branches'],
      ['GET', '/api/projects/{id}/tags'],
      ['GET', '/api/projects/{id}/builds'],
      ['GET', '/api/projects/{id}/tree'],
      ['GET', '/api/projects/{id}/file'],
      ['GET', '/api/projects/{id}/preview-token'],
      ['GET', '/api/todos'],
      ['GET', '/api/todos/{id}'],
      ['GET', '/api/builds/{id}'],
      ['GET', '/api/builds/{id}/steps'],
      ['GET', '/api/conversations/{id}/messages'],
      ['GET', '/api/conversations/{id}/stream'],
      ['GET', '/api/documents/{id}/diff'],
      ['GET', '/api/schedules'],
      ['GET', '/api/skills'],
      ['GET', '/api/search'],
    ] as const) {
      expect(has(method, path), `${method} ${path}`).toBe(true);
    }
  });

  it('covers the observed POST/PATCH list', () => {
    for (const [method, path] of [
      ['POST', '/api/projects/{id}/todos'],
      ['POST', '/api/projects/{id}/builds'],
      ['POST', '/api/builds/{id}/merge'],
      ['POST', '/api/builds/{id}/steps'],
      ['POST', '/api/teams/{id}/providers'],
      ['POST', '/api/teams/{id}/mcp-servers'],
      ['POST', '/api/teams/{id}/agents'],
      ['POST', '/api/schedules'],
      ['POST', '/api/analytics/first-touch'],
      ['PATCH', '/api/teams/{id}/providers/{pid}'],
      ['PATCH', '/api/teams/{id}/agents/{aid}'],
      ['PATCH', '/api/teams/{id}/chief'],
    ] as const) {
      expect(has(method, path), `${method} ${path}`).toBe(true);
    }
  });

  it('carries query vocabularies for the parameterized GETs', () => {
    const q = (path: string) => WEB_REST_ENDPOINTS.find((e) => e.path === path)?.query ?? [];
    expect(q('/api/projects')).toEqual(['teamId']);
    expect(q('/api/projects/{id}/tree')).toEqual(['ref']);
    expect(q('/api/projects/{id}/file')).toEqual(['path', 'ref']);
    expect(q('/api/projects/{id}/preview-token')).toEqual(['ref']);
    expect(q('/api/todos')).toEqual(['teamId']);
    expect(q('/api/schedules')).toEqual(['team']);
    expect(q('/api/skills')).toEqual(['teamId']);
    expect(q('/api/teams/{id}/skills/{sid}/file')).toEqual(['fileName']);
    expect(q('/api/search')).toEqual(['q']);
  });

  it('excludes /api/push -- Web Push stays out of spec (R1 final ruling, 02 §9.1/04 §5)', () => {
    expect(has('POST', '/api/push')).toBe(false);
  });

  it('skills write surface rolled back (XMON-109 spec 13 rollback: POST /api/skills + PUT teams/{id}/skills/{sid}); scan surface still absent', () => {
    expect(has('POST', '/api/skills')).toBe(true);
    expect(has('PUT', '/api/teams/{id}/skills/{sid}')).toBe(true);
    expect(has('POST', '/api/skills/scan')).toBe(false);
  });
});

describe('SSE channels (02 §1.2, all SSE, no WS)', () => {
  it('has exactly the three channels', () => {
    expect(SSE_CHANNELS.map((c) => c.endpoint)).toEqual([
      '/api/teams/{id}/stream',
      '/api/conversations/{id}/stream',
      '/api/machine/stream',
    ]);
  });
});

describe('MCP vocabulary (02 §7.2, r3 §6 matrix 1:1)', () => {
  it('server-face whitelist = 11 read groups + 13 write tools = 24', () => {
    expect(MCP_TOOLS_READ).toHaveLength(11);
    expect(MCP_TOOLS_WRITE).toHaveLength(13);
    expect(MCP_TOOLS_READ).toEqual([
      'Todos',
      'Projects',
      'Conversation',
      'Agents',
      'Schedules',
      'Attachment',
      'Skills',
      'Machines',
      'Issues',
      'Pull Requests',
      'Workflow Runs',
    ]);
    expect(MCP_TOOLS_WRITE).toEqual([
      'Create Todo',
      'Update Todo',
      'Message Todo',
      'Run Builds',
      'Run Review',
      'Confirm Builds',
      'Merge Builds',
      'Cancel Builds',
      'Complete Todos',
      'Close Todos',
      'Reopen Todos',
      'Schedule Todo',
      'Unschedule Todo',
    ]);
  });

  it('capability groups are the six docs verbatim (02 §7.2)', () => {
    expect(MCP_CAPABILITY_GROUPS).toEqual([
      'Read the workspace',
      'Read the repo',
      'Read progress',
      'Organize work',
      'Run work',
      'Manage lifecycle',
    ]);
  });

  it('tool registry = 24 grant<->name single source, whitelist labels 1:1 (02/A10 shape-preserving)', () => {
    const read = MCP_TOOL_REGISTRY.filter((t) => t.kind === 'read');
    const write = MCP_TOOL_REGISTRY.filter((t) => t.kind === 'write');
    expect(read.map((t) => t.grant)).toEqual([...MCP_TOOLS_READ]);
    expect(write.map((t) => t.grant)).toEqual([...MCP_TOOLS_WRITE]);
    expect(MCP_TOOL_REGISTRY).toHaveLength(24);
    const names = MCP_TOOL_REGISTRY.map((t) => t.name);
    expect(new Set(names).size).toBe(24);
    for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
    expect(MCP_REGISTRY_BY_NAME.size).toBe(24);
  });

  it('executor minimum-version gate shape (02 §7.1: value self-determined per replica version line [design])', () => {
    expect(MCP_MIN_CLI_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(MCP_MIN_CLI_VERSION_GATE_OBSERVED).toBe('0.1.45');
  });
});

describe('worker memory tools (02 §4.4/r5 §6: worker-step remoteTools memory trio)', () => {
  it('the trio = MEMORY_TOOLS family, shapes pass remoteToolDefSchema', () => {
    expect(WORKER_MEMORY_REMOTE_TOOLS.map((t) => t.name)).toEqual([...MEMORY_TOOLS]);
    for (const def of WORKER_MEMORY_REMOTE_TOOLS) {
      expect(remoteToolDefSchema.safeParse(def).success).toBe(true);
    }
    expect(WORKER_MEMORY_REMOTE_TOOLS.find((t) => t.name === 'memories')?.replaySafe).toBe(true);
    expect(WORKER_MEMORY_REMOTE_TOOLS.find((t) => t.name === 'save_memory')?.replaySafe).toBe(
      undefined,
    );
    const save = WORKER_MEMORY_REMOTE_TOOLS.find((t) => t.name === 'save_memory');
    expect(save).toBeDefined();
    const props = (save as { parameters: { properties: Record<string, unknown> } }).parameters
      .properties;
    expect(Object.keys(props).sort()).toEqual([
      'content',
      'force',
      'projectId',
      'sourceTodoId',
      'title',
    ]);
  });
});

describe('brand slots (02 §5.8 consolidation + replacement plan §2 canonical replacement values)', () => {
  it('covers every 02 §5.8 slot row', () => {
    expect(Object.keys(BRAND_SLOTS)).toEqual([
      'cliCommandName',
      'envPrefix',
      'homeDir',
      'workspacesDir',
      'branchPrefix',
      'apiKeyPrefix',
      'machineToken',
      'gitHostDomain',
      'remoteMcpPath',
      'cliPackageName',
      'deepLinkScheme',
      'firstTouchCookie',
      'localStoragePrefix',
      'daemonLog',
      'sessionCookie',
      'manifestName',
    ]);
  });

  it('live values are the replacement cairn family (D3 triggered 2026-09-23, #109)', () => {
    expect(BRAND.cliCommandName).toBe('cairn');
    expect(BRAND.envPrefix).toBe('CAIRN_');
    expect(BRAND.homeDirName).toBe('.cairn');
    expect(BRAND.branchPrefix).toBe('cairn/conv-');
    expect(BRAND.apiKeyPrefix).toBe('cairn_');
    expect(BRAND.manifestName).toBe('Cairn');
    expect(BRAND.remoteMcpPath).toBe('/api/mcp');
    expect(BRAND.cliPackageName).toBe('@xiechimon/cairn-cli');
  });

  it('BRAND live values = BRAND_SLOTS replacement column (single-source discipline, replacement plan §2)', () => {
    expect(BRAND.cliCommandName).toBe(BRAND_SLOTS.cliCommandName.replacement);
    expect(BRAND.envPrefix).toBe(BRAND_SLOTS.envPrefix.replacement);
    expect(BRAND.branchPrefix).toBe(BRAND_SLOTS.branchPrefix.replacement);
    expect(BRAND.manifestName).toBe(BRAND_SLOTS.manifestName.replacement);
    expect(BRAND.sessionCookieName).toBe(BRAND_SLOTS.sessionCookie.replacement);
  });

  it('env vars are the CAIRN_ same-shape replacement (replacement plan §2; r3 §1.1 observed original names TDS_*)', () => {
    const {
      webDir,
      githubOauthClientId,
      githubOauthClientSecret,
      token,
      requireToken,
      tailscaleUsers,
      mcpConfig,
      skillsDir,
      customModelReasoning,
      piCacheRetention,
      hookTimeoutMs,
      issueIntake,
      trajectoryOutcomeBackfill,
      ...observed
    } = ENV_VARS;
    expect(observed).toEqual({
      server: 'CAIRN_SERVER',
      apiKey: 'CAIRN_API_KEY',
      team: 'CAIRN_TEAM',
      workspacesDir: 'CAIRN_WORKSPACES_DIR',
      home: 'CAIRN_HOME',
    });
    expect(webDir).toBe('CAIRN_WEB_DIR');
    expect(githubOauthClientId).toBe('CAIRN_GITHUB_OAUTH_CLIENT_ID');
    expect(githubOauthClientSecret).toBe('CAIRN_GITHUB_OAUTH_CLIENT_SECRET');
    expect(token).toBe('CAIRN_TOKEN');
    expect(requireToken).toBe('CAIRN_REQUIRE_TOKEN');
    expect(tailscaleUsers).toBe('CAIRN_TAILSCALE_USERS');
    expect(mcpConfig).toBe('CAIRN_MCP_CONFIG');
    expect(skillsDir).toBe('CAIRN_SKILLS_DIR');
    expect(customModelReasoning).toBe('CAIRN_CUSTOM_MODEL_REASONING');
    expect(piCacheRetention).toBe('CAIRN_PI_CACHE_RETENTION');
    expect(hookTimeoutMs).toBe('CAIRN_HOOK_TIMEOUT_MS');
    expect(issueIntake).toBe('CAIRN_ISSUE_INTAKE');
    expect(trajectoryOutcomeBackfill).toBe('CAIRN_TRAJ_OUTCOME_BACKFILL');
  });

  it('credential formats match the observed shapes (key prefix follows the BRAND slot)', () => {
    expect(API_KEY_PATTERN.test('cairn_0123456789abcdef0123456789abcdef0123456789abcdef')).toBe(
      true,
    );
    expect(API_KEY_PATTERN.test('cairn_short')).toBe(false);
    expect(API_KEY_PATTERN.test('tds_0123456789abcdef0123456789abcdef0123456789abcdef')).toBe(
      false,
    );
    expect(MACHINE_TOKEN_PATTERN.test('a'.repeat(64))).toBe(true);
    expect(DEVICE_ID_PATTERN.test('b'.repeat(32))).toBe(true);
  });

  it('API-key list-row mask follows the r3 §6 display rule', () => {
    const plaintext = `cairn_afe07565${'0'.repeat(40)}`;
    expect(API_KEY_PATTERN.test(plaintext)).toBe(true);
    expect(maskApiKey(plaintext)).toBe('cairn_afe07565…');
  });

  it('SecretBox envelope version word is v1 (01 §4.2)', () => {
    expect(SECRET_BOX_ENVELOPE_VERSION).toBe('v1');
  });
});

describe('record projection (01 §6 / 03 M1; M4a +chief; M7 #308 +stop_pending; #310 +attachment; #319 +branch_sync; spec 12 +github_connection; spec 13 −skill −mcp_server; XMON-109 +skill_audit; XMON-108 +shell_command; #1029 −document_diff; #1137 +webhook_token; #1404 +gate_*; #1491 +autonomy_state +member_activity)', () => {
  it('DB table registry keeps schedules and drops whats_new, webhook_token, and shell_command (#1796)', () => {
    expect(DB_TABLES).toHaveLength(38);
    expect(DB_TABLES).toContain('autonomy_state');
    expect(DB_TABLES).toContain('member_activity');
    expect(DB_TABLES).toContain('build_feedback');
    expect(DB_TABLES).toContain('build_outcome_backfill');
    expect(DB_TABLES).toContain('todo_tag');
    expect(DB_TABLES).toContain('chief');
    expect(DB_TABLES).toContain('attachment');
    expect(DB_TABLES).toContain('branch_sync');
    expect(DB_TABLES).toContain('stop_pending');
    expect(DB_TABLES).toContain('github_connection');
    expect(DB_TABLES).toContain('schedule');
    expect(DB_TABLES).not.toContain('shell_command');
    expect(DB_TABLES).not.toContain('whats_new');
    expect(DB_TABLES).not.toContain('skill');
    expect(DB_TABLES).toContain('skill_audit');
    expect(DB_TABLES).not.toContain('webhook_token');
    for (const t of ['gate_digest', 'gate_round', 'gate_verdict', 'gate_state']) {
      expect(DB_TABLES).toContain(t);
      expect(INTERNAL_ONLY_TABLES).toContain(t);
    }
  });

  it('record shapes cover exactly the 21 wire tables (todo_tag join + internal tables have none; skill and mcp_server are projections with no table slot)', () => {
    expect(Object.keys(RECORD_SCHEMAS)).toHaveLength(21);
    expect(Object.keys(RECORD_SCHEMAS)).toEqual(
      DB_TABLES.filter(
        (t) =>
          !(JOIN_ONLY_TABLES as readonly string[]).includes(t) &&
          !(INTERNAL_ONLY_TABLES as readonly string[]).includes(t),
      ),
    );
  });
});

describe('AgentBackend seam (01 §5, 00/D1 seam)', () => {
  it('StepEvent types = 02 §5.6 pi vocabulary session-facing 15 items, 1:1 no rename', () => {
    expect(STEP_EVENT_TYPES).toHaveLength(15);
    expect(STEP_EVENT_TYPES).toEqual(PI_STREAM_EVENTS.slice(0, 15));
  });

  it('BACKEND_RUNTIME_IDS accepts claude-code and gemini; pi is still not a backend identity', () => {
    expect(BACKEND_RUNTIME_IDS).toEqual(['claude-code', 'gemini']);
    expect(BACKEND_RUNTIME_IDS).not.toContain('pi');
    for (const id of BACKEND_RUNTIME_IDS) {
      expect(MODEL_SOURCE_RUNTIMES).toContain(id);
    }
  });

  it('isBackendRuntimeId: outside the vocabulary (custom provider id / pi / null / undefined) always false', () => {
    expect(isBackendRuntimeId('claude-code')).toBe(true);
    expect(isBackendRuntimeId('gemini')).toBe(true);
    expect(isBackendRuntimeId('stub-gw')).toBe(false);
    expect(isBackendRuntimeId('pi')).toBe(false);
    expect(isBackendRuntimeId('anthropic')).toBe(false);
    expect(isBackendRuntimeId(null)).toBe(false);
    expect(isBackendRuntimeId(undefined)).toBe(false);
  });
});

describe('thinking-level capability read surface (XMON-16 / #499 B3 ruling A)', () => {
  it('THINKING_LEVELS = pi ThinkingLevel seven tiers verbatim', () => {
    expect(THINKING_LEVELS).toEqual(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
  });

  it('capability read-surface envelope accepts only in-vocabulary tiers (out-of-vocabulary always rejected)', () => {
    expect(capabilitiesResponseSchema.parse({ thinkingLevels: ['off', 'max'] })).toEqual({
      thinkingLevels: ['off', 'max'],
    });
    expect(capabilitiesResponseSchema.safeParse({ thinkingLevels: ['ultra'] }).success).toBe(false);
    expect(capabilitiesResponseSchema.safeParse({ thinkingLevels: [] }).success).toBe(true);
  });
});

describe('machine wire (02 §5 canonical, wire layer enters CI)', () => {
  it('MACHINE_WIRE covers exactly the 13 endpoint paths (single source)', () => {
    expect(MACHINE_WIRE).toHaveLength(13);
    expect(MACHINE_WIRE.map((w) => w.path)).toEqual(MACHINE_ENDPOINTS.map((e) => e.path));
  });

  it('claim/stream verbs match observed evidence (long-poll claim + SSE stream)', () => {
    const byPath = Object.fromEntries(MACHINE_WIRE.map((w) => [w.path, w.method]));
    expect(byPath['/api/machine/tasks/claim']).toBe('POST');
    expect(byPath['/api/machine/stream']).toBe('GET');
    expect(byPath['/api/machine/me']).toBe('GET');
    expect(byPath['/api/machine/token/{stepId}']).toBe('GET');
  });
});

describe('PUBLISHED_PACKAGES', () => {
  it('install command and start command come from the same published package (package name and command name paired)', () => {
    const pairs: Record<string, string> = {
      '@xiechimon/cairn': 'cairn',
      '@xiechimon/cairn-cli': 'cairn',
    };
    for (const published of Object.values(PUBLISHED_PACKAGES))
      expect(pairs[published.name]).toBe(published.command);
  });
});
