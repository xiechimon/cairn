import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { ChiefOutageBanner } from '../src/chief/chief-outage-banner.js';
import {
  resolveCoordinatorNotice,
  resolveCoordinatorOutage,
} from '../src/chief/coordinator-outage.js';
import { I18nProvider } from '../src/i18n/provider.js';

describe('resolveCoordinatorOutage & ChiefOutageBanner', () => {
  test('prefers chief.outage when present and maps turnQueue blocked reasons cleanly', () => {
    expect(
      resolveCoordinatorOutage(
        { reason: 'capacity', model: 'anthropic/claude-opus', retryAt: null },
        {
          turnQueue: {
            position: 1,
            waitingFor: null,
            blocked: { kind: 'machine-offline', missing: [] },
          },
        },
      ),
    ).toEqual({ reason: 'capacity', model: 'anthropic/claude-opus', retryAt: null });

    expect(
      resolveCoordinatorOutage(null, {
        turnQueue: {
          position: 1,
          waitingFor: null,
          blocked: { kind: 'claude-logged-out', missing: [] },
        },
      }),
    ).toEqual({ reason: 'subscription', model: null, retryAt: null });

    expect(
      resolveCoordinatorOutage(null, {
        turnQueue: {
          position: 1,
          waitingFor: null,
          blocked: { kind: 'machine-offline', missing: [] },
        },
      }),
    ).toEqual({ reason: 'runner-offline', model: null, retryAt: null });

    expect(
      resolveCoordinatorOutage(null, {
        turnQueue: {
          position: 1,
          waitingFor: null,
          blocked: { kind: 'claude-rate-limited', missing: [] },
        },
      }),
    ).toEqual({ reason: 'quota', model: null, retryAt: null });
  });

  test.each([
    ['quota', 'The Coordinator is unavailable', 'out of quota'],
    ['capacity', 'The Coordinator is unavailable', 'overloaded'],
    ['subscription', 'The Coordinator is unavailable', 'expired or unauthorized'],
    ['runner-offline', 'The Coordinator is unavailable', 'Runner for the Coordinator is offline'],
  ] as const)('renders %s outage with one-sentence reason and change-model action', (reason, title, snippet) => {
    const html = renderToStaticMarkup(
      createElement(I18nProvider, {
        initialLocale: 'en',
        children: createElement(ChiefOutageBanner, {
          outage: { reason, model: 'claude-sonnet-4-5', retryAt: null },
          onSettings: () => {},
        }),
      }),
    );
    expect(html).toContain('data-testid="chief-outage"');
    expect(html).toContain(title);
    expect(html).toContain(snippet);
    expect(html).toContain("Change the Coordinator&#x27;s model");
  });
});

describe('one notice per offline event', () => {
  const runnerOffline = { reason: 'runner-offline', model: null, retryAt: null } as const;
  const wait = { kind: 'machine-offline', machine: 'mac-mini' } as const;
  const card = (machineName: string, backAt: number | null = null) => ({ machineName, backAt });
  const machines = ['mac-mini'];

  test('an open Runner-offline card owns the event and hides both the banner and the queue card', () => {
    expect(resolveCoordinatorNotice(runnerOffline, wait, [card('mac-mini')], machines)).toEqual({
      outage: null,
      queueWait: null,
    });
    expect(resolveCoordinatorNotice(runnerOffline, null, [card('mac-mini')], machines)).toEqual({
      outage: null,
      queueWait: null,
    });
  });

  test('without an open card for this Runner the banner stays the one persistent notice', () => {
    expect(resolveCoordinatorNotice(runnerOffline, wait, [], machines)).toEqual({
      outage: runnerOffline,
      queueWait: wait,
    });
    expect(resolveCoordinatorNotice(runnerOffline, wait, [card('other-mac')], machines)).toEqual({
      outage: runnerOffline,
      queueWait: wait,
    });
    expect(
      resolveCoordinatorNotice(runnerOffline, wait, [card('mac-mini', 123)], machines),
    ).toEqual({ outage: runnerOffline, queueWait: wait });
  });

  test('a queue card for another Runner stays beside the covered Runner notice', () => {
    const otherWait = { kind: 'machine-offline', machine: 'other-mac' } as const;
    expect(
      resolveCoordinatorNotice(runnerOffline, otherWait, [card('mac-mini')], machines),
    ).toEqual({ outage: null, queueWait: otherWait });
  });

  test('another reason keeps its banner beside an open card, because it is a different event', () => {
    const quota = { reason: 'quota', model: 'relay-a/opus', retryAt: 5 } as const;
    expect(resolveCoordinatorNotice(quota, wait, [card('mac-mini')], machines)).toEqual({
      outage: quota,
      queueWait: wait,
    });
  });
});
