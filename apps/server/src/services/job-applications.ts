import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { attachment, chiefMessage, jobApplication } from '../db/schema.js';
import { sha256Hex } from '../lib/crypto.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId } from '../lib/ids.js';

export const JOB_CAP_DEFAULT = 5;
export const JOB_PREVIEW_TTL_MS = 15 * 60 * 1000;
export const JOB_SUBMIT_AFFIRMATIVE = 'Submit this application';
const NEGATIVE = 'Do not submit';
const SENSITIVE = new Set([
  'username',
  'one-time-code',
  'cc-number',
  'cc-name',
  'cc-exp',
  'cc-csc',
]);
export type JobCaller = 'owner' | 'agent' | 'mcp' | 'device';
export interface JobFormInput {
  url: string;
  pageHost: string;
  formActionHost: string;
  fieldRefs: string[];
  profileFieldIds: string[];
  controls: { ref: string; type?: string; autocomplete?: string; payment?: boolean }[];
}
export interface JobAnswer {
  questionId: string;
  choices?: string[];
  cancelled?: boolean;
}
interface Field {
  id: string;
  name: string;
  value: string;
  fillable: boolean;
}
interface Attempt {
  status: string;
  previewHash: string | null;
  questionId: string | null;
  delivery: 'delivered' | 'unknown' | null;
  capDay: string | null;
}
interface Preview {
  url: string;
  pageHost: string;
  formActionHost: string;
  fieldRefs: string[];
  profileFieldIds: string[];
  hash: string;
  values: Record<string, string> | null;
  expiresAt: number;
}
interface Cap {
  limit: number;
  reserved: number;
  counted: number;
}
interface Doc {
  profile: { fields: Field[]; resumeAttachmentId: string | null; revision: number } | null;
  hosts: Record<string, 'proposed' | 'allowed' | 'refused'>;
  caps: Record<string, Cap>;
  attempts: Record<string, Attempt>;
  previews: Record<string, Preview>;
}

function ownerOnly(caller: JobCaller): void {
  if (caller !== 'owner')
    throw new HttpError(403, 'only the owner can write job application state');
}
function hostOf(raw: string): string {
  const host = raw.trim().toLowerCase().replace(/\.$/, '');
  const label = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
  if (!new RegExp(`^${label}(?:\\.${label})+$`).test(host))
    throw new HttpError(400, 'invalid host');
  return host;
}
function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
function empty(): Doc {
  return { profile: null, hosts: {}, caps: {}, attempts: {}, previews: {} };
}
function load(db: Db, userId: string): Doc {
  const row = db.select().from(jobApplication).where(eq(jobApplication.userId, userId)).get();
  return row === undefined ? empty() : (structuredClone(row.document) as unknown as Doc);
}
function save(db: Db, userId: string, doc: Doc): void {
  const document = doc as unknown as Record<string, unknown>;
  db.insert(jobApplication)
    .values({ userId, document })
    .onConflictDoUpdate({ target: jobApplication.userId, set: { document } })
    .run();
}
function fieldsOf(value: unknown): Field[] {
  if (!Array.isArray(value)) throw new HttpError(400, 'invalid profile fields');
  return value.map((field) => {
    if (field === null || typeof field !== 'object')
      throw new HttpError(400, 'invalid profile fields');
    const row = field as Record<string, unknown>;
    const ok =
      typeof row.id === 'string' &&
      row.id.trim() !== '' &&
      typeof row.name === 'string' &&
      typeof row.value === 'string' &&
      typeof row.fillable === 'boolean';
    if (!ok) throw new HttpError(400, 'invalid profile fields');
    return {
      id: row.id as string,
      name: row.name as string,
      value: row.value as string,
      fillable: row.fillable as boolean,
    };
  });
}
function limitOf(doc: Doc): number {
  const days = Object.keys(doc.caps).sort();
  return doc.caps[days[days.length - 1] ?? '']?.limit ?? JOB_CAP_DEFAULT;
}
function capOf(doc: Doc, day: string): Cap {
  return doc.caps[day] ?? { limit: limitOf(doc), reserved: 0, counted: 0 };
}
function found(db: Db, attemptId: string): { userId: string; doc: Doc } {
  for (const row of db.select().from(jobApplication).all()) {
    const doc = structuredClone(row.document) as unknown as Doc;
    if (doc.attempts?.[attemptId] !== undefined) return { userId: row.userId, doc };
  }
  throw new HttpError(404, `attempt ${attemptId}`);
}
function readyResume(db: Db, teamId: string, id: string): boolean {
  return (
    db
      .select({ id: attachment.id })
      .from(attachment)
      .where(
        and(eq(attachment.id, id), eq(attachment.teamId, teamId), eq(attachment.status, 'ready')),
      )
      .get() !== undefined
  );
}

