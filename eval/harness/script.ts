import { CORE_COORDINATOR_TOOLS } from '@cairn/shared';
import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai';
import { routingRule } from '../../apps/server/src/db/schema.js';
import type { startCoordinator } from '../../apps/server/src/coordinator/index.js';
import { SUGGEST_REPLIES_ASK } from '../../apps/server/src/coordinator/runtime/suggest-replies.js';
import { createProvider } from '../../apps/server/src/services/providers.js';
import { postProject, type TestServer } from '../../apps/server/test/helpers.js';
import type { ScriptStep } from './types.js';

export const STUB_PROVIDER_ID = 'stub';
export const STUB_MODEL_ID = 'm';
const STUB_KEY = 'stub-key';

export function seedStubRoute(s: TestServer, teamId: string): void {
  createProvider(
    { db: s.db, box: s.secretBox },
    {
      teamId,
      body: {
        providerId: STUB_PROVIDER_ID,
        label: 'Stub',
        baseUrl: 'http://127.0.0.1:9',
        api: 'openai-completions',
        apiKey: STUB_KEY,
        models: [{ id: STUB_MODEL_ID, name: STUB_MODEL_ID }],
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
      provider: STUB_PROVIDER_ID,
      modelId: STUB_MODEL_ID,
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
}

export async function seedProjects(
  s: TestServer,
  names: readonly string[],
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const name of names) ids.set(name, await postProject(s.app, name));
  return ids;
}

function resolveArgs(value: unknown, projects: Map<string, string>): unknown {
  if (typeof value === 'string' && value.startsWith('@')) {
    const resolved = projects.get(value.slice(1));
    if (resolved === undefined) throw new Error(`eval: unknown project ref ${value}`);
    return resolved;
  }
  if (Array.isArray(value)) return value.map((item) => resolveArgs(item, projects));
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        resolveArgs(v, projects),
      ]),
    );
  return value;
}

export interface ScriptedArm {
  /** Fixed coordinator provider: replays the case's script, answers the reply-suggestion turn empty. */
  fixedProviders: NonNullable<
    Parameters<typeof startCoordinator>[0]['fixedProviders']
  >;
  /** Every prompt the coordinator sent, in order. */
  prompts: string[];
}

/**
 * One scripted arm for the Coordinator under test. The arm is a real
 * `startCoordinator` run: only the model behind it is scripted, so the
 * dispatch, claim and delivery code paths stay the product's own.
 */
export function createScriptedArm(script: readonly ScriptStep[], projects: Map<string, string>): ScriptedArm {
  const faux = fauxProvider({
    provider: STUB_PROVIDER_ID,
    models: [{ id: STUB_MODEL_ID, contextWindow: 200_000 }],
    tokensPerSecond: 1e9,
  });
  const prompts: string[] = [];
  let cursor = 0;
  faux.setResponses(
    Array(32).fill((c: unknown) => {
      prompts.push(JSON.stringify(c));
      const scripted = script[cursor] ?? script.at(-1);
      cursor += 1;
      if (scripted === undefined) return fauxAssistantMessage('Done.');
      const blocks = (scripted.toolCalls ?? []).map((call) =>
        CORE_COORDINATOR_TOOLS.has(call.name)
          ? fauxToolCall(call.name, resolveArgs(call.args, projects) as never)
          : fauxToolCall('call_tool', {
              name: call.name,
              arguments: resolveArgs(call.args, projects),
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
  const provider = {
    ...faux.provider,
    streamSimple(model: never, context: never, options: never) {
      if ((context as { messages: { content: unknown }[] }).messages[0]?.content !== SUGGEST_REPLIES_ASK)
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
  };
  return { fixedProviders: [provider], prompts };
}
