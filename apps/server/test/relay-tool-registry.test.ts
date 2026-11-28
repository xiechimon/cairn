import { CONNECTOR_TOOL_PREFIX, REQUEST_SECRET_TOOL } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { step } from '../src/db/schema.js';
import type { MachineDeps } from '../src/services/machine-deps.js';
import { executeRelayToolCall, relayToolRegistry } from '../src/services/machine-relay.js';
import { createRelayToolRegistry } from '../src/services/relay-tool-registry.js';
import { bootServer } from './helpers.js';

function depsOf(s: ReturnType<typeof bootServer>): MachineDeps {
  return {
    db: s.db,
    hub: s.hub,
    convHub: s.convHub,
    machineHub: s.machineHub,
    box: s.secretBox,
    user: s.user,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
    skillsDir: s.skillsDir,
  };
}

describe('createRelayToolRegistry', () => {
  test('routes by first matching namespace and exposes namespace list', async () => {
    const registry = createRelayToolRegistry<{ tag: string }>([
      {
        id: 'specific',
        matches: (name, kind) => kind === 'chief' && name === 'special_tool',
        execute: async (call) => `specific:${call.context.tag}`,
      },
      {
        id: 'fallback',
        matches: (_name, kind) => kind === 'chief',
        execute: async (call) => `fallback:${call.name}`,
      },
    ]);

    expect(registry.list()).toEqual(['specific', 'fallback']);
    expect(registry.resolve('special_tool', 'chief')?.id).toBe('specific');
    expect(registry.resolve('projects', 'chief')?.id).toBe('fallback');
    expect(registry.resolve('projects', 'plan')).toBeUndefined();

    await expect(
      registry.dispatch({
        name: 'special_tool',
        args: {},
        stepKind: 'chief',
        context: { tag: 'ok' },
      }),
    ).resolves.toBe('specific:ok');

    await expect(
      registry.dispatch({
        name: 'projects',
        args: {},
        stepKind: 'chief',
        context: { tag: 'ok' },
      }),
    ).resolves.toBe('fallback:projects');

    await expect(
      registry.dispatch({
        name: 'projects',
        args: {},
        stepKind: 'plan',
        context: { tag: 'ok' },
      }),
    ).rejects.toThrow('no relay tool namespace registered for plan:projects');
  });
});

describe('relayToolRegistry routes every tool namespace', () => {
  test('resolves namespaces without per-tool leakage across step kinds', () => {
    expect(relayToolRegistry.list()).toEqual([
      'computer',
      'thread-schedule',
      'connector',
      'secret-request',
      'chief',
      'worker-session',
      'worker-attachment',
      'worker-task-meta',
      'worker-skills',
      'worker-memory',
    ]);

    expect(relayToolRegistry.resolve('browser_act', 'chief')?.id).toBe('computer');
    expect(relayToolRegistry.resolve('user_computer_custom', 'build')?.id).toBe('computer');
    expect(relayToolRegistry.resolve('attach_file', 'chief')?.id).toBe('computer');
    expect(relayToolRegistry.resolve('attach_file', 'build')?.id).toBe('worker-attachment');
    expect(relayToolRegistry.resolve('get_schedule', 'plan')?.id).toBe('thread-schedule');
    expect(relayToolRegistry.resolve(`${CONNECTOR_TOOL_PREFIX}gmail__SEND`, 'chief')?.id).toBe(
      'connector',
    );
    expect(relayToolRegistry.resolve(REQUEST_SECRET_TOOL, 'chief')?.id).toBe('secret-request');
    expect(relayToolRegistry.resolve('projects', 'chief')?.id).toBe('chief');
    expect(relayToolRegistry.resolve('thread_report', 'session')?.id).toBe('worker-session');
    expect(relayToolRegistry.resolve('close_as_duplicate', 'session')?.id).toBe('worker-session');
    expect(relayToolRegistry.resolve('set_task_meta', 'build')?.id).toBe('worker-task-meta');
    expect(relayToolRegistry.resolve('create_skill', 'build')?.id).toBe('worker-skills');
    expect(relayToolRegistry.resolve('update_skill', 'review')?.id).toBe('worker-skills');
    expect(relayToolRegistry.resolve('remember', 'build')?.id).toBe('worker-memory');
  });

  test('preserves HTTP error contracts via registry dispatch', async () => {
    const s = bootServer();
    s.db
      .insert(step)
      .values([
        {
          id: 'step-chief-pending',
          buildId: 'missing-thread',
          kind: 'chief',
          status: 'pending',
          createdAt: 1,
          machineId: 'machine-1',
        },
        {
          id: 'step-session-orphan',
          buildId: 'missing-build',
          kind: 'session',
          status: 'pending',
          createdAt: 1,
          machineId: 'machine-1',
        },
      ])
      .run();

    const deps = depsOf(s);
    await expect(
      executeRelayToolCall(deps, 'machine-1', 'step-chief-pending', 'user_computer_nope', {}),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      executeRelayToolCall(deps, 'machine-1', 'step-chief-pending', 'get_schedule', {}),
    ).rejects.toMatchObject({
      status: 400,
      message: 'schedule tools require a plan or build step',
    });

    await expect(
      executeRelayToolCall(deps, 'machine-1', 'step-session-orphan', 'thread_report', {
        line: 'hi',
      }),
    ).rejects.toMatchObject({
      name: 'NotFoundError',
      message: 'build missing-build not found',
    });
  });
});
