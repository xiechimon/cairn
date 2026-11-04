import type { SessionOpts } from '@cairn/shared';
import {
  otlpStepSpanIdOfBuild,
  otlpTraceIdOfBuild,
  parseOtlpTarget,
  stepOtelContext,
} from '@cairn/shared/otel';
import { describe, expect, test } from 'vitest';
import { daemonOtelFromEnv } from '../src/backend/otel.js';
import { boot, CLAIMED, FakeMachineApi, fakeBackend, waitFor } from './machine-loop-harness.js';

describe('per-step OTel context wiring (default off)', () => {
  test('otel disabled → sessions start without telemetry context', async () => {
    const api = new FakeMachineApi();
    const { backend, created } = fakeBackend([{ type: 'done', usage: [] }]);
    const { handle } = await boot({ api, backend, otel: null });
    await waitFor(() => api.parked !== null);
    api.parked?.(CLAIMED);
    await waitFor(() => api.doneBodies.length === 1);
    const opts = created[0]?.opts as SessionOpts;
    expect(opts.telemetry).toBeUndefined();
    await handle.stop();
    await handle.done;
  });

  test('otel configured → session carries the server-derived trace context', async () => {
    const api = new FakeMachineApi();
    const { backend, created } = fakeBackend([{ type: 'done', usage: [] }]);
    const otel = daemonOtelFromEnv({ CAIRN_OTEL_ENDPOINT: 'http://127.0.0.1:3000/otel' });
    const { handle } = await boot({ api, backend, otel });
    await waitFor(() => api.parked !== null);
    api.parked?.(CLAIMED);
    await waitFor(() => api.doneBodies.length === 1);
    const opts = created[0]?.opts as SessionOpts;
    const expected = stepOtelContext(
      CLAIMED.step.buildId,
      CLAIMED.step.id,
      parseOtlpTarget({ CAIRN_OTEL_ENDPOINT: 'http://127.0.0.1:3000/otel' })!,
    );
    expect(opts.telemetry?.traceId).toBe(otlpTraceIdOfBuild(CLAIMED.step.buildId));
    expect(opts.telemetry?.stepSpanId).toBe(
      otlpStepSpanIdOfBuild(CLAIMED.step.buildId, CLAIMED.step.id),
    );
    expect(opts.telemetry?.tracesUrl).toBe(expected.tracesUrl);
    await handle.stop();
    await handle.done;
  });
});
