import { eq } from 'drizzle-orm';
import { build, machine as machineTable, step, todo } from '../src/db/schema.js';
import type { FetchLike } from '../src/lib/github.js';
import { bootServer, claimedGeneration, issueApiKey, postProject, req } from './helpers.js';

export async function runningTask(opts: { githubFetch?: FetchLike } = {}) {
  const s = bootServer(opts);
  const projectId = await postProject(s.app);
  s.db
    .insert(todo)
    .values({
      id: 'task',
      teamId: s.team.id,
      projectId,
      title: 'Queue test',
      phase: 'building',
      phaseAt: 1,
      seqNum: 1,
      latestBuildId: 'build',
    })
    .run();
  s.db
    .insert(build)
    .values({
      id: 'build',
      todoId: 'task',
      withPlan: false,
      prevPhase: 'todo',
      triggerSource: 'user',
      createdAt: 1,
      changes: [],
    })
    .run();
  const key = await issueApiKey(s);
  const enrolled = await s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ teamId: s.team.id, name: 'queue-machine', cliVersion: '0.1.0' }),
  });
  const machine = (await enrolled.json()) as { machineId: string; token: string };
  s.db
    .update(machineTable)
    .set({ online: true })
    .where(eq(machineTable.id, machine.machineId))
    .run();
  const now = Date.now();
  s.db
    .insert(step)
    .values({
      id: 'running',
      buildId: 'build',
      kind: 'build',
      status: 'claimed',
      machineId: machine.machineId,
      sessionId: 'builder-session',
      createdAt: now,
      claimedAt: now,
    })
    .run();
  const send = (body: object) => req(s.app, 'POST', '/api/conversations/build/messages', body);
  const face = async () =>
    (await req(s.app, 'GET', '/api/conversations/build/messages')).json() as Promise<{
      messages: { id: string; content: unknown }[];
      steerPending: string[];
      queuedMessages?: { id: string; content: string }[];
    }>;
  const finish = (status: 'success' | 'stopped' | 'failed', stepId = 'running') =>
    s.app.request(`/api/machine/done/${stepId}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${machine.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        status,
        sessionId: 'builder-session',
        hasChanges: true,
        generation: claimedGeneration(s.db, stepId),
      }),
    });
  return { s, send, face, finish };
}

export type Task = Awaited<ReturnType<typeof runningTask>>;
