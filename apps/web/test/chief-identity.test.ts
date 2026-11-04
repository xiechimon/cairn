import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, test } from 'vitest';
import { ChiefIdentity } from '../src/chief/chief-identity.js';
import { AVATAR_IMG_CLS } from '../src/chief/recipes.js';
import type { ChiefContent } from '../src/fixtures/records.js';
import { spiralAvatarUrl } from '../src/lib/spiral-avatar.js';

type BoundAgent = NonNullable<ChiefContent['agent']>;

function render(agent: BoundAgent, entry = '/app'): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [entry] },
      createElement(ChiefIdentity, { agent }),
    ),
  );
}

const WITH_ID: BoundAgent = { id: 'r3-builder', displayName: 'r3-builder', avatarUrl: null };
const NO_ID: BoundAgent = { displayName: 'r3-builder', avatarUrl: null };

describe('chief robot row identity chip (#741)', () => {
  test('F-U6: agent.id present → anchor, href = /app/resources/agents/<id>', () => {
    const markup = render(WITH_ID);
    expect(markup).toMatch(/<a [^>]*href="\/app\/resources\/agents\/r3-builder"/);

    expect(markup).toMatch(/<a [^>]*class="[^"]*inline-flex items-center gap-1\.5/);
  });

  test('F-U7: agent.id absent → lazy span, no anchor, name renders as usual', () => {
    const markup = render(NO_ID);
    expect(markup).not.toContain('<a ');

    expect(markup).toMatch(/<span [^>]*class="inline-flex items-center gap-1\.5[^"]*"/);
    expect(markup).toContain('r3-builder');
  });

  test('F-U8: chip renders the name (avatar + name side by side, the reference-site shape)', () => {
    const markup = render(WITH_ID);

    expect(markup).toMatch(/<span class="[^"]*text-meta leading-4[^"]*">r3-builder<\/span>/);
    expect(markup).toMatch(/<span[^>]*>r3-builder<\/span>/);
  });

  test('F-U9: scenario search rides along (#121 Link law)', () => {
    const markup = render(WITH_ID, '/app?scenario=chief-agent-chip');
    expect(markup).toContain('href="/app/resources/agents/r3-builder?scenario=chief-agent-chip"');
  });

  test('F-U10: avatar slot keeps the XMON-105 single source (AVATAR_IMG_CLS + SeededAvatar img)', () => {
    const markup = render(WITH_ID);

    expect(markup).toContain(AVATAR_IMG_CLS.replaceAll('&', '&amp;'));
    expect(markup).toContain('<img');
    expect(markup).toContain(spiralAvatarUrl(WITH_ID.displayName).replaceAll('&', '&amp;'));
  });
});
