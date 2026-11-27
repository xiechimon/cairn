import type { MachineDoneBody, ModelUsage, OtelObservation } from '@cairn/shared';
import {
  ACTIVE_STEP_STATUSES,
  CHIEF_TURN_ERROR_KIND,
  DONE_ANNOUNCEMENT,
  formatSkillRouteSection,
  isInfoOutput,
  nextIndexFinder,
  stripTurnContext,
  suggestSkillsForMessage,
  TRANSCRIPT_PROMPT_ROW_ID_PREFIX,
  TURN_STATE_OPEN,
} from '@cairn/shared';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  notInArray,
  notLike,
  or,
  sql,
} from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { runAfterCommit } from '../db/commit-effects.js';
import {
  chiefMessage,
  chiefThread,
  chiefTurnUsage,
  claudeSubscription,
  coordinatorInput,
  devinSubscription,
  provider,
  type StepRanModel,
  step,
  stepUsage,
  todo,
  tokenUsage,
} from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import { emitRuntimeStepSpan } from '../runtime-otel.js';
import {
  antigravitySubscriptionAllowsRunner,
  enabledAntigravitySubscriptionId,
} from './antigravity-subscriptions.js';
import {
  chiefClaimContext,
  coordinatorTurnState,
  finishChiefTurn,
  notifyChiefTurn,
  parseChiefTrigger,
  recoverGateWake,
} from './chief.js';
import { announcePrimaryRestored } from './chief-model-switch.js';
import { CHIEF_TURN_END_REASON, cancelPendingQuestions } from './chief-question-store.js';
import { recordChiefStop, steeredMessageScopes } from './chief-turns.js';
import { coordinatorRunsOnPi } from './coordinator-context.js';
import { openTurnCapture, sealCoordinatorTurnSnapshot } from './coordinator-turn-capture.js';
import { stepRuntimeFor } from './dispatch-eligibility.js';
import { imTurnFinished } from './im/runtime.js';
import {
  isChiefConversation,
  type MachineDeps,
  publishStepStatus,
  stepTeamId,
  upsertChiefRow,
} from './machine-deps.js';
import { injectMemoryDocuments } from './memory.js';
import { settleMemoryEditTurn } from './memory-edit-turns.js';
import { recallMemorySection } from './memory-recall.js';
import { ranModel } from './model-fallback.js';
import { stepScopeProjectId } from './picked-project.js';
import { projectTurnContextTraced } from './project-instructions.js';
import { reportAnsweredIn, reportRefCurrent, reportRefOfPrompt } from './report-turn.js';
import { coordinatorProfile } from './routing-rules.js';
import { finishScheduledStep } from './schedules.js';
import { scanLocalSkills } from './skills.js';
import { setTodoPhase } from './todos.js';
import { costFromRates, ratesForModel } from './token-usage-cost.js';
import { insertGateAnnouncement } from './transcript.js';
import { turnProvenance } from './turn-provenance.js';
import { pendingWorkerQuestions } from './worker-question-store.js';

type StepRow = typeof step.$inferSelect;
type ThreadRow = typeof chiefThread.$inferSelect;

export interface ChiefSubscriptionBind {
  runtime: 'claude-code' | 'devin' | 'antigravity';
  teamId: string;
}

