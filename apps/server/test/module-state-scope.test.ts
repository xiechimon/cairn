import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const ROOT = join(import.meta.dirname, '../../..');
const SCANNED = ['apps/server/src', 'apps/daemon/src'];
const DECL = /^(?:export )?(?:const|let) ([A-Za-z_$][\w$]*) = new (Map|Set)\s*[<(]/;

const ALLOWED: Record<string, string> = {
  'apps/daemon/src/backend/acp.ts:adapterProcessGroups':
    'OS child-process groups spawned by this daemon process; a process resource',
  'apps/daemon/src/backend/acp.ts:GEMMA_4_MODELS': 'constant lookup table',
  'apps/daemon/src/backend/acp-permission-gate.ts:PERMISSIVE_MODES': 'constant lookup table',
  'apps/daemon/src/backend/acp-permission-gate.ts:KNOWN_KINDS': 'constant lookup table',
  'apps/daemon/src/backend/acp-permission-gate.ts:READ_KINDS': 'constant lookup table',
  'apps/daemon/src/backend/command-gate.ts:ADB_SAFE_SUBCOMMANDS': 'constant lookup table',
  'apps/daemon/src/backend/command-gate.ts:IOS_BRIDGE_HEADS': 'constant lookup table',
  'apps/daemon/src/backend/command-gate.ts:COMMAND_OPERAND_HEADS': 'constant lookup table',
  'apps/daemon/src/backend/command-gate.ts:ARITH_EVAL_HEADS': 'constant lookup table',
  'apps/daemon/src/backend/command-gate.ts:RUNNER_ENV_NAMES': 'constant lookup table',
  'apps/daemon/src/backend/command-gate.ts:POWER_HEADS': 'constant lookup table',
  'apps/daemon/src/backend/command-gate.ts:ADB_VALUE_FLAGS': 'constant lookup table',
  'apps/daemon/src/backend/command-gate.ts:COMMAND_SEPARATORS': 'constant lookup table',
  'apps/daemon/src/backend/command-gate.ts:SHELLS': 'constant lookup table',
  'apps/daemon/src/backend/command-gate.ts:COMMAND_KEYWORDS': 'constant lookup table',
  'apps/daemon/src/backend/confine-session.ts:STATE_FILES': 'constant lookup table',
  'apps/daemon/src/backend/image-support.ts:learnedNoVision':
    'learned capability memo keyed on model id; an environment fact, not instance state',
  'apps/daemon/src/backend/otel.ts:tracings':
    'process-wide tracing registry; one OTel pipeline per daemon process',
  'apps/daemon/src/backend/pi.ts:learnedCompat':
    'learned endpoint compatibility keyed on baseUrl+provider; environment facts',
  'apps/daemon/src/backend/pi.ts:lastServerCompat': 'same learned-compat memo as above',
  'apps/daemon/src/backend/pinned-env.ts:pinnedByDaemon':
    'process-environment pins keyed on daemon id; the daemon process is the instance',
  'apps/daemon/src/backend/web-search.ts:spendQueues':
    'write serialization keyed on spend-file path; coordinates a filesystem resource',
  'apps/daemon/src/brief-file.ts:CONTEXT_FILENAMES': 'constant lookup table',
  'apps/daemon/src/child-env.ts:CHILD_ENV_BASE': 'constant lookup table',
  'apps/daemon/src/computer/browser.ts:SECRET_AUTOCOMPLETE': 'constant lookup table',
  'apps/daemon/src/computer/browser.ts:scopeTabUse':
    'tab accounting for the daemon-owned browser runtime; one browser per daemon process',
  'apps/daemon/src/computer/guard-words.ts:SAFE_SHELL_CONTROL_OPS': 'constant lookup table',
  'apps/daemon/src/computer/guard-words.ts:HEREDOC_INTERPRETERS': 'constant lookup table',
  'apps/daemon/src/computer/guard-words.ts:HEREDOC_DATA_SINKS': 'constant lookup table',
  'apps/daemon/src/computer/guard-words.ts:COMMAND_WRAPPERS': 'constant lookup table',
  'apps/daemon/src/computer/guard-words.ts:EXTERNAL_ASSIGNMENT_COMMANDS': 'constant lookup table',
  'apps/daemon/src/computer/guard-words.ts:ACTIVATE_DESTINATION_COMMANDS': 'constant lookup table',
  'apps/daemon/src/computer/guard-words.ts:COPY_LONG_ARGUMENTS': 'constant lookup table',
  'apps/daemon/src/computer/host.ts:AGENT_BROWSER_ENV': 'constant lookup table',
  'apps/daemon/src/computer/host.ts:HOST_STRIPPED_ENV': 'constant lookup table',
  'apps/daemon/src/computer/owner-chrome.ts:ACT_KINDS': 'constant lookup table',
  'apps/daemon/src/computer/owner-chrome.ts:sessions':
    'MCP tool-client pool for the daemon-owned Chrome session; a process resource',
  'apps/daemon/src/host-permissions.ts:SETTLED': 'constant lookup table',
  'apps/daemon/src/orb/podman.ts:RESUMABLE_STATES': 'constant lookup table',
  'apps/daemon/src/orb/relay.ts:listeningPaths':
    'socket paths already bound by relay servers in this process; prevents double-bind',
  'apps/daemon/src/orb/services-yaml.ts:RESERVED_ENV': 'constant lookup table',
  'apps/daemon/src/step-pass-events.ts:CHANGE_TOOLS': 'constant lookup table',
  'apps/daemon/src/supervisor.ts:SYSTEMD_OWNED_ENV': 'constant lookup table',
  'apps/server/src/coordinator/runtime/cold-slim.ts:TOOL_RESULT_EXEMPT': 'constant lookup table',
  'apps/server/src/coordinator/runtime/failure-report.ts:counts':
    'process-wide failure-report counters for the in-server coordinator runtime',
  'apps/server/src/coordinator/runtime/failure-report.ts:reportedTasks':
    'same failure-report registry; dedupe of tasks already reported',
  'apps/server/src/coordinator/runtime/image-text.ts:sharedImageTextCache':
    'content-addressed memo keyed on image sha256; identical input yields identical output',
  'apps/server/src/coordinator/runtime/images.ts:inlineMimeTypes': 'constant lookup table',
  'apps/server/src/coordinator/runtime/tool-args-repair.ts:VALUE_START': 'constant lookup table',
  'apps/server/src/coordinator/runtime/tool-args-repair.ts:JSON_ESCAPE': 'constant lookup table',
  'apps/server/src/coordinator/steer-withdrawals.ts:steerWithdrawals':
    'in-server coordinator runtime registry keyed on unique stepIds; the coordinator is a process-level singleton',
  'apps/server/src/lib/forwarded-origin.ts:FORWARDED_PROTOCOLS': 'constant lookup table',
  'apps/server/src/lib/github-oauth-base.ts:LOOPBACK_HOSTS': 'constant lookup table',
  'apps/server/src/lib/github-token.ts:appFetches':
    'fetcher registry keyed on the app-token socket token; the token identifies the app',
  'apps/server/src/lib/github-token.ts:fallbackCounts': 'process metrics counters',
  'apps/server/src/lib/local-source.ts:caseFoldingCache':
    'whether a volume folds case is a filesystem fact shared by every instance',
  'apps/server/src/lib/remote-routes.ts:WILDCARD_HOSTS': 'constant lookup table',
  'apps/server/src/lib/request-origin.ts:LOOPBACK_PEER_ADDRESSES': 'constant lookup table',
  'apps/server/src/lib/token-auth.ts:READ_METHODS': 'constant lookup table',
  'apps/server/src/lib/tsnet-sidecar.ts:INHERITED_ENV_NAMES': 'constant lookup table',
  'apps/server/src/runtime-otel.ts:tracings':
    'process-wide tracing registry; one OTel pipeline per server process',
  'apps/server/src/services/apns.ts:DEAD_TOKEN_REASONS': 'constant lookup table',
  'apps/server/src/services/apns.ts:sessions':
    'HTTP/2 connection pool keyed on APNs origin; a process network resource',
  'apps/server/src/services/blockers.ts:DEAD_ENDS': 'constant lookup table',
  'apps/server/src/services/build-gate-verdict.ts:verdictDigestsInFlight':
    'outstanding digest-write promises of the in-server gate; flushVerdictDigests only awaits them',
  'apps/server/src/services/chief-tools.ts:PROJECT_WRITE_TOOLS': 'constant lookup table',
  'apps/server/src/services/ci-check-verdict.ts:FIXABLE': 'constant lookup table',
  'apps/server/src/services/ci-check-verdict.ts:BLOCKING_UNREQUIRED': 'constant lookup table',
  'apps/server/src/services/computer-screen.ts:LOOPBACK_ADDRESSES': 'constant lookup table',
  'apps/server/src/services/coordinator-turn-capture.ts:liveCaptures':
    'in-server coordinator capture registry keyed on unique stepIds; the coordinator is a process-level singleton',
  'apps/server/src/services/im/slack.ts:AUTH_ERRORS': 'constant lookup table',
  'apps/server/src/services/im/slack.ts:PERMANENT_ERRORS': 'constant lookup table',
  'apps/server/src/services/machine-computer.ts:pendingOutput':
    'in-flight computer-call buffers keyed on unique callIds; dropComputerWaiters is the process-wide test cleanup seam',
  'apps/server/src/services/machine-computer.ts:pendingCalls':
    'in-flight computer calls keyed on unique callIds; same cleanup seam',
  'apps/server/src/services/machine-deps.ts:DEFERRED_SIGNALS': 'constant lookup table',
  'apps/server/src/services/mail.ts:ACTIVE_ACCOUNT': 'constant lookup table',
  'apps/server/src/services/mcp-face.ts:CHIEF_DESCRIPTIONS':
    'constant map built from the constant CHIEF_REMOTE_TOOLS list',
  'apps/server/src/services/memory-edit.ts:CONTINUABLE_STATUSES': 'constant lookup table',
  'apps/server/src/services/memory-import.ts:IMPORT_BASENAMES': 'constant lookup table',
  'apps/server/src/services/merge-gate/readiness.ts:PASSING_CONCLUSIONS': 'constant lookup table',
  'apps/server/src/services/merge-gate/readiness.ts:ORDER': 'constant lookup table',
  'apps/server/src/services/merge-gate/readiness.ts:META': 'constant lookup table',
  'apps/server/src/services/model-liveness.ts:catalogCache':
    'probe cache keyed on teamId+provider; teamIds are unique per database',
  'apps/server/src/services/model-liveness.ts:minProbeCache': 'same teamId-keyed probe cache',
  'apps/server/src/services/owner.ts:ENDED_STEP': 'constant lookup table',
  'apps/server/src/services/personal-space.ts:INSTRUCTION_FILES': 'constant lookup table',
  'apps/server/src/services/personal-space.ts:INSTRUCTION_DIRS': 'constant lookup table',
  'apps/server/src/services/personal-space.ts:REGULAR_FILE_MODES': 'constant lookup table',
  'apps/server/src/services/pr-wakes.ts:GREEN_CONCLUSIONS': 'constant lookup table',
  'apps/server/src/services/push.ts:GONE_STATUSES': 'constant lookup table',
  'apps/server/src/services/report-turn.ts:REPORT_OPEN_TOOLS': 'constant lookup table',
  'apps/server/src/services/report-turn.ts:REPORT_REF_TOOLS': 'constant lookup table',
  'apps/server/src/services/thread-pr.ts:PASSING_CONCLUSIONS': 'constant lookup table',
  'apps/server/src/services/todos.ts:selfIssueInFlight':
    'in-flight self-issue promises keyed on unique todoIds',
  'apps/server/src/vendor-open-design/document-preview.ts:TAG_NAME_END': 'constant lookup table',
};

function sources(dir: string): string[] {
  const base = join(ROOT, dir);
  const out: string[] = [];
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(path);
    }
  };
  walk(base);
  return out;
}

