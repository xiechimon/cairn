import type { ModelSource } from '@cairn/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import type { SubscriptionAccount } from '../src/api/claude-accounts.js';
import { streamEventQueryEffect } from '../src/api/sse-team-events.js';
import { TooltipProvider } from '../src/components/ui/tooltip.js';
import { I18nProvider } from '../src/i18n/provider.js';
import {
  runtimeUpdateSummary,
  SubscriptionDetail,
  type RuntimeUpdateSummary,
} from '../src/resources/subscription-detail.js';

const NOW = Date.UTC(2026, 10, 24, 12);

const ACCOUNT: SubscriptionAccount = {
  id: 'sub-1',
  vendor: 'claude',
  label: 'Claude Work',
  expiresAt: null,
  createdAt: NOW - 3_600_000,
  plan: 'Max',
  state: 'ok',
  cooldownUntil: null,
  windows: [],
  lastUsedAt: NOW - 60_000,
  stepsLast24h: 3,
};

function renderDetail(runtimeUpdate: RuntimeUpdateSummary | null): string {
  return renderToStaticMarkup(
    createElement(
      I18nProvider,
      null,
      createElement(
        TooltipProvider,
        null,
        createElement(SubscriptionDetail, {
          account: ACCOUNT,
          models: [{ id: 'claude-opus-5-5', name: 'Claude Opus 5.5' }],
          now: NOW,
          view: { tone: 'ok', label: null, reason: null },
          verification: undefined,
          runtimeUpdate,
          actions: {
            onRemove: () => {},
            onVerify: () => {},
            onUpdateRuntime: () => {},
          },
        }),
      ),
    ),
  );
}

describe('provider settings runtime update UI', () => {
  test('runtimeUpdateSummary aggregates versions and hides stale available versions', () => {
    const sources: ModelSource[] = [
      {
        runtime: 'claude-code',
        installed: true,
        hostname: 'mbp',
        models: [],
        version: '2.1.330',
        runtimeUpdate: { installedVersion: '2.1.330', availableVersion: '2.1.331', phase: 'idle' },
      },
    ];
    expect(runtimeUpdateSummary(sources, 'claude-code')).toEqual({
      runtime: 'claude-code',
      installedVersion: '2.1.330',
      availableVersion: '2.1.331',
      phase: 'idle',
    });

    const upToDate: ModelSource[] = [
      {
        runtime: 'claude-code',
        installed: true,
        hostname: 'mbp',
        models: [],
        version: '2.1.331',
        runtimeUpdate: { installedVersion: '2.1.331', availableVersion: '2.1.330', phase: 'idle' },
      },
    ];
    expect(runtimeUpdateSummary(upToDate, 'claude-code')).toEqual({
      runtime: 'claude-code',
      installedVersion: '2.1.331',
      availableVersion: null,
      phase: 'idle',
    });
  });

  test('renders Update button only when an update is available, updating, or failed', () => {
    const idleHtml = renderDetail({
      runtime: 'claude-code',
      installedVersion: '2.1.330',
      availableVersion: null,
      phase: 'idle',
    });
    expect(idleHtml).toContain('v2.1.330');
    expect(idleHtml).not.toContain('data-testid="runtime-update"');

    const availableHtml = renderDetail({
      runtime: 'claude-code',
      installedVersion: '2.1.330',
      availableVersion: '2.1.331',
      phase: 'idle',
    });
    expect(availableHtml).toContain('data-testid="runtime-update"');
    expect(availableHtml).toContain('Version v2.1.331 is available');

    const updatingHtml = renderDetail({
      runtime: 'claude-code',
      installedVersion: '2.1.330',
      availableVersion: '2.1.331',
      phase: 'updating',
    });
    expect(updatingHtml).toContain('Updating…');
    expect(updatingHtml).toContain('running sessions are not interrupted');

    const failedHtml = renderDetail({
      runtime: 'claude-code',
      installedVersion: '2.1.330',
      availableVersion: '2.1.331',
      phase: 'failed',
    });
    expect(failedHtml).toContain(
      'The update failed validation; the current version remains in use.',
    );
  });

  test('machine_presence SSE invalidates model-sources', () => {
    expect(
      streamEventQueryEffect(
        { type: 'machine_presence', teamId: 'team-1' },
        ['model-sources', 'team-1'],
        undefined,
      ),
    ).toBe('cancel');
  });
});
