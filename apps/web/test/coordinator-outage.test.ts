import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { ChiefOutageBanner } from '../src/chief/chief-outage-banner.js';
import { resolveCoordinatorOutage } from '../src/chief/coordinator-outage.js';
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
