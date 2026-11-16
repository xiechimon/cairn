import type { AgentBackend, AgentSessionHandle, ClaimedStep, SessionOpts } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { SessionNotResumableError } from '../src/backend/errors.js';
import { StepSessionOpener, type StepSessionOpenerInput } from '../src/step-session-opener.js';

const HISTORY = '【此前的对话】\n> 用户：之前的话\n【此前的对话结束】';
const INSTRUCTION = '现在的消息';

function world(options: {
  action: 'new' | 'continue';
  resumable: boolean;
  history?: string;
  resume?: { sessionId: string | null; prompt: string | null };
  prompt?: string | undefined;
}) {
  const created: (string | undefined)[] = [];
  const continued: (string | undefined)[] = [];
  const journal: unknown[] = [];
  const transcript: { id: string; content: unknown }[] = [];
  const handle = { sessionId: 'new-session' } as unknown as AgentSessionHandle;
  const backend = {
    createSession: async (opts: SessionOpts) => {
      created.push(opts.prompt);
      return handle;
    },
    continueSession: async (_id: string, opts: SessionOpts) => {
      continued.push(opts.prompt);
      if (!options.resumable) throw new SessionNotResumableError('stale');
      return handle;
    },
  } as unknown as AgentBackend;
  const claimed = {
    step: { id: 's1', kind: 'chief', machineId: 'm1' },
    session: {
      action: options.action,
      sessionId: options.action === 'continue' ? 'stale' : null,
    },
    instruction: INSTRUCTION,
    todo: undefined,
    ...(options.history !== undefined
      ? { chief: { threadId: 't', systemPrompt: 'sys', trigger: 'user', history: options.history } }
      : { chief: { threadId: 't', systemPrompt: 'sys', trigger: 'user' } }),
  } as unknown as ClaimedStep;
  const sessionOpts = {
    provider: { kind: 'api_key', providerId: 'p' },
    modelId: 'm',
    prompt: 'prompt' in options ? options.prompt : INSTRUCTION,
  } as unknown as SessionOpts;
  const opener = new StepSessionOpener({
    backend,
    sessionOpts,
    claimed,
    stepId: 's1',
    isChief: true,
    resume: options.resume,
    prompt: INSTRUCTION,
    promptImages: undefined,
    imageSupport: null,
    freshPromptPaths: { isInfoBuild: false, reportFile: '', plansDir: '', convId: 't' },
    modelKey: 'p/m',
    client: {},
    journal: { update: (_id: string, patch: unknown) => journal.push(patch) },
    transcript: { upsert: (row: { id: string; content: unknown }) => transcript.push(row) },
    logger: { step: () => {}, raw: () => {} },
    stepAttachmentsDir: '/tmp',
    now: () => 1,
    forgetHandle: () => {},
    rememberImageSupport: () => {},
  } as unknown as StepSessionOpenerInput);
  return { opener, sessionOpts, created, continued, journal, transcript };
}

describe('StepSessionOpener carries the earlier conversation into a new session only', () => {
  test('a new claim prefixes the history, and sessionOpts.prompt is untouched', async () => {
    const w = world({ action: 'new', resumable: true, history: HISTORY });
    await w.opener.open();
    expect(w.created).toEqual([`${HISTORY}\n\n${INSTRUCTION}`]);
    expect(w.sessionOpts.prompt).toBe(INSTRUCTION);
  });

  test('a session that resumes gets no history', async () => {
    const w = world({ action: 'continue', resumable: true, history: HISTORY });
    await w.opener.open();
    expect(w.continued).toEqual([INSTRUCTION]);
    expect(w.created).toEqual([]);
  });

  test('a stale session falls back to a new one that carries the history; journal and transcript keep the original instruction', async () => {
    const w = world({ action: 'continue', resumable: false, history: HISTORY });
    await w.opener.open();
    expect(w.created).toEqual([`${HISTORY}\n\n${INSTRUCTION}`]);
    expect(w.sessionOpts.prompt).toBe(INSTRUCTION);
    expect(JSON.stringify(w.journal)).not.toContain('此前的对话');
    const prompts = w.transcript.filter((row) => row.id === 'user-s1').map((row) => row.content);
    expect(prompts).toEqual([INSTRUCTION]);
  });

  test('recovery with a journal prompt and a missing session also carries the history', async () => {
    const w = world({
      action: 'continue',
      resumable: false,
      history: HISTORY,
      resume: { sessionId: 'stale', prompt: 'journal prompt' },
    });
    w.sessionOpts.prompt = 'journal prompt';
    await w.opener.open();
    expect(w.created).toEqual([`${HISTORY}\n\njournal prompt`]);
  });

  test('a reopen by session id after a network failure does not repeat the history', async () => {
    const w = world({ action: 'new', resumable: true, history: HISTORY });
    await w.opener.open();
    w.opener.continueId = 'new-session';
    await w.opener.open();
    expect(w.continued).toEqual([INSTRUCTION]);
    expect(w.created).toHaveLength(1);
  });

  test('no history field, or no prompt, leaves the session options as they were', async () => {
    const plain = world({ action: 'new', resumable: true });
    await plain.opener.open();
    expect(plain.created).toEqual([INSTRUCTION]);
    const empty = world({ action: 'new', resumable: true, history: HISTORY, prompt: undefined });
    await empty.opener.open();
    expect(empty.created).toEqual([undefined]);
  });
});
