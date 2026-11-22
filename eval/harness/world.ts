import { createHash } from 'node:crypto';
import { CORE_COORDINATOR_TOOLS, toolCallRecordSchema } from '@cairn/shared';
import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai';
import { eq } from 'drizzle-orm';
import { type Coordinator, startCoordinator } from '../../apps/server/src/coordinator/index.js';
import { SUGGEST_REPLIES_ASK } from '../../apps/server/src/coordinator/runtime/suggest-replies.js';
import {
  chiefMessage,
  chiefTurnUsage,
  project,
  routingRule,
  step,
  todo,
} from '../../apps/server/src/db/schema.js';
import {
  setCoordinatorInServer,
  setCoordinatorWake,
} from '../../apps/server/src/services/coordinator-context.js';
import { createProvider } from '../../apps/server/src/services/providers.js';
import {
  bootServer,
  insertMachine,
  postProject,
  req,
  type TestServer,
} from '../../apps/server/test/helpers.js';
import { makeTestTempDir, releaseTestTempDir } from '../../scripts/test-tmpdir.mjs';
import type { RuntimeTask, TurnRecord } from './types.js';

const KEY = 'sk-eval-stub-key-0123456789';
const STUB_MODEL = 'm';

export function activateInServer(): void {
  setCoordinatorInServer(true);
  setCoordinatorWake(() => {});
}

export function deactivateInServer(): void {
  setCoordinatorInServer(false);
  setCoordinatorWake(() => {});
}