export function claimPendingChiefStep(
  db: MachineDeps['db'],
  stepRow: StepRow,
  options: {
    machineId: string | null;
    bind?: ChiefSubscriptionBind | string | null;
    model?: StepRanModel | null;
    mcpGrant?: string[] | null;
    routedFromMachineId?: string | null;
    routedReason?: 'offline' | 'busy' | 'manual-switch' | null;
    stillAuthorized?: () => boolean;
  },
): StepRow | null {
  const bind =
    typeof options.bind === 'string'
      ? { runtime: 'claude-code' as const, teamId: options.bind }
      : (options.bind ?? null);
  if (options.model?.provider === 'antigravity' && bind?.runtime !== 'antigravity') return null;
  const claimed = db.transaction(() => {
    const claimedAt = Math.max(nowMs(), (stepRow.claimedAt ?? 0) + 1);
    if (options.stillAuthorized !== undefined && !options.stillAuthorized()) return null;
    const antigravitySubscriptionId =
      bind?.runtime === 'antigravity'
        ? enabledAntigravitySubscriptionId({ db }, bind.teamId, Math.max(claimedAt, nowMs()))
        : null;
    if (
      bind?.runtime === 'antigravity' &&
      (antigravitySubscriptionId === null ||
        options.machineId === null ||
        !antigravitySubscriptionAllowsRunner(db, bind.teamId, options.machineId))
    ) {
      return null;
    }
    const res = db
      .update(step)
      .set({
        status: 'claimed',
        machineId: options.machineId,
        claudeSubscriptionId:
          bind?.runtime === 'claude-code'
            ? sql<
                string | null
              >`(select ${claudeSubscription.id} from ${claudeSubscription} where ${claudeSubscription.teamId} = ${bind.teamId} and ${claudeSubscription.enabledAt} is not null and (${claudeSubscription.expiresAt} is null or ${claudeSubscription.expiresAt} > ${claimedAt}))`
            : null,
        devinSubscriptionId:
          bind?.runtime === 'devin'
            ? sql<
                string | null
              >`(select ${devinSubscription.id} from ${devinSubscription} where ${devinSubscription.teamId} = ${bind.teamId} and ${devinSubscription.enabledAt} is not null and (${devinSubscription.expiresAt} is null or ${devinSubscription.expiresAt} > ${claimedAt}))`
            : null,
        antigravitySubscriptionId,
        claimedAt,
        lastHeartbeatAt: claimedAt,
        holdReason: null,
        holdUntil: null,
        ranModel: options.model ?? null,
        mcpGrant: options.mcpGrant ?? null,
        ...(options.routedFromMachineId !== undefined
          ? { routedFromMachineId: options.routedFromMachineId }
          : {}),
        ...(options.routedReason !== undefined ? { routedReason: options.routedReason } : {}),
      })
      .where(
        and(
          eq(step.id, stepRow.id),
          eq(step.status, 'pending'),
          or(isNull(step.holdUntil), lte(step.holdUntil, claimedAt)),
          stepRow.claimedAt === null
            ? isNull(step.claimedAt)
            : eq(step.claimedAt, stepRow.claimedAt),
          notInArray(
            step.id,
            db
              .select({ id: coordinatorInput.id })
              .from(coordinatorInput)
              .where(eq(coordinatorInput.state, 'pending')),
          ),
        ),
      )
      .run();
    if (res.changes === 0) return null;
    foldQueuedChiefSteps(db, stepRow, claimedAt);
    return db.select().from(step).where(eq(step.id, stepRow.id)).get() ?? null;
  });
  if (claimed !== null) openTurnCapture(stepRow.id);
  return claimed;
}