export function jobHostDecision(db: Db, userId: string, host: string): 'allowed' | 'refused' {
  return load(db, userId).hosts[hostOf(host)] === 'allowed' ? 'allowed' : 'refused';
}
export function noteUnacceptedHost(db: Db, caller: JobCaller, userId: string, host: string): void {
  ownerOnly(caller);
  const doc = load(db, userId);
  const normalized = hostOf(host);
  if (doc.hosts[normalized] === undefined) doc.hosts[normalized] = 'proposed';
  save(db, userId, doc);
}
export function writeJobHost(
  db: Db,
  caller: JobCaller,
  userId: string,
  host: string,
  status: 'allowed' | 'refused',
): void {
  ownerOnly(caller);
  const doc = load(db, userId);
  doc.hosts[hostOf(host)] = status;
  save(db, userId, doc);
}
export function writeOwnerProfile(
  db: Db,
  caller: JobCaller,
  input: { userId: string; teamId: string; fields: unknown; resumeAttachmentId: string | null },
) {
  ownerOnly(caller);
  const fields = fieldsOf(input.fields);
  const resume =
    input.resumeAttachmentId !== null && readyResume(db, input.teamId, input.resumeAttachmentId)
      ? input.resumeAttachmentId
      : null;
  const doc = load(db, input.userId);
  const revision = (doc.profile?.revision ?? 0) + 1;
  doc.profile = { fields, resumeAttachmentId: resume, revision };
  save(db, input.userId, doc);
  return { fields, resumeAttachmentId: resume, revision };
}
export function readFillableProfile(db: Db, userId: string) {
  const fields = (load(db, userId).profile?.fields ?? []).filter((field) => field.fillable);
  return { fields: fields.map(({ id, name, value }) => ({ id, name, value })) };
}
export function readJobCap(db: Db, userId: string, now: number) {
  const utcDay = dayOf(now);
  const cap = capOf(load(db, userId), utcDay);
  return { utcDay, limit: cap.limit, reserved: cap.reserved, counted: cap.counted };
}
export function setJobCapLimit(
  db: Db,
  caller: JobCaller,
  userId: string,
  now: number,
  limit: number,
): void {
  ownerOnly(caller);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new HttpError(400, 'invalid cap');
  const doc = load(db, userId);
  const day = dayOf(now);
  doc.caps[day] = { ...capOf(doc, day), limit };
  save(db, userId, doc);
}
export function openAttempt(db: Db, userId: string): { id: string; status: 'idle' | 'reading' } {
  const doc = load(db, userId);
  const status = doc.profile !== null && doc.profile.fields.length > 0 ? 'reading' : 'idle';
  const id = newRecordId();
  doc.attempts[id] = { status, previewHash: null, questionId: null, delivery: null, capDay: null };
  save(db, userId, doc);
  return { id, status };
}
export function beginBrowsing(
  db: Db,
  attemptId: string,
  host: string,
  now: number,
): { status: string } {
  const { userId, doc } = found(db, attemptId);
  const attempt = doc.attempts[attemptId];
  if (attempt?.status !== 'reading') throw new HttpError(409, 'attempt is not reading');
  const normalized = hostOf(host);
  const cap = capOf(doc, dayOf(now));
  const blocked = doc.hosts[normalized] !== 'allowed' || cap.counted + cap.reserved >= cap.limit;
  attempt.status = blocked ? 'blocked' : 'browsing';
  save(db, userId, doc);
  return { status: attempt.status };
}
function sensitive(control: JobFormInput['controls'][number]): boolean {
  const tokens = control.autocomplete?.toLowerCase().split(/\s+/) ?? [];
  return (
    control.payment === true ||
    control.type?.toLowerCase() === 'password' ||
    tokens.some((token) => SENSITIVE.has(token))
  );
}
function canonicalUrl(raw: string): { url: string; host: string } | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '')
      return null;
    parsed.search = '';
    parsed.hash = '';
    return { url: parsed.toString(), host: parsed.hostname.toLowerCase() };
  } catch {
    return null;
  }
}
function chosen(profile: Doc['profile'], ids: string[]): Field[] | null {
  if (profile === null) return null;
  const fields = ids.map(
    (id) => profile.fields.find((field) => field.id === id && field.fillable) ?? null,
  );
  if (fields.some((field) => field === null)) return null;
  return fields.filter((field) => field !== null);
}
function digest(
  page: { url: string; pageHost: string; formActionHost: string },
  refs: string[],
  fields: Field[],
  profile: NonNullable<Doc['profile']>,
): string {
  return sha256Hex(
    JSON.stringify({
      url: page.url,
      pageHost: page.pageHost,
      formActionHost: page.formActionHost,
      fieldRefs: [...refs].sort(),
      fields: [...fields]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((field) => [field.id, field.value]),
      profileRevision: profile.revision,
      resumeAttachmentId: profile.resumeAttachmentId,
    }),
  );
}
export function buildJobPreview(db: Db, attemptId: string, input: JobFormInput, now: number) {
  const { userId, doc } = found(db, attemptId);
  const attempt = doc.attempts[attemptId];
  if (attempt?.status !== 'browsing') throw new HttpError(409, 'attempt is not browsing');
  const page = canonicalUrl(input.url);
  const pageHost = hostOf(input.pageHost);
  const formActionHost = hostOf(input.formActionHost);
  const fields = chosen(doc.profile, input.profileFieldIds);
  const blocked =
    page === null ||
    page.host !== pageHost ||
    formActionHost !== pageHost ||
    doc.hosts[pageHost] !== 'allowed' ||
    input.controls.some(sensitive) ||
    fields === null ||
    doc.profile === null;
  if (blocked || page === null || fields === null || doc.profile === null) {
    attempt.status = 'blocked';
    save(db, userId, doc);
    return { status: 'blocked', hash: '' };
  }
  const hash = digest(
    { url: page.url, pageHost, formActionHost },
    input.fieldRefs,
    fields,
    doc.profile,
  );
  doc.previews[attemptId] = {
    url: page.url,
    pageHost,
    formActionHost,
    fieldRefs: input.fieldRefs,
    profileFieldIds: input.profileFieldIds,
    hash,
    values: Object.fromEntries(fields.map((field) => [field.id, field.value])),
    expiresAt: now + JOB_PREVIEW_TTL_MS,
  };
  attempt.status = 'previewed';
  attempt.previewHash = hash;
  save(db, userId, doc);
  return { status: 'previewed', hash };
}
export function previewValues(
  db: Db,
  attemptId: string,
): Record<string, string> | null | undefined {
  return found(db, attemptId).doc.previews[attemptId]?.values;
}
export function postPreviewQuestion(
  db: Db,
  attemptId: string,
  threadId: string,
  now: number,
  push: (id: string) => boolean,
) {
  const { userId, doc } = found(db, attemptId);
  const attempt = doc.attempts[attemptId];
  const preview = doc.previews[attemptId];
  if (attempt?.status !== 'previewed' || preview === undefined)
    throw new HttpError(409, 'attempt is not previewed');
  const questionId = `ask-${randomBytes(8).toString('hex')}`;
  const question = preview.profileFieldIds
    .map((id) => doc.profile?.fields.find((field) => field.id === id)?.name ?? id)
    .join(', ');
  db.insert(chiefMessage)
    .values({
      id: questionId,
      threadId,
      role: 'assistant',
      content: {
        kind: 'ask_user_question',
        requestId: questionId,
        status: 'pending',
        questions: [
          {
            header: 'Submit',
            question,
            options: [{ label: JOB_SUBMIT_AFFIRMATIVE }, { label: NEGATIVE }],
          },
        ],
        answers: null,
        askedFor: ['job_submit'],
      },
      createdAt: now,
    })
    .run();
  attempt.questionId = questionId;
  let pushed = false;
  try {
    pushed = push(questionId) === true;
  } catch {
    pushed = false;
  }
  if (pushed) attempt.status = 'confirming';
  save(db, userId, doc);
  return { status: pushed ? 'confirming' : 'previewed', questionId };
}
function sameList(left: readonly string[], right: readonly string[]): boolean {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((item, index) => item === b[index]);
}
function busy(doc: Doc, hash: string): boolean {
  return Object.values(doc.attempts).some(
    (row) =>
      row.previewHash === hash &&
      (row.status === 'submitted' ||
        row.status === 'submitting' ||
        (row.status === 'blocked' && row.delivery === 'unknown')),
  );
}
export function answerAndReserve(
  db: Db,
  attemptId: string,
  answer: JobAnswer,
  live: JobFormInput,
  now: number,
) {
  return db.transaction(() => {
    const { userId, doc } = found(db, attemptId);
    const attempt = doc.attempts[attemptId];
    const preview = doc.previews[attemptId];
    if (attempt === undefined || preview === undefined)
      throw new HttpError(404, `attempt ${attemptId}`);
    if (
      attempt.status === 'submitted' ||
      (attempt.status === 'blocked' && attempt.delivery === 'unknown')
    ) {
      return { status: attempt.status, reserved: false, clicked: false as const, refused: true };
    }
    if (attempt.status !== 'confirming' && attempt.status !== 'previewed') {
      throw new HttpError(409, 'attempt is not waiting for confirmation');
    }
    const stop = (status: string, refused = false) => {
      preview.values = null;
      attempt.status = status;
      save(db, userId, doc);
      return {
        status,
        reserved: false,
        clicked: false as const,
        ...(refused ? { refused: true } : {}),
      };
    };
    const affirmative =
      answer.cancelled !== true &&
      answer.choices?.length === 1 &&
      answer.choices[0] === JOB_SUBMIT_AFFIRMATIVE;
    if (busy(doc, preview.hash)) return stop('blocked', true);
    if (answer.questionId !== attempt.questionId || !affirmative || now > preview.expiresAt)
      return stop('failed');
    const pageHost = hostOf(live.pageHost);
    const formActionHost = hostOf(live.formActionHost);
    const page = canonicalUrl(live.url);
    if (formActionHost !== pageHost) return stop('blocked');
    if (
      page === null ||
      page.url !== preview.url ||
      pageHost !== preview.pageHost ||
      formActionHost !== preview.formActionHost ||
      !sameList(live.fieldRefs, preview.fieldRefs)
    ) {
      return stop('browsing');
    }
    const fields = chosen(doc.profile, preview.profileFieldIds);
    const current =
      fields === null || doc.profile === null
        ? ''
        : digest({ url: page.url, pageHost, formActionHost }, live.fieldRefs, fields, doc.profile);
    if (current !== preview.hash) return stop('failed');
    if (doc.hosts[pageHost] !== 'allowed') return stop('blocked');
    const day = dayOf(now);
    const cap = capOf(doc, day);
    if (cap.counted + cap.reserved >= cap.limit) return stop('blocked');
    doc.caps[day] = { ...cap, reserved: cap.reserved + 1 };
    preview.values = null;
    attempt.status = 'submitting';
    attempt.capDay = day;
    save(db, userId, doc);
    return { status: 'submitting', reserved: true, clicked: false as const };
  });
}
export function recordDelivery(
  db: Db,
  attemptId: string,
  outcome: 'delivered' | 'unknown',
  _now: number,
) {
  return db.transaction(() => {
    const { userId, doc } = found(db, attemptId);
    const attempt = doc.attempts[attemptId];
    if (attempt === undefined || attempt.status !== 'submitting' || attempt.capDay === null) {
      throw new HttpError(409, 'submit is not in flight');
    }
    const cap = doc.caps[attempt.capDay];
    if (cap === undefined || cap.reserved < 1) throw new HttpError(409, 'no reserved submit');
    cap.reserved -= 1;
    cap.counted += 1;
    attempt.status = outcome === 'delivered' ? 'submitted' : 'blocked';
    attempt.delivery = outcome;
    save(db, userId, doc);
    return { status: attempt.status, counted: cap.counted };
  });
}