export async function runRuntimeTurn(task: RuntimeTask): Promise<TurnRecord> {
  const s: TestServer = bootServer({});
  insertMachine(s);
  const storageDir = makeTestTempDir('eval-coord-');
  let coordinator: Coordinator | undefined;
  try {
    const teamId = s.team.id;
    createProvider(
      { db: s.db, box: s.secretBox },
      {
        teamId,
        body: {
          providerId: 'stub',
          label: 'Stub',
          baseUrl: 'http://127.0.0.1:9',
          api: 'openai-completions',
          apiKey: KEY,
          models: [{ id: STUB_MODEL, name: STUB_MODEL }],
        },
        createdBy: s.user.id,
      },
    );
    s.db
      .insert(routingRule)
      .values({
        id: 'rule-coordinator',
        teamId,
        use: 'coordinator',
        provider: 'stub',
        modelId: STUB_MODEL,
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    const projectIds = new Map<string, string>();
    for (const name of task.world.projects) {
      projectIds.set(name, await postProject(s.app, name));
    }
    const content =
      task.event === undefined ? task.request : `[wake:${task.event}] ${task.request}`;
    const sent = await req(s.app, 'POST', `/api/teams/${teamId}/chief/threads`, { content });
    if (sent.status !== 201)
      return { caseId: task.id, kind: task.kind, incomplete: `thread:${sent.status}` };
    const { thread } = (await sent.json()) as { thread: { id: string } };
    const stepRow = s.db.select().from(step).get();

    const resolveArgs = (value: unknown): unknown => {
      if (typeof value === 'string' && value.startsWith('@')) {
        const resolved = projectIds.get(value.slice(1));
        if (resolved === undefined) throw new Error(`eval: unknown project ref ${value}`);
        return resolved;
      }
      if (Array.isArray(value)) return value.map(resolveArgs);
      if (value !== null && typeof value === 'object')
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, resolveArgs(v)]),
        );
      return value;
    };
    const faux = fauxProvider({
      provider: 'stub',
      models: [{ id: STUB_MODEL, contextWindow: 200_000 }],
      tokensPerSecond: 1e9,
    });
    const prompts: string[] = [];
    let cursor = 0;
    faux.setResponses(
      Array(32).fill((c: unknown) => {
        prompts.push(JSON.stringify(c));
        const scripted = task.script[cursor] ?? task.script.at(-1);
        cursor += 1;
        if (scripted === undefined) return fauxAssistantMessage('Done.');
        const blocks = (scripted.toolCalls ?? []).map((call) =>
          CORE_COORDINATOR_TOOLS.has(call.name)
            ? fauxToolCall(call.name, resolveArgs(call.args) as never)
            : fauxToolCall('call_tool', {
                name: call.name,
                arguments: resolveArgs(call.args),
              } as never),
        );
        if (blocks.length === 0) return fauxAssistantMessage(scripted.text ?? 'Done.');
        const options = { stopReason: 'toolUse' as const };
        if (scripted.text !== undefined) {
          return fauxAssistantMessage(
            [{ type: 'text', text: scripted.text } as never, ...blocks].flat(),
            options,
          );
        }
        return fauxAssistantMessage(blocks, options);
      }),
    );
    const seenByCall = prompts;

    coordinator = startCoordinator({
      machine: {
        db: s.db,
        hub: s.hub,
        machineHub: s.machineHub,
        box: s.secretBox,
        user: s.user,
        vapidKeys: s.vapidKeys,
        reposDir: s.reposDir,
        attachmentsDir: s.attachmentsDir,
        skillsDir: s.skillsDir,
        convHub: s.convHub,
      },
      storageDir,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      heartbeatMs: 1_000,
      tickMs: 3_600_000,
      stopPollMs: 50,
      fixedProviders: [
        {
          ...faux.provider,
          streamSimple(model: never, context: never, options: never) {
            if (
              (context as { messages: { content: unknown }[] }).messages[0]?.content !==
              SUGGEST_REPLIES_ASK
            )
              return faux.provider.streamSimple(model, context, options);
            const stream = createAssistantMessageEventStream();
            const message = {
              ...fauxAssistantMessage('{"replies":[]}'),
              api: (model as { api: string }).api,
              provider: (model as { provider: string }).provider,
              model: (model as { id: string }).id,
            };
            stream.push({ type: 'done', reason: 'stop', message });
            stream.end(message);
            return stream;
          },
        },
      ],
    });
    coordinator.wake(thread.id);
    await coordinator.idle();

    const after = s.db
      .select()
      .from(step)
      .where(eq(step.id, stepRow?.id ?? ''))
      .get();
    const todos = s.db.select().from(todo).all();
    const projects = new Map(
      s.db
        .select()
        .from(project)
        .all()
        .map((p) => [p.id, p.name] as const),
    );
    const messages = s.db.select().from(chiefMessage).all();
    const toolCalls = messages
      .map((row) => row.content)
      .flatMap((content) => {
        if (typeof content !== 'object' || content === null || !('call' in content)) return [];
        const parsed = toolCallRecordSchema.safeParse((content as { call: unknown }).call);
        if (!parsed.success) return [];
        const call = parsed.data;
        if (call.name === 'call_tool') {
          const inner = call.arguments as { name?: string; arguments?: unknown };
          return [{ name: inner.name ?? 'call_tool', arguments: inner.arguments ?? {} }];
        }
        return [{ name: call.name, arguments: call.arguments }];
      });
    const askCalls = toolCalls.filter((call) => call.name === 'ask_user');
    const askCandidates = [
      ...new Set(
        askCalls.flatMap((call) => {
          const questions = (call.arguments as { questions?: { options?: { label: string }[] }[] })
            ?.questions;
          return (questions ?? []).flatMap((q) => (q.options ?? []).map((o) => o.label));
        }),
      ),
    ];
    const assistantText = messages
      .filter((row) => row.role === 'assistant')
      .map((row) => row.content)
      .map((content) => {
        if (typeof content === 'string') return content;
        if (typeof content === 'object' && content !== null) {
          const c = content as { kind?: unknown; text?: unknown };
          if (typeof c.text === 'string') return c.text;
          if (c.kind === 'toolcall' || c.kind === 'ask_user_question') return '';
          return JSON.stringify(content);
        }
        return '';
      })
      .join('\n');
    const placed = todos;
    const asked = askCalls.length > 0;
    const status = after?.status ?? 'missing';
    const decision =
      status !== 'done' && status !== 'claimed'
        ? 'failed'
        : placed.length > 0 && asked
          ? 'mixed'
          : placed.length > 0
            ? 'route'
            : asked
              ? 'ask'
              : assistantText.trim()
                ? 'answer'
                : 'failed';
    const usage = s.db.select().from(chiefTurnUsage).all();
    return {
      caseId: task.id,
      kind: task.kind,
      stepStatus: status,
      decision,
      todos: placed.map((t) => ({
        project: t.projectId === null ? '(none)' : (projects.get(t.projectId) ?? t.projectId),
        title: t.title,
      })),
      asked,
      askCandidates,
      toolCalls: toolCalls.map((call) => ({ name: call.name, argsValid: true })),
      text: assistantText,
      boundModels: usage.map((u) => u.model),
      promptSystem: seenByCall,
      promptSha256: createHash('sha256')
        .update(seenByCall[0] ?? '')
        .digest('hex'),
    };
  } catch (error) {
    return {
      caseId: task.id,
      kind: task.kind,
      incomplete: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await coordinator?.close();
    s.dispose();
    releaseTestTempDir(storageDir);
  }
}
