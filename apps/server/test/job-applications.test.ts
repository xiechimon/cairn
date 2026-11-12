import { CHIEF_TOOL_NAMES, MCP_TOOL_REGISTRY } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { openMemoryDb } from '../src/db/client.js';
import { chief, chiefMessage, chiefThread, jobApplication } from '../src/db/schema.js';
import { seed } from '../src/db/seed.js';
import { HttpError } from '../src/lib/errors.js';
import { createEphemeralSecretBox } from '../src/lib/secret-box.js';
import { isOwnerOnlyRoute } from '../src/lib/token-auth.js';
import { executeChiefTool } from '../src/services/chief-tools.js';
import { TeamStreamHub } from '../src/services/events.js';
import {
  answerAndReserve,
  beginBrowsing,
  buildJobPreview,
  JOB_PREVIEW_TTL_MS,
  JOB_SUBMIT_AFFIRMATIVE,
  type JobCaller,
  type JobFormInput,
  jobHostDecision,
  noteUnacceptedHost,
  openAttempt,
  postPreviewQuestion,
  previewValues,
  readFillableProfile,
  readJobCap,
  recordDelivery,
  recordOwnerAnswer,
  setJobCapLimit,
  writeJobHost,
  writeOwnerProfile,
} from '../src/services/job-applications.js';
import { createPairedDevice } from '../src/services/paired-devices.js';
import { bootServer } from './helpers.js';

const AT = Date.parse('2026-11-11T12:00:00.000Z');
const HOST = 'board.example';
const FORM: JobFormInput = {
  url: 'https://board.example/posting',
  pageHost: HOST,
  formActionHost: HOST,
  fieldRefs: ['name-1'],
  profileFieldIds: ['given-name'],
  controls: [{ ref: 'name-1', type: 'text' }],
};
const FILLABLE = [{ id: 'given-name', name: 'Given name', value: 'Example', fillable: true }];

function statusOf(run: () => void): number {
  try {
    run();
    return 0;
  } catch (error) {
    return error instanceof HttpError ? error.status : -1;
  }
}

function world() {
  const db = openMemoryDb();
  const seeded = seed(db);
  return { db, userId: seeded.user.id, teamId: seeded.team.id, user: seeded.user };
}

function allow(db: ReturnType<typeof world>['db'], userId: string): void {
  writeJobHost(db, 'owner', userId, HOST, 'allowed');
}

function profile(
  db: ReturnType<typeof world>['db'],
  userId: string,
  teamId: string,
  fields = FILLABLE,
): void {
  writeOwnerProfile(db, 'owner', { userId, teamId, fields, resumeAttachmentId: null });
}

function thread(db: ReturnType<typeof world>['db'], userId: string, teamId: string): string {
  const chiefId = `chief-${userId}`;
  const threadId = `chief-${userId}-thread`;
  db.insert(chief)
    .values({
      id: chiefId,
      userId,
      teamId,
      charter: '',
      watches: [],
      wakes: [],
      createdAt: AT,
    })
    .run();
  db.insert(chiefThread)
    .values({
      id: threadId,
      chiefId,
      userId,
      teamId,
      title: 'apply',
      createdAt: AT,
      updatedAt: AT,
      sessionRuntime: 'pi',
      sessionId: 'session',
      sessionOpenedAt: AT,
      toolDefHashes: {},
      toolResultHashes: {},
    })
    .run();
  return threadId;
}

function prepared(now = AT) {
  const row = world();
  profile(row.db, row.userId, row.teamId);
  allow(row.db, row.userId);
  const attempt = openAttempt(row.db, row.userId);
  beginBrowsing(row.db, attempt.id, HOST, now);
  const preview = buildJobPreview(row.db, attempt.id, FORM, now);
  const threadId = thread(row.db, row.userId, row.teamId);
  const posted = postPreviewQuestion(row.db, attempt.id, threadId, now, () => true);
  return {
    ...row,
    attemptId: attempt.id,
    threadId,
    questionId: posted.questionId,
    hash: preview.hash,
  };
}

