import { expect, test } from 'vitest';
import {
  BUILD_CAUSES,
  type BuildCause,
  classifyBuildCause,
  UNATTRIBUTED,
} from '../src/reliability-report.js';

const liveMessages: Array<{ message: string; cause: BuildCause; why: string }> = [
  {
    message:
      'plan 步无指派 Agent：assignment 的 plan 槽为空，无人可领。指派 Agent 后重新运行任务。',
    cause: 'unstaffed',
    why: 'the plan slot has no agent, so no machine could ever claim the step',
  },
  {
    message:
      '本轮无人认领：钉选的执行机「mea」在线且有空闲并发位，但 10 分钟未认领本步（其 daemon 可能未在领取或为旧版串行循环）。请检查该执行机的 daemon（重启或升级后重跑），或把任务的执行机改为其它在线执行机（重跑沿用任务的钉选）。',
    cause: 'unclaimed',
    why: 'the pinned machine held an idle slot and still never claimed the step',
  },
  {
    message:
      'session e5f26065-60a1-4016-b823-c8b5ae0dc64a not found on this machine (continue session impossible)',
    cause: 'session-lost',
    why: 'a continue step cannot resume a session the machine never stored',
  },
  {
    message:
      "git worktree failed (signal SIGTERM): Preparing worktree (new branch 'pacman/conv-01a16921-802c-739a-8991-9d44685eaa8f')\nUpdating files:   0% (74/8507)",
    cause: 'git',
    why: 'worktree creation is a git step, whatever killed it',
  },
  {
    message: '503: {"message":"All available accounts exhausted","type":"server_error"}',
    cause: 'provider-network',
    why: 'the relay had no account left to serve the request',
  },
  {
    message: 'Connection error.',
    cause: 'provider-network',
    why: 'a bare connection failure from the provider client',
  },
  {
    message: 'Failed to fetch team settings',
    cause: 'provider-network',
    why: 'the Devin client could not reach its service while loading team settings',
  },
  {
    message: 'getaddrinfo ENOTFOUND api.example.com',
    cause: 'provider-network',
    why: 'a name that does not resolve is a connection failure in every classifier',
  },
  {
    message:
      '404: {"message":"Model \\"glm-5.3\\" is not supported by any configured account in this group","type":"model_not_found"}\nprovider response: POST https://relay.example/v1/chat/completions -> 404 application/json',
    cause: 'model-config',
    why: 'the step names a model no configured account serves, so every retry fails the same way',
  },
  {
    message:
      'Citation check parked: The citation checker cannot run: its model or credentials are unavailable. Last error: 404: {"message":"Model \\"glm-5.3\\" is not supported by any configured account in this group","type":"model_not_found"}',
    cause: 'model-config',
    why: 'a gate that parks on an unconfigured model fails for the same configuration reason',
  },
  {
    message:
      "There's an issue with the selected model (deepseek-v4.1-flash[1m]). It may not exist or you may not have access to it.",
    cause: 'model-config',
    why: 'Claude Code reports a model it cannot reach this way',
  },
  {
    message: 'Coordinator turn ended: no_model',
    cause: 'model-config',
    why: 'the Coordinator had no model configured for the turn',
  },
];

test('every failure message observed on the live database maps to the cause it names', () => {
  for (const { message, cause, why } of liveMessages) {
    expect(classifyBuildCause({ errorMessage: message, prNumber: null, ageMs: 0 }), why).toBe(
      cause,
    );
  }
});

test('the cause vocabulary covers capacity problems, so other is only unattributed', () => {
  expect([...BUILD_CAUSES]).toEqual([
    'provider-network',
    'quota',
    'timeout',
    'git',
    'unstaffed',
    'unclaimed',
    'session-lost',
    'model-config',
    'agent-gave-up',
    'gate-or-phase-bug',
    'stuck-waiting',
    'other',
  ]);
  expect(UNATTRIBUTED).toBe('other');
});

test('every cause has at least one message that reaches it, and no pattern steals a neighbour', () => {
  const samples: Record<BuildCause, string> = {
    'provider-network': 'dial tcp 1.2.3.4:443: i/o timeout',
    quota: '402 - You have insufficient credits',
    timeout: 'stream timeout (arm=idle, 300000ms)',
    git: "git push failed (128): fatal: Authentication failed for 'https://x/y'",
    unstaffed: 'plan 步无指派 Agent：assignment 的 plan 槽为空，无人可领。',
    unclaimed: '本轮无人认领：钉选的执行机「mea」在线且有空闲并发位',
    'session-lost': 'session abc not found on this machine (continue session impossible)',
    'model-config': 'The model `gpt-9` does not exist or you do not have access to it.',
    'agent-gave-up': 'agent session ended with zero progress and no terminal outcome',
    'gate-or-phase-bug': '方案结构不合格：plan must cite prior art',
    'stuck-waiting': 'never in the message channel',
    other: 'container exited before reporting (OOMKilled)',
  };
  for (const cause of BUILD_CAUSES) {
    if (cause === 'stuck-waiting') continue;
    expect(
      classifyBuildCause({ errorMessage: samples[cause], prNumber: null, ageMs: 0 }),
      samples[cause],
    ).toBe(cause);
  }
});

test('a fetch the server refused is not counted as a network failure', () => {
  const message = 'Failed to fetch team settings: 401 Unauthorized';
  expect(classifyBuildCause({ errorMessage: message, prNumber: null, ageMs: 0 })).toBe('other');
});

test('a worktree failure is git, not provider-network, even though it printed to stderr', () => {
  const message =
    'git worktree failed (signal SIGTERM): Preparing worktree (new branch "pacman/x")\nfatal: could not create work tree dir';
  expect(classifyBuildCause({ errorMessage: message, prNumber: null, ageMs: 0 })).toBe('git');
});