function foldQueuedChiefSteps(db: MachineDeps['db'], head: StepRow, now: number): void {
  const owners = head.ownerMessageIds ?? [];
  if (owners.length === 0 || head.prompt === null) return;
  const nativeInputs = new Set(
    db
      .select({ id: coordinatorInput.id })
      .from(coordinatorInput)
      .where(eq(coordinatorInput.threadId, head.buildId))
      .all()
      .map((input) => input.id),
  );
  const later = db
    .select()
    .from(step)
    .where(
      and(
        eq(step.buildId, head.buildId),
        eq(step.kind, 'chief'),
        inArray(step.status, [...ACTIVE_STEP_STATUSES]),
      ),
    )
    .orderBy(asc(step.createdAt), sql`rowid`)
    .all()
    .filter((row) => row.id !== head.id && row.status !== 'claimed');
  const folded: StepRow[] = [];
  for (const row of later) {
    const foldable =
      row.status === 'pending' &&
      row.prompt !== null &&
      (row.ownerMessageIds ?? []).length > 0 &&
      row.holdReason === null &&
      (row.holdUntil === null || row.holdUntil <= now) &&
      row.scopeProjectId === head.scopeProjectId &&
      row.freshSession !== true &&
      !nativeInputs.has(row.id);
    if (!foldable) break;
    folded.push(row);
  }
  if (folded.length === 0) return;
  db.update(step)
    .set({
      prompt: [head.prompt, ...folded.map((row) => row.prompt)].join('\n\n'),
      ownerMessageIds: [
        ...new Set([...owners, ...folded.flatMap((row) => row.ownerMessageIds ?? [])]),
      ],
    })
    .where(eq(step.id, head.id))
    .run();
  db.delete(step)
    .where(
      inArray(
        step.id,
        folded.map((row) => row.id),
      ),
    )
    .run();
}

function nowNote(at: number): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const date = new Date(at);
  const stamp = date.toLocaleString('sv-SE', { timeZone, dateStyle: 'short', timeStyle: 'short' });
  const weekday = date.toLocaleDateString('en-US', { timeZone, weekday: 'long' });
  return `Now: ${stamp}, ${weekday} (${timeZone})`;
}

function turnStateSection(deps: MachineDeps, threadRow: ThreadRow, at: number): string {
  return [
    TURN_STATE_OPEN,
    nowNote(at),
    coordinatorTurnState(deps, threadRow.teamId, threadRow.projectId),
    '</turn_state>',
  ].join('\n');
}

const REPLY_LANGUAGE_GENERIC = "the language of the user's message";
const REPLY_LANGUAGE_MIN_SHARE = 0.15;
const LETTER = /\p{L}/gu;
const REPLY_LANGUAGE_SCRIPTS: readonly [string, RegExp][] = [
  ['Chinese', /[㐀-䶿一-鿿豈-﫿]/g],
  ['Japanese', /[぀-ヿㇰ-ㇿ]/g],
  ['Korean', /[ᄀ-ᅟ㄰-㆏가-힯]/g],
  ['Russian', /\p{Script=Cyrillic}/gu],
  ['Arabic', /[؀-ۿݐ-ݿ]/g],
  ['Hindi', /[ऀ-ॿ]/g],
  ['Thai', /[฀-๿]/g],
];

