import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { askUserQuestionContentSchema, providerConfigSchema } from '@cairn/shared';
import { otlpTraceIdOfTurn } from '@cairn/shared/otel';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { startCoordinator } from '../../../apps/server/src/coordinator/index.js';
import { openDbWithHandle } from '../../../apps/server/src/db/client.js';
import {
  chiefMessage,
  project,
  routingRule,
  step,
  todo,
} from '../../../apps/server/src/db/schema.js';
import { seed } from '../../../apps/server/src/db/seed.js';
import { createEphemeralSecretBox } from '../../../apps/server/src/lib/secret-box.js';
import {
  buildChiefSystemPrompt,
  sendChiefMessage,
} from '../../../apps/server/src/services/chief.js';
import {
  setCoordinatorInServer,
  setCoordinatorServerContextEnabled,
} from '../../../apps/server/src/services/coordinator-context.js';
import { TeamStreamHub } from '../../../apps/server/src/services/events.js';
import { MachineWakeHub } from '../../../apps/server/src/services/machine-wake-hub.js';
import { createProvider } from '../../../apps/server/src/services/providers.js';
import { normalize, replayInput } from './contract.mts';
import { useModelSocket } from './proxy.mts';

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
try {
  const { input, provider, key, thinking, socket } = z
    .object({
      input: replayInput,
      provider: providerConfigSchema,
      key: z.string().min(1),
      thinking: z.enum(['low', 'medium', 'high']),
      socket: z.string().min(1),
    })
    .strict()
    .parse(JSON.parse(Buffer.concat(chunks).toString()));
  useModelSocket(socket);
  setCoordinatorInServer(true);
  setCoordinatorServerContextEnabled(true);
  const { db, close } = openDbWithHandle(':memory:');
  const { user, team } = seed(db);
  const box = createEphemeralSecretBox();
  const home = process.cwd();
  for (const name of ['repos', 'attachments', 'skills']) mkdirSync(join(home, name));
  const deps = {
    db,
    hub: new TeamStreamHub(),
    machineHub: new MachineWakeHub(),
    user,
    box,
    reposDir: join(home, 'repos'),
    attachmentsDir: join(home, 'attachments'),
    skillsDir: join(home, 'skills'),
  };
  createProvider(
    { db, box },
    {
      teamId: team.id,
      createdBy: user.id,
      body: {
        ...provider,
        baseUrl: provider.baseUrl ?? '',
        api: provider.api ?? 'openai-responses',
        apiKey: key,
        label: 'Eval model',
      },
    },
  );
  db.insert(routingRule)
    .values({
      id: 'eval-route',
      teamId: team.id,
      use: 'coordinator',
      provider: provider.providerId,
      modelId: 'gpt-6.1-sol',
      thinkingLevel: thinking,
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  for (const [n, p] of input.projects.entries()) {
    db.insert(project)
      .values({ id: `project-${n}`, teamId: team.id, ...p })
      .run();
  }
  const picked =
    input.chip === undefined
      ? undefined
      : db
          .select()
          .from(project)
          .all()
          .find((p) => p.name === input.chip)?.id;
  if (input.chip !== undefined && picked === undefined) throw new Error('Unknown project chip');
  const sent = sendChiefMessage(deps, team.id, {
    threadId: null,
    content: input.request,
    projectId: picked,
  });
  const promptSha256 = createHash('sha256')
    .update(buildChiefSystemPrompt(deps, team.id, sent.thread.id).text)
    .digest('hex');
  const coordinator = startCoordinator({
    machine: deps,
    storageDir: home,
    logger: { info() {}, warn() {}, error() {} },
    tickMs: 60_000,
  });
  try {
    for (;;) {
      const rows = db
        .select()
        .from(chiefMessage)
        .where(eq(chiefMessage.threadId, sent.thread.id))
        .all()
        .map((row) => {
          let content: unknown = row.content;
          if (typeof content === 'string') {
            try {
              content = JSON.parse(content);
            } catch {}
          }
          return { ...row, content };
        });
      const questions = rows.flatMap((row) => {
        const parsed = askUserQuestionContentSchema.safeParse(row.content);
        return parsed.success ? [parsed.data] : [];
      });
      const current = db.select().from(step).where(eq(step.id, sent.message.id)).get();
      if (!current) throw new Error('Missing turn');
      if (questions.length || !['pending', 'claimed'].includes(current.status)) {
        const parts = db
          .select()
          .from(todo)
          .all()
          .filter((t) => t.phase !== 'closed')
          .map((t) => ({
            project: input.projects[Number(t.projectId.slice(8))]?.name ?? '',
            title: t.title,
          }));
        const text = rows
          .filter((r) => r.role === 'assistant')
          .flatMap((r) =>
            typeof r.content === 'string'
              ? [r.content]
              : Array.isArray(r.content)
                ? r.content.flatMap((b: { type?: string; text?: string }) =>
                    b.type === 'text' ? [b.text ?? ''] : [],
                  )
                : [],
          )
          .join('');
        const allowed = new Set(['projects', 'todos', 'create_todo', 'open_thread', 'ask_user']);
        for (const row of rows) {
          const value = row.content as { kind?: string; call?: { name?: string } };
          if (value?.kind === 'toolcall' && !allowed.has(value.call?.name ?? ''))
            throw new Error('Case used uncaptured state');
        }
        const decision = normalize(
          current.status,
          parts.map((p) => p.project),
          questions.length > 0,
          text,
        );
        process.stdout.write(
          JSON.stringify({
            decision,
            parts,
            questions: questions.flatMap((q) => q.questions),
            askCandidates: [
              ...new Set(
                questions.flatMap((q) => q.questions.flatMap((p) => p.options.map((o) => o.label))),
              ),
            ],
            promptSha256,
            blockedBy: [],
            stepStatus: current.status,
            turnTraceId: otlpTraceIdOfTurn(sent.message.id),
          }),
        );
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  } finally {
    await coordinator.close();
    close();
  }
} catch {
  process.exitCode = 2;
}
