import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  appendBlockerHandoff,
  appendDecisionsNote,
  buildTaskPromptText,
  type ClaimedStep,
  composeTaskPromptWithInstruction,
  INFO_OUTPUT_KINDS,
  INFO_SUBMIT_REPORT_TOOL,
  infoCardBrief,
  type MachineDoneBody,
  MEMORY_VERIFY_NOTE,
} from '@cairn/shared';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { Provider } from '@earendil-works/pi-ai';
import { defineExtension } from '@earendil-works/pi-durable';
import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { build, step, todo } from '../../db/schema.js';
import { nowMs } from '../../lib/ids.js';
import { holdBlockedBuild } from '../../services/blockers.js';
import { infoCardPlan, infoCardRemoteTools } from '../../services/info-card.js';
import { infoRepoOffered } from '../../services/info-repo-snapshot.js';
import { failEarlierClaimDeliverables } from '../../services/machine-deliverables.js';
import { type MachineDeps, publishStepStatus } from '../../services/machine-deps.js';
import { finishStep } from '../../services/machine-finish-step.js';
import { injectMemories } from '../../services/memory.js';
import { memoryOwnerOf } from '../../services/routing-rules.js';
import { recordStepRoute } from '../../services/step-route.js';
import { setTodoPhase } from '../../services/todos.js';
import { routeOf, scrubProviderError } from '../credentials.js';
import { providerBinding } from '../provider-binding.js';
import { createCoordinatorServerApi } from '../server-api.js';
import { thrownErrorText } from './error-text.js';
import { openCoordinatorHarness } from './harness.js';
import { createInfoCardRunGuard } from './info-card-guard.js';
import type { MachineApi } from './machine-api.js';
import { createCoordinatorModels } from './models.js';
import { coordinatorTool, createStepGate } from './tools.js';
import { runCoordinatorTurn } from './turn.js';

const HEARTBEAT_MS = 15_000;
const TICK_MS = 5_000;
const MAX_PARALLEL = 3;
const TOOLS_PAGE = 'info-card-tools';

type StepRow = typeof step.$inferSelect;
type TodoRow = typeof todo.$inferSelect;

export interface InfoCardRunnerLogger {
  info(obj: object, message: string): void;
  error(obj: object, message: string): void;
}

export interface InfoCardRunnerOptions {
  machine: MachineDeps;
  storageDir: string;
  logger: InfoCardRunnerLogger;
  fixedProviders?: readonly Provider[];
  heartbeatMs?: number;
  tickMs?: number;
  stopPollMs?: number;
  maxParallel?: number;
}

export interface InfoCardRunner {
  tick(): void;
  idle(): Promise<void>;
  close(): Promise<void>;
}

function storeFiles(storageDir: string, stepId: string): string[] {
  const base = join(storageDir, `info-${stepId}.sqlite`);
  return ['', '-wal', '-shm'].map((suffix) => `${base}${suffix}`);
}