const QUOTE_OR_LINK_OPENER = /[「『“"`]|https?:\/\/(?=\S)/g;
const QUOTE_ENDS: Record<string, readonly [RegExp, string]> = {
  '「': [/」/g, '」'],
  '『': [/』/g, '』'],
  '“': [/”/g, '”'],
  '"': [/["\n]/g, '"'],
  '`': [/[`\n]/g, '`'],
};

function withoutQuotesAndLinks(words: string): string {
  const closers = new Map(
    Object.entries(QUOTE_ENDS).map(([open, [stop, close]]) => [
      open,
      { endAt: nextIndexFinder(words, new RegExp(stop.source, 'g')), close },
    ]),
  );
  const linkEndAt = nextIndexFinder(words, /\s|$/g);
  const opener = new RegExp(QUOTE_OR_LINK_OPENER.source, 'g');
  let out = '';
  let copied = 0;
  for (let match = opener.exec(words); match !== null; match = opener.exec(words)) {
    const quote = closers.get(match[0]);
    let end: number;
    if (quote === undefined) {
      end = linkEndAt(opener.lastIndex);
    } else {
      const at = quote.endAt(opener.lastIndex);
      if (words.charAt(at) !== quote.close) continue;
      end = at + 1;
    }
    out += `${words.slice(copied, match.index)} `;
    copied = end;
    opener.lastIndex = end;
  }
  return out + words.slice(copied);
}

function replyLanguageOf(words: string): string | null {
  const own = withoutQuotesAndLinks(words);
  const letters = own.match(LETTER)?.length ?? 0;
  if (letters === 0) return null;
  const counts = new Map(
    REPLY_LANGUAGE_SCRIPTS.map(([name, script]) => [name, own.match(script)?.length ?? 0] as const),
  );
  let best: [string, number] = ['', 0];
  for (const [name, count] of counts) {
    if (count > best[1]) best = [name, count];
  }
  const kana = counts.get('Japanese') ?? 0;
  const han = counts.get('Chinese') ?? 0;
  if (kana > 0 && kana * 2 > han) best = ['Japanese', kana];
  return best[1] / letters >= REPLY_LANGUAGE_MIN_SHARE ? best[0] : REPLY_LANGUAGE_GENERIC;
}

export function ownerTextOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) =>
        block !== null && typeof block === 'object' && 'text' in block
          ? String((block as { text: unknown }).text)
          : '',
      )
      .join('\n');
  }
  return '';
}

const IM_ENVELOPE_BLANK = '\n\n';
const IM_BOILERPLATE = ['对方发来的附件', '（另有', '（这条消息没有文字'];

function senderWordsOf(prompt: string, provenance: string): string {
  const body = prompt.slice(prompt.indexOf('\n') + 1);
  if (provenance.startsWith('im:')) {
    const lines = body.split(IM_ENVELOPE_BLANK).slice(1).join('\n\n').split('\n');
    const cut = lines.findIndex((line) => IM_BOILERPLATE.some((head) => line.startsWith(head)));
    return (cut === -1 ? lines : lines.slice(0, cut)).join('\n');
  }
  if (provenance.startsWith('mail:')) {
    return body
      .split('\n')
      .filter((line) => line.startsWith('>'))
      .map((line) => line.replace(/^> ?/, ''))
      .join('\n');
  }
  return body;
}

function latestOwnerRow(db: Db, threadId: string) {
  return db
    .select({ content: chiefMessage.content })
    .from(chiefMessage)
    .where(
      and(
        eq(chiefMessage.threadId, threadId),
        eq(chiefMessage.role, 'user'),
        or(isNull(chiefMessage.origin), eq(chiefMessage.origin, 'user')),
        notLike(chiefMessage.id, `${TRANSCRIPT_PROMPT_ROW_ID_PREFIX}%`),
      ),
    )
    .orderBy(desc(chiefMessage.createdAt), sql`rowid desc`)
    .limit(1)
    .get();
}

function replyLanguageWords(db: Db, stepRow: StepRow, threadRow: ThreadRow): string {
  const prompt = stepRow.prompt ?? '';
  const provenance = turnProvenance(prompt);
  if (provenance !== null && (provenance.startsWith('im:') || provenance.startsWith('mail:'))) {
    return stripTurnContext(senderWordsOf(prompt, provenance));
  }
  try {
    const ownerId = (stepRow.ownerMessageIds ?? []).at(-1);
    const row =
      ownerId === undefined
        ? latestOwnerRow(db, threadRow.id)
        : (db
            .select({ content: chiefMessage.content })
            .from(chiefMessage)
            .where(
              and(
                eq(chiefMessage.id, ownerId),
                eq(chiefMessage.threadId, threadRow.id),
                eq(chiefMessage.role, 'user'),
              ),
            )
            .get() ?? latestOwnerRow(db, threadRow.id));
    const words = stripTurnContext(ownerTextOf(row?.content));
    if (words.trim() !== '') return words;
  } catch {}
  return stripTurnContext(prompt);
}

export function chiefTurnContext(
  deps: MachineDeps,
  stepRow: StepRow,
  threadRow: ThreadRow,
  agentId: string | null,
) {
  const ctx = chiefClaimContext(deps, threadRow.id);
  const trigger = parseChiefTrigger(stepRow.prompt);
  const systemPrompt = ctx?.systemPrompt ?? '';
  let routeSection = '';
  if (ctx && trigger === 'user') {
    const hint = suggestSkillsForMessage(
      stepRow.prompt ?? '',
      scanLocalSkills(deps.skillsDir).map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
      })),
    );
    if (hint) routeSection = formatSkillRouteSection(hint);
  }
  const injected =
    agentId === null
      ? { memories: [], omitted: 0, fileCount: 0 }
      : injectMemoryDocuments(deps.db, {
          agentId,
          teamId: threadRow.teamId,
          threadId: threadRow.id,
          projectId: null,
          recordUse: true,
        });
  const memories = [
    ...injected.memories.map(({ title, content }) => ({ title, content })),
    { title: '记忆文件', content: `${injected.fileCount} 个；用 memories 按需读取。` },
  ];
  const project = projectTurnContextTraced(deps.db, {
    teamId: threadRow.teamId,
    agentId,
    projectId: stepScopeProjectId(stepRow),
    threadId: threadRow.id,
  });
  const recall =
    ctx && trigger === 'user' && agentId !== null
      ? recallMemorySection(
          deps.db,
          { agentId, teamId: threadRow.teamId, threadId: threadRow.id },
          stripTurnContext(stepRow.prompt ?? ''),
          [
            ...injected.memories.map((memory) => `${memory.title}\n${memory.content}`),
            ...(project === null ? [] : [project.text]),
          ],
        )
      : null;
  const state = ctx ? turnStateSection(deps, threadRow, nowMs()) : '';
  const replyLanguage = ctx
    ? replyLanguageOf(replyLanguageWords(deps.db, stepRow, threadRow))
    : null;
  const sections = [
    state,
    replyLanguage === null ? '' : `Reply language: ${replyLanguage}`,
    project?.text,
    routeSection,
    recall?.text ?? '',
  ].filter((part): part is string => !!part);
  const memoryTrace = {
    teamMemoryIds: ctx?.memoryIds ?? [],
    teamMemoriesOmitted: ctx?.memoriesOmitted ?? 0,
    projectMemoryIds: project?.memoryIds ?? [],
    projectMemoriesOmitted: project?.memoriesOmitted ?? 0,
    recalledMemoryIds: recall?.memoryIds ?? [],
  };
  const instruction =
    stepRow.prompt === null
      ? null
      : [stepRow.prompt, ...sections].filter((part) => part).join('\n\n');
  return { trigger, systemPrompt, memories, instruction, sections, memoryTrace };
}

