import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { expect, onTestFinished } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { type Db, openDbWithHandle } from '../src/db/client.js';
import {
  apiKey,
  build,
  chief,
  chiefMessage,
  chiefThread,
  machine,
  message,
  phone,
  plan,
  project,
  schedule,
  step,
  team,
  todo,
  user,
} from '../src/db/schema.js';
import { toTeamRecord, toUserRecord } from '../src/db/seed.js';
import { sha256Hex } from '../src/lib/crypto.js';
import { hashCredential } from '../src/lib/hash.js';
import { bootServer, redeemTestPairing } from './helpers.js';

const fixtureTime = 1;

export function fixtureRequest(
  server: ReturnType<typeof bootServer>,
  method: string,
  path: string,
  {
    bearer,
    body,
    headers,
  }: { bearer?: string; body?: unknown; headers?: RequestInit['headers'] } = {},
): Promise<Response> {
  const requestHeaders = new Headers(headers);
  if (bearer !== undefined) requestHeaders.set('authorization', `Bearer ${bearer}`);
  if (body !== undefined) requestHeaders.set('content-type', 'application/json');
  return Promise.resolve(
    server.app.request(path, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

async function seedTeam(db: Db, suffix: 'a' | 'b', dir: string) {
  const teamId = `team-${suffix}`;
  const userId = `user-${suffix}`;
  const runnerId = `runner-${suffix}`;
  const ownerToken = `fixture-owner-${suffix}`;
  const runnerToken = `fixture-runner-${suffix}`;
  const keyToken = `fixture-key-${suffix}`;
  const projectId = `project-${suffix}`;
  const todoId = `todo-${suffix}`;
  const buildId = `build-${suffix}`;
  const planId = `plan-${suffix}`;
  const stepId = `step-${suffix}`;
  const chiefId = `chief-record-${suffix}`;
  const threadId = `chief-${suffix}`;
  const chiefStepId = `step-chief-${suffix}`;
  const phoneId = `phone-${suffix}`;
  const scheduleId = `schedule-${suffix}`;

  const teamRow = db
    .insert(team)
    .values({ id: teamId, name: teamId, createdAt: fixtureTime })
    .returning()
    .get();
  const userRow = db.insert(user).values({ id: userId, displayName: userId }).returning().get();
  db.insert(project).values({ id: projectId, name: projectId, teamId }).run();
  db.insert(todo)
    .values({
      id: todoId,
      teamId,
      projectId,
      title: todoId,
      phase: 'building',
      phaseAt: fixtureTime,
      seqNum: 1,
      latestBuildId: buildId,
    })
    .run();
  db.insert(build)
    .values({
      id: buildId,
      todoId,
      withPlan: false,
      triggerSource: 'user',
      createdAt: fixtureTime,
    })
    .run();
  db.insert(plan)
    .values({ id: planId, buildId, content: `fixture plan ${suffix}`, createdAt: fixtureTime })
    .run();
  db.insert(message)
    .values({
      id: `message-${suffix}`,
      conversationId: buildId,
      role: 'user',
      content: `fixture build transcript ${suffix}`,
      createdAt: fixtureTime,
    })
    .run();
  db.insert(chief).values({ id: chiefId, userId, teamId, createdAt: fixtureTime }).run();
  db.insert(chiefThread)
    .values({
      id: threadId,
      chiefId,
      userId,
      teamId,
      title: threadId,
      createdAt: fixtureTime,
      updatedAt: fixtureTime,
      sessionId: '',
      sessionOpenedAt: fixtureTime,
    })
    .run();
  db.insert(chiefMessage)
    .values({
      id: `chief-message-${suffix}`,
      threadId,
      role: 'user',
      content: `fixture chief transcript ${suffix}`,
      createdAt: fixtureTime,
    })
    .run();
  db.insert(machine)
    .values({
      id: runnerId,
      teamId,
      name: runnerId,
      tokenHash: hashCredential(runnerToken),
      capabilities: { osPlatform: 'darwin', mcpServers: [], skills: [] },
    })
    .run();
  db.insert(step)
    .values([
      {
        id: stepId,
        buildId,
        kind: 'session',
        machineId: runnerId,
        status: 'claimed',
        claimedAt: fixtureTime,
        createdAt: fixtureTime,
      },
      {
        id: chiefStepId,
        buildId: threadId,
        kind: 'chief',
        machineId: runnerId,
        status: 'claimed',
        claimedAt: fixtureTime,
        createdAt: fixtureTime,
      },
    ])
    .run();
  db.insert(phone)
    .values({
      id: phoneId,
      teamId,
      machineId: runnerId,
      platform: 'android',
      deviceId: `phone-device-${suffix}`,
      name: phoneId,
      handoffReason: 'model',
      handoffStepId: stepId,
      handoffRequestedAt: fixtureTime,
      createdAt: fixtureTime,
      updatedAt: fixtureTime,
    })
    .run();
  db.insert(schedule)
    .values({
      id: scheduleId,
      teamId,
      projectId,
      todoId,
      kind: 'once',
      at: 4_070_908_800_000,
      tz: 'UTC',
      createdBy: userId,
    })
    .run();
  db.insert(apiKey)
    .values({
      id: `key-${suffix}`,
      teamId,
      name: `key-${suffix}`,
      keyHash: sha256Hex(keyToken),
      masked: 'fixture',
      gitAccess: true,
      mcpAccess: false,
      machineAccess: true,
      toolGrants: { read: [], write: [] },
      createdAt: fixtureTime,
    })
    .run();
  const server = bootServer({
    db,
    identity: { team: toTeamRecord(teamRow), user: toUserRecord(userRow) },
    authToken: ownerToken,
    reposDir: join(dir, suffix, 'repos'),
    attachmentsDir: join(dir, suffix, 'attachments'),
    skillsDir: join(dir, suffix, 'skills'),
    skillSourcesPath: join(dir, suffix, 'skill-sources.json'),
    mcpConfigPath: join(dir, suffix, 'mcp.json'),
    backupStatusPath: join(dir, suffix, 'backup.json'),
    deployRecordPath: join(dir, suffix, 'deploy.json'),
    remote: { environmentId: `00000000-0000-4000-8000-00000000000${suffix === 'a' ? 1 : 2}` },
    vapidKeys: null,
    webDir: null,
    accessVerifier: async (assertion) =>
      assertion === `fixture-access-${suffix}`
        ? {
            kind: 'owner',
            email: `owner-${suffix}@example.invalid`,
            expiresAt: Date.now() + 60_000,
          }
        : { kind: 'invalid' },
  });
  const grant = await fixtureRequest(server, 'POST', '/api/remote/pairing', { bearer: ownerToken });
  expect(grant.status).toBe(201);
  const { code } = (await grant.json()) as { code: string };
  const paired = await redeemTestPairing(server.app, code, `device-${suffix}`);
  expect(paired.status).toBe(201);
  const { token: deviceToken, deviceId } = (await paired.json()) as {
    token: string;
    deviceId: string;
  };
  const deviceCookie = paired.headers
    .getSetCookie()
    .find((value) => value.startsWith('cairn_auth='))
    ?.split(';')[0];
  if (!deviceCookie) throw new Error('Fixture pairing did not issue a device cookie');
  return {
    server,
    teamId,
    userId,
    ownerToken,
    runnerId,
    runnerToken,
    keyToken,
    deviceId,
    deviceToken,
    deviceCookie,
    projectId,
    todoId,
    buildId,
    planId,
    stepId,
    chiefId,
    threadId,
    chiefStepId,
    phoneId,
    scheduleId,
  };
}

export async function twoTeamWorld() {
  const { db, close } = openDbWithHandle(':memory:');
  onTestFinished(close);
  const dir = makeTestTempDir('team-scope-');
  onTestFinished(() => {
    releaseTestTempDir(dir);
  });
  const a = await seedTeam(db, 'a', dir);
  const b = await seedTeam(db, 'b', dir);
  return { db, a, b };
}

export type ScopeWorld = Awaited<ReturnType<typeof twoTeamWorld>>;
export type ScopeTeam = ScopeWorld['a'];

export function snapshotTeam(world: ScopeWorld, member: ScopeTeam) {
  const { db } = world;
  return {
    project: db.select().from(project).where(eq(project.id, member.projectId)).get(),
    todo: db.select().from(todo).where(eq(todo.id, member.todoId)).get(),
    build: db.select().from(build).where(eq(build.id, member.buildId)).get(),
    step: db.select().from(step).where(eq(step.id, member.stepId)).get(),
    chiefStep: db.select().from(step).where(eq(step.id, member.chiefStepId)).get(),
    messages: db.select().from(message).where(eq(message.conversationId, member.buildId)).all(),
    chiefMessages: db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.threadId, member.threadId))
      .all(),
    phone: db.select().from(phone).where(eq(phone.id, member.phoneId)).get(),
    schedule: db.select().from(schedule).where(eq(schedule.id, member.scheduleId)).get(),
    runner: db.select().from(machine).where(eq(machine.id, member.runnerId)).get(),
  };
}
