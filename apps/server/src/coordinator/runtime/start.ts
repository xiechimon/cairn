import type { ClaimedStep, MachineDoneBody } from '@cairn/shared';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import {
  coordinatorCompactionExtension,
  coordinatorCompactionSettings,
  type ModelRef,
} from './compaction.js';
import { generationTelemetryExtension } from './generation-telemetry.js';
import type { MachineApi } from './machine-api.js';
import { createCoordinatorModels } from './models.js';
import { createThreadHarnesses } from './thread-harnesses.js';
import { coordinatorToolsExtension, createStepGate } from './tools.js';
import { runCoordinatorTurn } from './turn.js';

export interface RuntimeConfig {
  storageDir: string;
  heartbeatMs: number;
  summaryModelId: string;
}

export async function startRuntime(config: RuntimeConfig, api: MachineApi) {
  const context = BACKGROUND_CONTEXT;
  const models = createCoordinatorModels();
  const gate = createStepGate();
  const tools = coordinatorToolsExtension(api, gate);
  let active: ModelRef | null = null;
  const compaction = coordinatorCompactionExtension(() =>
    active === null ? null : { provider: active.provider, modelId: config.summaryModelId },
  );
  const threads = new Map<string, string>();
  const harnesses = createThreadHarnesses(config.storageDir, models.models, context, {
    extensions: [
      tools,
      compaction,
      generationTelemetryExtension(async () => {
        const stepId = await gate.current();
        return { threadId: threads.get(stepId) ?? '', stepId };
      }),
    ],
    settings: () => ({
      compaction: coordinatorCompactionSettings(
        models.models
          .getModels()
          .map((m) => ({ provider: m.provider, id: m.id, contextWindow: m.contextWindow })),
      ),
    }),
  });
  return {
    runTurn: async (claimed: ClaimedStep): Promise<MachineDoneBody> => {
      const harness = await harnesses.get(claimed.chief?.threadId ?? '').catch(() => null);
      if (harness === null) {
        const body: MachineDoneBody = {
          status: 'failed',
          errorMessage: 'Coordinator step has no usable chief thread',
        };
        await api.done(claimed.step.id, body);
        return body;
      }
      threads.set(claimed.step.id, claimed.chief?.threadId ?? '');
      try {
        return await runCoordinatorTurn(
          {
            harness,
            models,
            api,
            context,
            heartbeatMs: config.heartbeatMs,
            now: Date.now,
            gate,
            onModel: (ref) => {
              active = ref;
            },
          },
          claimed,
        );
      } finally {
        threads.delete(claimed.step.id);
      }
    },
    close: () => harnesses.close(),
  };
}