export function latestChiefMemoryUsage(db: Db, teamId: string) {
  const row = db
    .select({
      stepId: step.id,
      threadId: step.buildId,
      createdAt: step.createdAt,
      memoryTrace: step.memoryTrace,
    })
    .from(step)
    .innerJoin(chiefThread, eq(step.buildId, chiefThread.id))
    .where(
      and(
        eq(chiefThread.teamId, teamId),
        eq(step.kind, 'chief'),
        notLike(chiefThread.id, 'chief-memory-%'),
        isNotNull(step.memoryTrace),
        or(isNull(step.holdReason), notLike(step.holdReason, 'steer%')),
      ),
    )
    .orderBy(desc(step.createdAt))
    .limit(1)
    .get();
  if (row === undefined || row.memoryTrace === null) return null;
  return {
    stepId: row.stepId,
    threadId: row.threadId,
    createdAt: row.createdAt,
    ...row.memoryTrace,
  };
}

function settleNotifiedReportTurn(deps: MachineDeps, stepRow: StepRow): void {
  const ref = reportRefOfPrompt(stepRow.prompt);
  if (ref === null || !reportRefCurrent(deps.db, ref)) return;
  const row = deps.db.select().from(todo).where(eq(todo.id, ref.todoId)).get();
  if (row === undefined || !isInfoOutput(row.output)) return;
  if (pendingWorkerQuestions(deps.db, ref.buildId).length > 0) return;
  if (!reportAnsweredIn(deps.db, ref.threadId, row)) return;
  const settled = setTodoPhase(
    deps,
    ref.todoId,
    'done',
    {},
    { silentSettleThreadId: ref.threadId },
  );
  if (settled !== null) insertGateAnnouncement(deps, ref.buildId, DONE_ANNOUNCEMENT, 'Coordinator');
}

