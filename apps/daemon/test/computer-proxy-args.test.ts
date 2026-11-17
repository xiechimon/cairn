import { describe, expect, it } from 'vitest';
import { browserProxyArgs } from '../src/computer/host-desktop.js';

describe('browserProxyArgs', () => {
  it('emits no proxy args without env', () => {
    expect(browserProxyArgs({})).toEqual([]);
  });

  it('routes every site through the env proxy', () => {
    expect(browserProxyArgs({ HTTPS_PROXY: 'http://127.0.0.1:7890' })).toEqual([
      '--proxy-server=http://127.0.0.1:7890',
    ]);
    expect(browserProxyArgs({ http_proxy: 'http://proxy:3128' })).toEqual([
      '--proxy-server=http://proxy:3128',
    ]);
  });

  it('prefers the per-site PAC URL over the flat proxy', () => {
    expect(
      browserProxyArgs({
        CAIRN_PROXY_PAC_URL: 'http://127.0.0.1:8788/cairn.pac',
        HTTPS_PROXY: 'http://127.0.0.1:7890',
      }),
    ).toEqual(['--proxy-pac-url=http://127.0.0.1:8788/cairn.pac']);
  });
});
