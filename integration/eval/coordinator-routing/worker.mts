import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { askUserQuestionContentSchema, providerConfigSchema } from '@cairn/shared';
import { otlpTraceIdOfTurn } from '@cairn/shared/otel';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { startCoordinator } from '../../../apps/server/src/coordinator/index.js';
import { openDbWithHandle } from '../../../apps/server/src/db/client.js';
import { chiefMessage, machine, step, todo } from '../../../apps/server/src/db/schema.js';
import { seed } from '../../../apps/server/src/db/seed.js';
import { createEphemeralSecretBox } from '../../../apps/server/src/lib/secret-box.js';
import { buildChiefSystemPrompt } from '../../../apps/server/src/services/chief.js';
import {
  setCoordinatorInServer,
  setCoordinatorServerContextEnabled,
} from '../../../apps/server/src/services/coordinator-context.js';
import { TeamStreamHub } from '../../../apps/server/src/services/events.js';
import { MachineWakeHub } from '../../../apps/server/src/services/machine-wake-hub.js';
import { createProvider } from '../../../apps/server/src/services/providers.js';
import { prepareReplayTurn } from './context.mts';
import { replayInput } from './contract.mts';
import { useModelSocket } from './proxy.mts';

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
try {
  const { input, provider, thinking, socket } = z
    .object({
      input: replayInput,
      provider: providerConfigSchema,
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
  db.insert(machine)
    .values({
      id: 'eval-machine',
      teamId: team.id,
      name: 'eval',
      online: true,
      enabledRuntimes: ['pi', 'claude-code'],
    })
    .run();
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
        apiKey: `e30.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'eval-placeholder' } })).toString('base64')}.placeholder`,
        label: 'Eval model',
      },
    },
  );
  const baseline = new Set(input.snapshot.todos.map((t) => t.id));
  const sent = prepareReplayTurn(deps, team.id, input, provider.providerId, thinking);
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
        const todos = db
          .select()
          .from(todo)
          .all()
          .filter((t) => t.phase !== 'closed' && !baseline.has(t.id))
          .map((t) => ({
            id: t.id,
            blockedBy: t.blockedBy ?? [],
            project: input.projects.find((p) => p.id === t.projectId)?.name ?? '',
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
        process.stdout.write(
          JSON.stringify({
            protocol: 'cairn.routing.observations.v1',
            todos,
            text,
            toolCalls: rows.flatMap((row) => {
              const value = row.content as { kind?: string; call?: { name?: string } };
              return value?.kind === 'toolcall' ? [value.call?.name ?? ''] : [];
            }),
            questions: questions.flatMap((q) => q.questions),
            promptSha256,
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