export function finishCoordinatorTurn(
  deps: MachineDeps,
  stepRow: StepRow,
  outcome: MachineDoneBody,
  observation?: OtelObservation,
): void {
  const { db } = deps;
  try {
    const teamId = stepTeamId(deps, stepRow);
    if (teamId !== null)
      runAfterCommit(deps, 'sealCoordinatorTurnSnapshot', () =>
        sealCoordinatorTurnSnapshot(db, stepRow, teamId, outcome.status, nowMs()),
      );
  } catch {}
  const provenance = turnProvenance(stepRow.prompt);
  const reportedSessionId =
    provenance?.startsWith('mail:') === true || provenance?.startsWith('im:') === true
      ? undefined
      : outcome.sessionId;
  db.update(step)
    .set({
      ...(reportedSessionId !== undefined ? { sessionId: reportedSessionId } : {}),
      status:
        outcome.status === 'success' ? 'done' : outcome.status === 'stopped' ? 'stopped' : 'failed',
      finishedAt: nowMs(),
    })
    .where(eq(step.id, stepRow.id))
    .run();
  if (outcome.status === 'stopped') recordChiefStop(deps, stepRow);
  publishStepStatus(deps, stepRow.id);
  cancelPendingQuestions(deps, stepRow.buildId, CHIEF_TURN_END_REASON, {
    includeParked: outcome.status === 'stopped',
  });
  finishChiefTurn(
    deps,
    stepRow.buildId,
    { ...outcome, sessionId: reportedSessionId },
    stepRuntimeFor(stepRow.ranModel?.provider ?? null),
  );
  if (stepRow.scheduleId !== null) {
    finishScheduledStep(
      { db: deps.db, hub: deps.hub, user: deps.user },
      stepRow,
      outcome.status === 'success'
        ? { status: 'completed' }
        : outcome.status === 'stopped'
          ? { status: 'stopped' }
          : { status: 'failed', error: outcome.errorMessage ?? 'Coordinator turn failed' },
    );
  }
  settleMemoryEditTurn(
    db,
    stepRow,
    outcome.status === 'success' ? 'success' : outcome.status === 'stopped' ? 'stopped' : 'failed',
    outcome.errorMessage ?? undefined,
  );
  if (outcome.status === 'success') settleNotifiedReportTurn(deps, stepRow);
  if (outcome.status === 'success') announcePrimaryRestored(deps, stepRow);
  if (outcome.status === 'success')
    notifyChiefTurn(
      deps,
      stepRow.buildId,
      stepRow.prompt,
      steeredMessageScopes(deps.db, stepRow).length > 0,
    );
  if (outcome.status === 'failed') recoverGateWake(deps, stepRow);
  if (outcome.status === 'failed') {
    upsertChiefRow(deps, {
      id: `chief-err-${stepRow.id}`,
      threadId: stepRow.buildId,
      projectId: stepScopeProjectId(stepRow),
      role: 'system',
      content: JSON.stringify({
        kind: CHIEF_TURN_ERROR_KIND,
        message: outcome.errorMessage?.trim()
          ? outcome.errorMessage
          : 'Coordinator turn failed without a reported reason',
        ...turnErrorFacts(deps, stepRow),
      }),
      createdAt: nowMs(),
    });
  }
  const finished = db.select().from(step).where(eq(step.id, stepRow.id)).get();
  if (finished !== undefined)
    runAfterCommit(deps, 'imTurnFinished', () => imTurnFinished(finished));
  runAfterCommit(deps, 'emitRuntimeStepSpan', () =>
    emitRuntimeStepSpan(db, stepRow.id, process.env, observation),
  );
}