describe('module-level mutable state stays per-instance', () => {
  test('every top-level new Map(/new Set( in server and daemon sources is allowlisted', () => {
    const found = new Map<string, string>();
    for (const dir of SCANNED) {
      for (const file of sources(dir)) {
        const rel = file.slice(ROOT.length + 1);
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, index) => {
            const match = DECL.exec(line);
            if (match !== null) {
              const key = `${rel}:${match[1]}`;
              found.set(key, `${rel}:${index + 1} declares ${match[1]}`);
            }
          });
      }
    }
    const unlisted = [...found.keys()].filter((key) => !(key in ALLOWED));
    const stale = Object.keys(ALLOWED).filter((key) => !found.has(key));
    const emptyReasons = Object.entries(ALLOWED)
      .filter(([, reason]) => reason.trim() === '')
      .map(([key]) => key);
    expect(
      unlisted,
      `new module-level Map/Set without an allowlist reason:\n${unlisted
        .map((key) => `  ${found.get(key)}`)
        .join(
          '\n',
        )}\nPer-instance state belongs in AppContext, a factory, or an instance-keyed WeakMap; add an entry only if it is genuinely process-wide, with a reason.`,
    ).toEqual([]);
    expect(
      stale,
      `allowlist entries that no longer match a declaration:\n${stale.join('\n')}`,
    ).toEqual([]);
    expect(emptyReasons, 'allowlist entries must carry a reason').toEqual([]);
  });
});
