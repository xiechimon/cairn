import { describe, expect, it } from 'vitest';
import { loginBannerLinks } from '../src/board/claude-login-banner.js';

describe('loginBannerLinks', () => {
  it('links only to machines for machine warnings', () => {
    expect(loginBannerLinks([{ source: 'machine' }, { source: 'machine' }])).toEqual([
      { id: 'machines', href: '/app/resources/machines' },
    ]);
  });

  it('links only to subscriptions and routing for subscription warnings', () => {
    expect(loginBannerLinks([{ source: 'subscription' }])).toEqual([
      { id: 'subscriptions', href: '/app/resources/model-routing' },
    ]);
  });

  it('gives both links when both kinds are present', () => {
    expect(loginBannerLinks([{ source: 'subscription' }, { source: 'machine' }])).toEqual([
      { id: 'machines', href: '/app/resources/machines' },
      { id: 'subscriptions', href: '/app/resources/model-routing' },
    ]);
  });
});