export function startInfoCardRunner(options: InfoCardRunnerOptions): InfoCardRunner {
  const { machine, logger } = options;
  const { db } = machine;
  const context = BACKGROUND_CONTEXT;
  const running = new Map<string, Promise<void>>();
  let closing = false;
  const serverApi = createCoordinatorServerApi(machine);

  const pendingInfoSteps = () =>
    db
      .select({ stepRow: step, todoRow: todo })
      .from(step)
      .innerJoin(build, eq(step.buildId, build.id))
      .innerJoin(todo, eq(build.todoId, todo.id))
      .where(
        and(
          eq(step.status, 'pending'),
          inArray(step.kind, ['build', 'session']),
          inArray(todo.output, INFO_OUTPUT_KINDS),
          isNull(todo.archivedAt),
          sql`coalesce(${todo.sourceKind}, '') NOT IN ('research-intake', 'research-citation-check')`,
          or(isNull(step.holdUntil), lte(step.holdUntil, sql`${nowMs()}`)),
        ),
      )
      .orderBy(asc(step.createdAt))
      .all();

  const claim = (
    stepRow: StepRow,
    todoRow: TodoRow,
    plan: Extract<ReturnType<typeof infoCardPlan>, { kind: 'pi' }>,
  ): boolean => {
    const claimedAt = Math.max(nowMs(), (stepRow.claimedAt ?? 0) + 1);
    const won = db.transaction((tx) => {
      const res = tx
        .update(step)
        .set({
          status: 'claimed',
          machineId: null,
          claimedAt,
          lastHeartbeatAt: claimedAt,
          holdReason: null,
          holdUntil: null,
          ranModel: { provider: plan.provider, modelId: plan.modelId },
          mcpGrant: null,
        })
        .where(and(eq(step.id, stepRow.id), eq(step.status, 'pending')))
        .run();
      if (res.changes === 0) return false;
      holdBlockedBuild(db, stepRow.buildId);
      failEarlierClaimDeliverables(tx, stepRow.id);
      recordStepRoute(tx, stepRow, todoRow, plan.machineId, {
        provider: plan.provider,
        modelId: plan.modelId,
        machineId: plan.machineId,
        requiredCapabilities: null,
      });
      return true;
    });
    if (!won) return false;
    if (todoRow.phase === 'queued') setTodoPhase(machine, todoRow.id, 'building');
    publishStepStatus(machine, stepRow.id);
    return true;
  };

  const promptOf = (stepRow: StepRow, todoRow: TodoRow): string => {
    const taskText = appendDecisionsNote(
      appendBlockerHandoff(
        buildTaskPromptText(todoRow.title, todoRow.spec, todoRow),
        stepRow.blockerHandoff,
      ),
      todoRow.decisions,
    );
    return stepRow.prompt !== null && stepRow.prompt.trim() !== ''
      ? composeTaskPromptWithInstruction(taskText, stepRow.prompt)
      : taskText;
  };

  const claimedStepOf = (
    stepRow: StepRow,
    todoRow: TodoRow,
    plan: Extract<ReturnType<typeof infoCardPlan>, { kind: 'pi' }>,
  ): ClaimedStep => {
    const memories = injectMemories(db, {
      agentId: memoryOwnerOf(db, todoRow.teamId, stepRow.kind),
      teamId: todoRow.teamId,
      teamScoped: false,
      threadId: todoRow.id,
      projectId: todoRow.projectId,
    });
    const systemPrompt = [
      plan.profile.description,
      memories.length > 0
        ? `## 记忆\n${MEMORY_VERIFY_NOTE}\n${memories.map((m) => `- ${m.title}：${m.content}`).join('\n')}`
        : null,
      infoCardBrief(stepRow.buildId, infoRepoOffered(machine, todoRow)),
    ]
      .filter((part): part is string => part !== null && part !== '')
      .join('\n\n');
    return {
      step: {
        id: stepRow.id,
        buildId: stepRow.buildId,
        kind: stepRow.kind,
        machineId: null,
        createdAt: stepRow.createdAt,
      },
      conversationId: stepRow.buildId,
      session: { action: 'new', sessionId: null },
      instruction: promptOf(stepRow, todoRow),
      agent: {
        id: plan.profile.id,
        displayName: plan.profile.displayName,
        description: plan.profile.description,
        provider: plan.provider,
        modelId: plan.modelId,
        thinkingLevel: (stepRow.fallback?.model ? null : plan.profile.thinkingLevel) as never,
        memories,
      },
      chief: { threadId: stepRow.buildId, systemPrompt, trigger: 'wake' },
      remoteTools: infoCardRemoteTools(stepRow.kind),
    };
  };

  const run = async (
    stepRow: StepRow,
    todoRow: TodoRow,
    plan: Extract<ReturnType<typeof infoCardPlan>, { kind: 'pi' }>,
  ): Promise<void> => {
    const teamId = todoRow.teamId;
    const route = routeOf(
      { db, box: machine.box },
      teamId,
      plan.provider,
      plan.modelId,
      plan.profile.thinkingLevel,
    );
    const scrub = (message: string) =>
      scrubProviderError({ db, box: machine.box }, teamId, [plan.provider], message);
    const stopped = () => closing;
    const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
    const files = storeFiles(options.storageDir, stepRow.id);
    for (const file of files) rmSync(file, { force: true });
    const {
      inputs: _inputs,
      steer: _steer,
      ackSteer: _ackSteer,
      canSuggestReplies: _canSuggest,
      suggestReplies: _suggest,
      ...base
    } = serverApi;
    const guard = createInfoCardRunGuard();
    const api: MachineApi = {
      ...base,
      relayTool: async (stepId, name, params, callId, signal) => {
        const text = await base.relayTool(stepId, name, params, callId, signal);
        if (name === INFO_SUBMIT_REPORT_TOOL) guard.reportSubmitted();
        return text;
      },
      done: async (stepId, body: MachineDoneBody) => {
        if (stopped()) return;
        await finishStep(
          machine,
          null,
          stepId,
          body.errorMessage === undefined
            ? body
            : { ...body, errorMessage: scrub(body.errorMessage) },
        );
      },
    };
    let harness: Awaited<ReturnType<typeof openCoordinatorHarness>> | null = null;
    try {
      if (route === null) throw new Error('The info card model has no keyed provider');
      const models = createCoordinatorModels(options.fixedProviders ?? []);
      const binding = providerBinding({ db, box: machine.box }, teamId, route);
      models.useProvider(binding.config, binding.resolveKey, binding.observe);
      const gate = createStepGate();
      const extension = defineExtension({
        name: TOOLS_PAGE,
        hooks: guard.hooks,
        tools: infoCardRemoteTools(stepRow.kind).map((def) =>
          coordinatorTool(def, api, gate, stopped),
        ),
      });
      harness = await openCoordinatorHarness(files[0] as string, models.models, context, {
        extensions: [extension],
      });
      await runCoordinatorTurn(
        {
          harness,
          models,
          api,
          context,
          heartbeatMs,
          ...(options.stopPollMs === undefined ? {} : { stopPollMs: options.stopPollMs }),
          now: Date.now,
          gate,
        },
        claimedStepOf(stepRow, todoRow, plan),
      );
    } catch (error) {
      const message = scrub(thrownErrorText(error));
      logger.error({ stepId: stepRow.id, error: message }, 'info card run failed');
      const current = db.select().from(step).where(eq(step.id, stepRow.id)).get();
      if (!closing && current?.status === 'claimed') {
        await finishStep(machine, null, stepRow.id, { status: 'failed', errorMessage: message });
      }
    } finally {
      await harness?.close(context).catch(() => undefined);
      for (const file of files) if (existsSync(file)) rmSync(file, { force: true });
    }
  };

  const tick = (): void => {
    if (closing) return;
    for (const { stepRow, todoRow } of pendingInfoSteps()) {
      if (running.size >= (options.maxParallel ?? MAX_PARALLEL)) return;
      if (running.has(stepRow.id)) continue;
      const plan = infoCardPlan(db, todoRow, stepRow);
      if (plan.kind !== 'pi') continue;
      if (!claim(stepRow, todoRow, plan)) continue;
      const fresh = db.select().from(step).where(eq(step.id, stepRow.id)).get() ?? stepRow;
      logger.info({ stepId: stepRow.id, provider: plan.provider }, 'info card claimed');
      running.set(
        stepRow.id,
        run(fresh, todoRow, plan).finally(() => running.delete(stepRow.id)),
      );
    }
  };

  const timer = setInterval(tick, options.tickMs ?? TICK_MS);
  timer.unref();
  tick();

  return {
    tick,
    idle: async () => {
      while (running.size > 0) await Promise.allSettled([...running.values()]);
    },
    close: async () => {
      closing = true;
      clearInterval(timer);
      await Promise.allSettled([...running.values()]);
    },
  };
}