describe('job application server gate', () => {
  test('host allow is owner-only and stays refused without acceptance', async () => {
    const { db, userId, teamId } = world();
    expect(jobHostDecision(db, userId, HOST)).toBe('refused');
    noteUnacceptedHost(db, 'owner', userId, 'other.example');
    expect(jobHostDecision(db, userId, 'other.example')).toBe('refused');
    for (const caller of ['agent', 'mcp', 'device'] as const satisfies readonly JobCaller[]) {
      expect(statusOf(() => writeJobHost(db, caller, userId, HOST, 'allowed'))).toBe(403);
    }
    expect(jobHostDecision(db, userId, HOST)).toBe('refused');
    expect(CHIEF_TOOL_NAMES.filter((name) => name.startsWith('job_'))).toEqual(['job_profile']);
    expect(MCP_TOOL_REGISTRY.some((tool) => tool.name.startsWith('job_'))).toBe(false);
    expect(isOwnerOnlyRoute('PUT', '/api/job-applications/hosts')).toBe(true);
    expect(isOwnerOnlyRoute('PUT', '/api/job-applications/profile')).toBe(true);
    expect(isOwnerOnlyRoute('PUT', '/api/job-applications/cap')).toBe(true);

    const ownerToken = 'owner-token-job-applications';
    const server = bootServer({ authToken: ownerToken });
    const device = createPairedDevice(server.db, { teamId: server.team.id, name: 'phone' });
    const body = JSON.stringify({ host: HOST, status: 'allowed' });
    const denied = await server.app.request('/api/job-applications/hosts', {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${device.token}`,
        'content-type': 'application/json',
      },
      body,
    });
    expect(denied.status).toBe(403);
    expect(jobHostDecision(server.db, server.user.id, HOST)).toBe('refused');
    const allowed = await server.app.request('/api/job-applications/hosts', {
      method: 'PUT',
      headers: { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' },
      body,
    });
    expect(allowed.status).toBe(200);
    expect(jobHostDecision(server.db, server.user.id, HOST)).toBe('allowed');
    expect(teamId).not.toBe('');
  });

  test('a paired device cannot confirm a job submit through the question route', async () => {
    const ownerToken = 'owner-token-job-confirm';
    const server = bootServer({ authToken: ownerToken });
    const device = createPairedDevice(server.db, { teamId: server.team.id, name: 'phone' });
    profile(server.db, server.user.id, server.team.id);
    allow(server.db, server.user.id);
    const attempt = openAttempt(server.db, server.user.id);
    beginBrowsing(server.db, attempt.id, HOST, AT);
    buildJobPreview(server.db, attempt.id, FORM, AT);
    const threadId = thread(server.db, server.user.id, server.team.id);
    const posted = postPreviewQuestion(server.db, attempt.id, threadId, AT, () => true);
    const answer = JSON.stringify({
      answers: [{ header: 'Submit', choices: [JOB_SUBMIT_AFFIRMATIVE] }],
    });
    const path = `/api/teams/${server.team.id}/chief/threads/${threadId}/questions/${posted.questionId}/answer`;
    const denied = await server.app.request(path, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${device.token}`,
        'content-type': 'application/json',
      },
      body: answer,
    });
    expect(denied.status).toBe(403);
    const pending = server.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.id, posted.questionId))
      .get();
    expect(JSON.parse(String(pending?.content)).status).toBe('pending');
    const unmarked = prepared();
    unmarked.db
      .update(chiefMessage)
      .set({
        content: JSON.stringify({
          kind: 'ask_user_question',
          requestId: unmarked.questionId,
          status: 'answered',
          questions: [
            {
              header: 'Submit',
              question: 'Given name',
              options: [{ label: JOB_SUBMIT_AFFIRMATIVE }],
            },
          ],
          answers: [{ header: 'Submit', choices: [JOB_SUBMIT_AFFIRMATIVE] }],
          askedFor: ['job_submit'],
        }),
      })
      .where(eq(chiefMessage.id, unmarked.questionId))
      .run();
    expect(
      answerAndReserve(
        unmarked.db,
        unmarked.attemptId,
        { questionId: unmarked.questionId, choices: [JOB_SUBMIT_AFFIRMATIVE] },
        FORM,
        AT,
      ),
    ).toMatchObject({ status: 'failed', reserved: false });
    expect(readJobCap(unmarked.db, unmarked.userId, AT).reserved).toBe(0);
    const allowed = await server.app.request(path, {
      method: 'POST',
      headers: { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' },
      body: answer,
    });
    expect(allowed.status).toBe(200);
    const stored = server.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.id, posted.questionId))
      .get();
    expect(JSON.parse(String(stored?.content))).toMatchObject({ answeredBy: 'person' });
    expect(
      answerAndReserve(
        server.db,
        attempt.id,
        { questionId: posted.questionId, choices: [JOB_SUBMIT_AFFIRMATIVE] },
        FORM,
        AT,
      ),
    ).toMatchObject({ status: 'submitting', reserved: true });
  });

  test('profile edit keeps fields when the resume is missing and an empty profile stays idle', () => {
    const { db, userId, teamId } = world();
    expect(openAttempt(db, userId).status).toBe('idle');
    for (const caller of ['agent', 'mcp', 'device'] as const) {
      expect(
        statusOf(() =>
          writeOwnerProfile(db, caller, {
            userId,
            teamId,
            fields: FILLABLE,
            resumeAttachmentId: null,
          }),
        ),
      ).toBe(403);
    }
    const saved = writeOwnerProfile(db, 'owner', {
      userId,
      teamId,
      fields: FILLABLE,
      resumeAttachmentId: 'missing-resume',
    });
    expect(saved.resumeAttachmentId).toBeNull();
    expect(saved.fields).toEqual(FILLABLE);
    expect(openAttempt(db, userId).status).toBe('reading');
  });

  test('job_profile returns only fields the owner marked fillable', async () => {
    const { db, userId, teamId, user } = world();
    writeOwnerProfile(db, 'owner', {
      userId,
      teamId,
      fields: [
        ...FILLABLE,
        { id: 'note', name: 'Private note', value: 'not-fillable-value', fillable: false },
      ],
      resumeAttachmentId: null,
    });
    const text = await executeChiefTool(
      {
        db,
        hub: new TeamStreamHub(),
        box: createEphemeralSecretBox(),
        user,
        reposDir: '/tmp/job-profile',
        attachmentsDir: '/tmp/job-profile',
        skillsDir: '/tmp/job-profile',
      },
      {
        teamId,
        userId,
        chiefId: 'chief',
        threadId: 'chief-thread',
        chiefAgentId: 'agent',
        conversationId: 'chief-thread',
      },
      'job_profile',
      {},
    );
    const parsed = JSON.parse(text) as { fields: { id: string; value: string }[] };
    expect(parsed.fields).toEqual([{ id: 'given-name', name: 'Given name', value: 'Example' }]);
    expect(text).not.toContain('not-fillable-value');
    expect(text).not.toContain('resume');
    expect(readFillableProfile(db, userId).fields).toEqual(parsed.fields);
  });

  test('preview build stores a server hash and drops values on a sensitive form', () => {
    const { db, userId, teamId } = world();
    profile(db, userId, teamId);
    allow(db, userId);
    const blocked = openAttempt(db, userId);
    beginBrowsing(db, blocked.id, HOST, AT);
    const password = buildJobPreview(
      db,
      blocked.id,
      { ...FORM, controls: [{ ref: 'secret', type: 'password' }] },
      AT,
    );
    expect(password.status).toBe('blocked');
    expect(previewValues(db, blocked.id)).toBeUndefined();
    const payment = openAttempt(db, userId);
    beginBrowsing(db, payment.id, HOST, AT);
    expect(
      buildJobPreview(
        db,
        payment.id,
        { ...FORM, controls: [{ ref: 'card', type: 'text', autocomplete: 'cc-number' }] },
        AT,
      ).status,
    ).toBe('blocked');
    const attempt = openAttempt(db, userId);
    beginBrowsing(db, attempt.id, HOST, AT);
    const built = buildJobPreview(
      db,
      attempt.id,
      { ...FORM, hash: 'caller-supplied' } as JobFormInput,
      AT,
    );
    expect(built.status).toBe('previewed');
    expect(built.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(built.hash).not.toBe('caller-supplied');
    expect(previewValues(db, attempt.id)).toEqual({ 'given-name': 'Example' });
    expect(JSON.stringify(previewValues(db, attempt.id))).not.toContain('prefilled');
  });

  test('repeated query values in a different order are a different posting', () => {
    const { db, userId, teamId } = world();
    profile(db, userId, teamId);
    allow(db, userId);
    const hashFor = (url: string) => {
      const attempt = openAttempt(db, userId);
      beginBrowsing(db, attempt.id, HOST, AT);
      return buildJobPreview(db, attempt.id, { ...FORM, url }, AT).hash;
    };
    const forward = hashFor('https://board.example/apply?job=123&job=456');
    expect(hashFor('https://board.example/apply?job=456&job=123')).not.toBe(forward);
    expect(hashFor('https://board.example/apply?page=1&job=123&job=456')).toBe(
      hashFor('https://board.example/apply?job=123&page=1&job=456'),
    );
  });

  test('ask_user push failure does not confirm', () => {
    const row = world();
    profile(row.db, row.userId, row.teamId);
    allow(row.db, row.userId);
    const attempt = openAttempt(row.db, row.userId);
    beginBrowsing(row.db, attempt.id, HOST, AT);
    buildJobPreview(row.db, attempt.id, FORM, AT);
    const threadId = thread(row.db, row.userId, row.teamId);
    const posted = postPreviewQuestion(row.db, attempt.id, threadId, AT, () => false);
    expect(posted.status).toBe('previewed');
    expect(posted.questionId.startsWith('ask-')).toBe(true);
    const message = row.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.id, posted.questionId))
      .get();
    expect(JSON.parse(String(message?.content))).toMatchObject({
      status: 'pending',
      requestId: posted.questionId,
    });
    expect(JSON.stringify(message?.content)).not.toContain('Example');
    expect(posted.status).not.toBe('submitted');
  });

  test('owner answer must match the question id, current hash, and affirmative choice', () => {
    const negative = prepared();
    recordOwnerAnswer(negative.db, 'owner', negative.questionId, {
      questionId: negative.questionId,
      choices: ['Do not submit'],
    });
    expect(
      answerAndReserve(
        negative.db,
        negative.attemptId,
        { questionId: negative.questionId, choices: ['Do not submit'] },
        FORM,
        AT,
      ),
    ).toMatchObject({ status: 'failed', reserved: false, clicked: false });
    expect(readJobCap(negative.db, negative.userId, AT).counted).toBe(0);

    const cancelled = prepared();
    recordOwnerAnswer(cancelled.db, 'owner', cancelled.questionId, {
      questionId: cancelled.questionId,
      cancelled: true,
    });
    expect(
      answerAndReserve(
        cancelled.db,
        cancelled.attemptId,
        { questionId: cancelled.questionId, cancelled: true },
        FORM,
        AT,
      ).status,
    ).toBe('failed');

    const wrong = prepared();
    recordOwnerAnswer(wrong.db, 'owner', wrong.questionId, {
      questionId: wrong.questionId,
      choices: [JOB_SUBMIT_AFFIRMATIVE],
    });
    expect(
      answerAndReserve(
        wrong.db,
        wrong.attemptId,
        { questionId: 'ask-00000000', choices: [JOB_SUBMIT_AFFIRMATIVE] },
        FORM,
        AT,
      ).status,
    ).toBe('failed');

    const expired = prepared();
    recordOwnerAnswer(expired.db, 'owner', expired.questionId, {
      questionId: expired.questionId,
      choices: [JOB_SUBMIT_AFFIRMATIVE],
    });
    expect(
      answerAndReserve(
        expired.db,
        expired.attemptId,
        { questionId: expired.questionId, choices: [JOB_SUBMIT_AFFIRMATIVE] },
        FORM,
        AT + JOB_PREVIEW_TTL_MS + 1,
      ).status,
    ).toBe('failed');

    const edited = prepared();
    recordOwnerAnswer(edited.db, 'owner', edited.questionId, {
      questionId: edited.questionId,
      choices: [JOB_SUBMIT_AFFIRMATIVE],
    });
    writeOwnerProfile(edited.db, 'owner', {
      userId: edited.userId,
      teamId: edited.teamId,
      fields: [{ ...FILLABLE[0], value: 'Changed' }],
      resumeAttachmentId: null,
    });
    expect(
      answerAndReserve(
        edited.db,
        edited.attemptId,
        { questionId: edited.questionId, choices: [JOB_SUBMIT_AFFIRMATIVE] },
        FORM,
        AT,
      ),
    ).toMatchObject({ status: 'failed', reserved: false, clicked: false });
    expect(readJobCap(edited.db, edited.userId, AT).reserved).toBe(0);

    const ok = prepared();
    recordOwnerAnswer(ok.db, 'owner', ok.questionId, {
      questionId: ok.questionId,
      choices: [JOB_SUBMIT_AFFIRMATIVE],
    });
    expect(
      answerAndReserve(
        ok.db,
        ok.attemptId,
        { questionId: ok.questionId, choices: [JOB_SUBMIT_AFFIRMATIVE] },
        FORM,
        AT,
      ),
    ).toMatchObject({ status: 'submitting', reserved: true, clicked: false });
    expect(readJobCap(ok.db, ok.userId, AT)).toMatchObject({ counted: 0, reserved: 1 });
  });

  test('submit reserves before a click and counts delivered or unknown', () => {
    const changed = prepared();
    recordOwnerAnswer(changed.db, 'owner', changed.questionId, {
      questionId: changed.questionId,
      choices: [JOB_SUBMIT_AFFIRMATIVE],
    });
    expect(
      answerAndReserve(
        changed.db,
        changed.attemptId,
        { questionId: changed.questionId, choices: [JOB_SUBMIT_AFFIRMATIVE] },
        { ...FORM, url: 'https://board.example/other' },
        AT,
      ),
    ).toMatchObject({ status: 'browsing', reserved: false, clicked: false });
    expect(previewValues(changed.db, changed.attemptId)).toBeNull();

    const crossHost = prepared();
    recordOwnerAnswer(crossHost.db, 'owner', crossHost.questionId, {
      questionId: crossHost.questionId,
      choices: [JOB_SUBMIT_AFFIRMATIVE],
    });
    expect(
      answerAndReserve(
        crossHost.db,
        crossHost.attemptId,
        { questionId: crossHost.questionId, choices: [JOB_SUBMIT_AFFIRMATIVE] },
        { ...FORM, formActionHost: 'other.example' },
        AT,
      ),
    ).toMatchObject({ status: 'blocked', reserved: false, clicked: false });
    expect(readJobCap(crossHost.db, crossHost.userId, AT).counted).toBe(0);

    const revoked = prepared();
    recordOwnerAnswer(revoked.db, 'owner', revoked.questionId, {
      questionId: revoked.questionId,
      choices: [JOB_SUBMIT_AFFIRMATIVE],
    });
    writeJobHost(revoked.db, 'owner', revoked.userId, HOST, 'refused');
    expect(
      answerAndReserve(
        revoked.db,
        revoked.attemptId,
        { questionId: revoked.questionId, choices: [JOB_SUBMIT_AFFIRMATIVE] },
        FORM,
        AT,
      ).status,
    ).toBe('blocked');
    expect(readJobCap(revoked.db, revoked.userId, AT).reserved).toBe(0);

    const first = prepared();
    const second = openAttempt(first.db, first.userId);
    beginBrowsing(first.db, second.id, HOST, AT);
    buildJobPreview(first.db, second.id, FORM, AT);
    const secondQuestion = postPreviewQuestion(first.db, second.id, first.threadId, AT, () => true);
    setJobCapLimit(first.db, 'owner', first.userId, AT, 1);
    recordOwnerAnswer(first.db, 'owner', first.questionId, {
      questionId: first.questionId,
      choices: [JOB_SUBMIT_AFFIRMATIVE],
    });
    recordOwnerAnswer(first.db, 'owner', secondQuestion.questionId, {
      questionId: secondQuestion.questionId,
      choices: [JOB_SUBMIT_AFFIRMATIVE],
    });
    answerAndReserve(
      first.db,
      first.attemptId,
      { questionId: first.questionId, choices: [JOB_SUBMIT_AFFIRMATIVE] },
      FORM,
      AT,
    );
    expect(
      answerAndReserve(
        first.db,
        second.id,
        { questionId: secondQuestion.questionId, choices: [JOB_SUBMIT_AFFIRMATIVE] },
        FORM,
        AT,
      ),
    ).toMatchObject({ status: 'blocked', reserved: false, clicked: false });
    expect(readJobCap(first.db, first.userId, AT)).toMatchObject({ reserved: 1, counted: 0 });

    expect(recordDelivery(first.db, first.attemptId, 'delivered', AT)).toMatchObject({
      status: 'submitted',
      counted: 1,
    });
    expect(
      answerAndReserve(
        first.db,
        first.attemptId,
        { questionId: first.questionId, choices: [JOB_SUBMIT_AFFIRMATIVE] },
        FORM,
        AT,
      ).refused,
    ).toBe(true);

    const unknown = prepared(AT + 86_400_000);
    recordOwnerAnswer(unknown.db, 'owner', unknown.questionId, {
      questionId: unknown.questionId,
      choices: [JOB_SUBMIT_AFFIRMATIVE],
    });
    answerAndReserve(
      unknown.db,
      unknown.attemptId,
      { questionId: unknown.questionId, choices: [JOB_SUBMIT_AFFIRMATIVE] },
      FORM,
      AT + 86_400_000,
    );
    expect(recordDelivery(unknown.db, unknown.attemptId, 'unknown', AT + 86_400_000)).toMatchObject(
      {
        status: 'blocked',
        counted: 1,
      },
    );
    const retry = openAttempt(unknown.db, unknown.userId);
    beginBrowsing(unknown.db, retry.id, HOST, AT + 86_400_000);
    buildJobPreview(unknown.db, retry.id, FORM, AT + 86_400_000);
    const retryQuestion = postPreviewQuestion(
      unknown.db,
      retry.id,
      unknown.threadId,
      AT + 86_400_000,
      () => true,
    );
    expect(
      answerAndReserve(
        unknown.db,
        retry.id,
        { questionId: retryQuestion.questionId, choices: [JOB_SUBMIT_AFFIRMATIVE] },
        FORM,
        AT + 86_400_000,
      ).refused,
    ).toBe(true);
    expect(readJobCap(unknown.db, unknown.userId, AT + 86_400_000).counted).toBe(1);
  });

  test('cap read uses the stored UTC day and the agent cannot raise it', () => {
    const { db, userId } = world();
    expect(statusOf(() => setJobCapLimit(db, 'agent', userId, AT, 9))).toBe(403);
    expect(statusOf(() => setJobCapLimit(db, 'mcp', userId, AT, 9))).toBe(403);
    setJobCapLimit(db, 'owner', userId, AT, 7);
    const today = readJobCap(db, userId, AT);
    expect(today).toMatchObject({ utcDay: '2026-11-11', limit: 7, counted: 0, reserved: 0 });
    const tomorrow = readJobCap(db, userId, AT + 86_400_000);
    expect(tomorrow.utcDay).toBe('2026-11-12');
    expect(tomorrow.counted).toBe(0);
    expect(readJobCap(db, userId, AT).counted).toBe(0);
    expect(readJobCap(db, userId, AT).limit).toBe(7);
  });

  test('the production question answer route is what the confirm gate reads', async () => {
    const server = bootServer();
    profile(server.db, server.user.id, server.team.id);
    allow(server.db, server.user.id);
    const attempt = openAttempt(server.db, server.user.id);
    beginBrowsing(server.db, attempt.id, HOST, AT);
    buildJobPreview(server.db, attempt.id, FORM, AT);
    const threadId = thread(server.db, server.user.id, server.team.id);
    const posted = postPreviewQuestion(server.db, attempt.id, threadId, AT, () => true);
    const answered = await server.app.request(
      `/api/teams/${server.team.id}/chief/threads/${threadId}/questions/${posted.questionId}/answer`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          answers: [{ header: 'Submit', choices: [JOB_SUBMIT_AFFIRMATIVE] }],
        }),
      },
    );
    expect(answered.status).toBe(200);
    expect(
      answerAndReserve(
        server.db,
        attempt.id,
        { questionId: posted.questionId, choices: ['not the stored answer'] },
        FORM,
        AT,
      ),
    ).toMatchObject({ status: 'submitting', clicked: false });
  });

  test('a late delivery commits the timeout settlement before rejecting', () => {
    const row = prepared();
    recordOwnerAnswer(row.db, 'owner', row.questionId, {
      questionId: row.questionId,
      choices: [JOB_SUBMIT_AFFIRMATIVE],
    });
    answerAndReserve(
      row.db,
      row.attemptId,
      { questionId: row.questionId, choices: [JOB_SUBMIT_AFFIRMATIVE] },
      FORM,
      AT,
    );
    const late = AT + JOB_PREVIEW_TTL_MS + 1;
    expect(statusOf(() => recordDelivery(row.db, row.attemptId, 'delivered', late))).toBe(409);
    const doc = storedDoc(row.db, row.userId);
    expect(doc.attempts[row.attemptId]).toMatchObject({ status: 'blocked', delivery: 'unknown' });
    expect(doc.caps['2026-11-11']).toMatchObject({ reserved: 0, counted: 1 });
  });

  test('beginBrowsing settles an abandoned submit before checking the cap', () => {
    const row = prepared();
    recordOwnerAnswer(row.db, 'owner', row.questionId, {
      questionId: row.questionId,
      choices: [JOB_SUBMIT_AFFIRMATIVE],
    });
    answerAndReserve(
      row.db,
      row.attemptId,
      { questionId: row.questionId, choices: [JOB_SUBMIT_AFFIRMATIVE] },
      FORM,
      AT,
    );
    const late = AT + JOB_PREVIEW_TTL_MS + 1;
    const next = openAttempt(row.db, row.userId);
    beginBrowsing(row.db, next.id, HOST, late);
    const doc = storedDoc(row.db, row.userId);
    expect(doc.attempts[row.attemptId]).toMatchObject({ status: 'blocked', delivery: 'unknown' });
    expect(doc.caps['2026-11-11']).toMatchObject({ reserved: 0, counted: 1 });
  });

  test('job application writes reject malformed and null JSON with 400', async () => {
    const ownerToken = 'owner-token-job-json';
    const server = bootServer({ authToken: ownerToken });
    const headers = { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' };
    for (const path of [
      '/api/job-applications/hosts',
      '/api/job-applications/profile',
      '/api/job-applications/cap',
    ]) {
      const malformed = await server.app.request(path, { method: 'PUT', headers, body: '{' });
      expect(malformed.status, path).toBe(400);
      const empty = await server.app.request(path, { method: 'PUT', headers, body: 'null' });
      expect(empty.status, path).toBe(400);
    }
  });
});

function storedDoc(db: ReturnType<typeof world>['db'], userId: string) {
  const row = db.select().from(jobApplication).where(eq(jobApplication.userId, userId)).get();
  return row?.document as unknown as {
    attempts: Record<string, { status: string; delivery: string | null }>;
    caps: Record<string, { reserved: number; counted: number }>;
  };
}
