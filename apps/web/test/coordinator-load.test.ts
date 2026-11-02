import { describe, expect, it } from 'vitest';
import { orchestrateThreadTitle } from '@cairn/shared';
import { coordinatorLoad, globalCoordinatorThread } from '../src/chief/coordinator-load.js';

const ok = (data: unknown = {}) => ({ isLoading: false, isError: false, data });
const failed = { isLoading: false, isError: true, data: undefined };
const pending = { isLoading: true, isError: false, data: undefined };

describe('coordinatorLoad', () => {
  it('a project with no conversation yet is ready, not an error', () => {
    expect(
      coordinatorLoad({ chief: ok(), coordinator: ok({ thread: null }), messages: pending, hasThread: false }),
    ).toBe('ready');
  });

  it('a failed conversation lookup is an error, not an empty project', () => {
    expect(
      coordinatorLoad({ chief: ok(), coordinator: failed, messages: pending, hasThread: false }),
    ).toBe('error');
  });

  it('failed messages of an existing conversation are an error', () => {
    expect(
      coordinatorLoad({ chief: ok(), coordinator: ok(), messages: failed, hasThread: true }),
    ).toBe('error');
  });

  it('a refetch error over cached data keeps showing the cached conversation', () => {
    expect(
      coordinatorLoad({
        chief: ok(),
        coordinator: { isLoading: false, isError: true, data: { thread: null } },
        messages: pending,
        hasThread: false,
      }),
    ).toBe('ready');
  });

  it('still loading while the lookup or the messages are pending', () => {
    expect(coordinatorLoad({ chief: ok(), coordinator: pending, messages: pending, hasThread: false })).toBe('loading');
    expect(coordinatorLoad({ chief: ok(), coordinator: ok(), messages: pending, hasThread: true })).toBe('loading');
  });
});

const thread = (id: string, title: string, createdAt: number, projectId: string | null = null) => ({
  id,
  title,
  createdAt,
  projectId,
  chiefId: 'chief-u-t',
  userId: 'u',
  teamId: 't',
  updatedAt: createdAt,
  lastTurnAt: null,
  session: { runtime: 'pi' as const, id: '', openedAt: createdAt },
  pendingSessionResumeAt: null,
  toolDefHashes: {},
  toolResultHashes: {},
  activeRun: null,
});

describe('globalCoordinatorThread', () => {
  it('stays on the oldest plain conversation when an orchestration or project thread is more recent', () => {
    const global = thread('chief-global', 'Plan the week', 1);
    const orchestration = thread('chief-orch', orchestrateThreadTitle(42), 9);
    const project = thread('chief-project', 'Fold turns', 8, 'proj-1');
    expect(globalCoordinatorThread([orchestration, project, global])?.id).toBe('chief-global');
  });

  it('falls back to the oldest thread when only orchestration threads exist, and to none when empty', () => {
    expect(
      globalCoordinatorThread([
        thread('b', orchestrateThreadTitle(2), 5),
        thread('a', orchestrateThreadTitle(1), 3),
      ])?.id,
    ).toBe('a');
    expect(globalCoordinatorThread([])).toBeNull();
  });
});
