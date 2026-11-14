import {
  type Attributes,
  LANGFUSE_ATTR,
  observationAttributes,
  otelErrorMessage,
} from '@cairn/shared';
import { getSystemMessageText } from '@earendil-works/pi-ai';
import { defineExtension, GenerationTask, hook } from '@earendil-works/pi-durable';
import { emitCoordinatorTurnSpans } from '../../runtime-otel.js';
import { modelResponseTiming } from './models.js';

export function generationTelemetryExtension(
  turnFor: (conversationId: string) => Promise<{ threadId: string; stepId: string }>,
) {
  const requests = new Map<string, Attributes>();
  return defineExtension({
    name: 'cairn-generation-telemetry',
    hooks: [
      hook(GenerationTask, {
        beforeRequest: (request, api) => {
          try {
            if (requests.size >= 64) requests.delete(requests.keys().next().value ?? '');
            requests.set(
              String(api.taskId),
              observationAttributes({
                input: request.messages.map((message) => ({
                  role: message.role,
                  content:
                    message.role === 'system' ? getSystemMessageText(message) : message.content,
                })),
              }),
            );
          } catch {
            requests.delete(String(api.taskId));
          }
        },
        afterResponse: async (message, api) => {
          const key = String(api.taskId);
          const input = requests.get(key);
          requests.delete(key);
          try {
            const turn = await turnFor(String(api.conversationId));
            emitCoordinatorTurnSpans(
              { ...turn, provider: message.provider, model: message.model },
              [
                {
                  kind: 'chat',
                  ...modelResponseTiming(message),
                  provider: message.provider,
                  model: message.model,
                  responseModel: message.responseModel,
                  finishReason: message.stopReason,
                  rawFinishReason: message.rawStopReason,
                  usage: message.usage,
                  costUsd: message.usage.cost?.total,
                  errorMessage: otelErrorMessage(message.errorMessage),
                  input: input?.[LANGFUSE_ATTR.input],
                  output: { role: message.role, content: message.content },
                },
              ],
            );
          } catch {}
        },
      }),
    ],
  });
}
