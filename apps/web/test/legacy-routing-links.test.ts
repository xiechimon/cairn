import { describe, expect, it } from 'vitest';
import { opensLegacyAccounts } from '../src/settings/settings-redirect.js';

const params = (query: string) => new URLSearchParams(query);

describe('opensLegacyAccounts', () => {
  it('sends the old accounts views to the provider list', () => {
    expect(opensLegacyAccounts(params('vendor=codex'))).toBe(true);
    expect(opensLegacyAccounts(params('tab=accounts'))).toBe(true);
  });

  it('keeps the routing graph for the old routing tab, even with a vendor', () => {
    expect(opensLegacyAccounts(params('tab=routing'))).toBe(false);
    expect(opensLegacyAccounts(params('tab=routing&vendor=codex'))).toBe(false);
  });

  it('leaves a plain visit on the routing page', () => {
    expect(opensLegacyAccounts(params(''))).toBe(false);
    expect(opensLegacyAccounts(params('scope=x'))).toBe(false);
  });
});