function turnErrorFacts(deps: MachineDeps, stepRow: StepRow) {
  const elapsed =
    stepRow.claimedAt === null ? {} : { elapsedMs: Math.max(0, nowMs() - stepRow.claimedAt) };
  const teamId = stepTeamId(deps, stepRow);
  if (teamId === null) return elapsed;
  const projectId =
    deps.db
      .select({ projectId: chiefThread.projectId })
      .from(chiefThread)
      .where(eq(chiefThread.id, stepRow.buildId))
      .get()?.projectId ?? null;
  const profile = coordinatorProfile(deps.db, teamId, projectId);
  const ran = ranModel(profile, stepRow);
  if (ran.provider === null) return elapsed;
  const row = deps.db
    .select({ id: provider.id, label: provider.label, models: provider.models })
    .from(provider)
    .where(and(eq(provider.teamId, teamId), eq(provider.providerId, ran.provider)))
    .get();
  const modelId = ran.modelId ?? null;
  return {
    ...elapsed,
    ...(row === undefined ? {} : { providerId: row.id }),
    provider: row?.label ?? ran.provider,
    ...(modelId === null
      ? {}
      : { model: row?.models.find((m) => m.id === modelId)?.name || modelId }),
  };
}

export function recordStepUsage(
  deps: MachineDeps,
  stepRow: StepRow,
  usage: readonly ModelUsage[],
): void {
  const { db } = deps;
  const usageTeamId = stepTeamId(deps, stepRow);
  const mirrorsTurnUsage =
    coordinatorRunsOnPi() && stepRow.kind === 'chief' && isChiefConversation(stepRow.buildId);
  db.transaction((tx) => {
    for (const u of usage) {
      const prior = db
        .select()
        .from(tokenUsage)
        .where(and(eq(tokenUsage.buildId, stepRow.buildId), eq(tokenUsage.model, u.model)))
        .get();
      const tokens = {
        input: (prior?.input ?? 0) + u.input,
        output: (prior?.output ?? 0) + u.output,
        cacheRead: (prior?.cacheRead ?? 0) + u.cacheRead,
        cacheWrite: (prior?.cacheWrite ?? 0) + u.cacheWrite,
      };
      const rates = ratesForModel(db, usageTeamId, u.model);
      const reported = u.cost;
      const cost = rates
        ? costFromRates(tokens, rates)
        : reported !== undefined &&
            (reported.input !== 0 ||
              reported.output !== 0 ||
              reported.cacheRead !== 0 ||
              reported.cacheWrite !== 0 ||
              reported.total !== 0)
          ? {
              costInput: (prior?.costInput ?? 0) + reported.input,
              costOutput: (prior?.costOutput ?? 0) + reported.output,
              costCacheRead: (prior?.costCacheRead ?? 0) + reported.cacheRead,
              costCacheWrite: (prior?.costCacheWrite ?? 0) + reported.cacheWrite,
              costTotal: (prior?.costTotal ?? 0) + reported.total,
            }
          : null;
      tx.insert(tokenUsage)
        .values({
          buildId: stepRow.buildId,
          model: u.model,
          ...tokens,
          costInput: cost?.costInput ?? null,
          costOutput: cost?.costOutput ?? null,
          costCacheRead: cost?.costCacheRead ?? null,
          costCacheWrite: cost?.costCacheWrite ?? null,
          costTotal: cost?.costTotal ?? null,
        })
        .onConflictDoUpdate({
          target: [tokenUsage.buildId, tokenUsage.model],
          set: cost === null ? tokens : { ...tokens, ...cost },
        })
        .run();
      if (mirrorsTurnUsage) {
        tx.insert(chiefTurnUsage)
          .values({
            stepId: stepRow.id,
            threadId: stepRow.buildId,
            model: u.model,
            input: u.input,
            output: u.output,
            cacheRead: u.cacheRead,
            cacheWrite: u.cacheWrite,
            cacheWrite1h: u.cacheWrite1h ?? 0,
            ttftMs: u.ttftMs ?? null,
            contextTokens: u.contextTokens ?? null,
            contextWindow: u.contextWindow ?? null,
            compactAt: u.compactAt ?? null,
            createdAt: nowMs(),
            firstReportAt: nowMs(),
          })
          .onConflictDoUpdate({
            target: [chiefTurnUsage.stepId, chiefTurnUsage.model],
            set: {
              input: sql`${chiefTurnUsage.input} + ${u.input}`,
              output: sql`${chiefTurnUsage.output} + ${u.output}`,
              cacheRead: sql`${chiefTurnUsage.cacheRead} + ${u.cacheRead}`,
              cacheWrite: sql`${chiefTurnUsage.cacheWrite} + ${u.cacheWrite}`,
              cacheWrite1h: sql`${chiefTurnUsage.cacheWrite1h} + ${u.cacheWrite1h ?? 0}`,
              ttftMs: sql`coalesce(${chiefTurnUsage.ttftMs}, ${u.ttftMs ?? null})`,
              createdAt: nowMs(),
              ...(u.contextTokens !== undefined
                ? {
                    contextTokens: u.contextTokens,
                    contextWindow: u.contextWindow ?? null,
                    compactAt: u.compactAt ?? null,
                  }
                : {}),
            },
          })
          .run();
      }
      if (usageTeamId !== null) {
        const mirrored = mirrorsTurnUsage ? u.input + u.output + u.cacheRead + u.cacheWrite : 0;
        tx.insert(stepUsage)
          .values({
            stepId: stepRow.id,
            model: u.model,
            teamId: usageTeamId,
            buildId: stepRow.buildId,
            kind: stepRow.kind,
            input: u.input,
            output: u.output,
            cacheRead: u.cacheRead,
            cacheWrite: u.cacheWrite,
            cacheWrite1h: u.cacheWrite1h ?? 0,
            mirroredTokens: mirrored,
            contextTokens: u.contextTokens ?? null,
            contextWindow: u.contextWindow ?? null,
            compactAt: u.compactAt ?? null,
            createdAt: nowMs(),
          })
          .onConflictDoUpdate({
            target: [stepUsage.stepId, stepUsage.model],
            set: {
              input: sql`${stepUsage.input} + ${u.input}`,
              output: sql`${stepUsage.output} + ${u.output}`,
              cacheRead: sql`${stepUsage.cacheRead} + ${u.cacheRead}`,
              cacheWrite: sql`${stepUsage.cacheWrite} + ${u.cacheWrite}`,
              cacheWrite1h: sql`${stepUsage.cacheWrite1h} + ${u.cacheWrite1h ?? 0}`,
              mirroredTokens: sql`${stepUsage.mirroredTokens} + ${mirrored}`,
              ...(u.contextTokens !== undefined
                ? {
                    contextTokens: u.contextTokens,
                    contextWindow: u.contextWindow ?? null,
                    compactAt: u.compactAt ?? null,
                  }
                : {}),
            },
          })
          .run();
      }
    }
  });
}

export function recordReusedInstructions(db: Db, stepId: string, sentBy: string): void {
  const traceOf = (id: string) =>
    db.select({ memoryTrace: step.memoryTrace }).from(step).where(eq(step.id, id)).get()
      ?.memoryTrace;
  const current = traceOf(stepId);
  const sent = traceOf(sentBy);
  if (!current || !sent) return;
  db.update(step)
    .set({
      memoryTrace: {
        ...current,
        teamMemoryIds: sent.teamMemoryIds,
        teamMemoriesOmitted: sent.teamMemoriesOmitted,
      },
    })
    .where(eq(step.id, stepId))
    .run();
}
