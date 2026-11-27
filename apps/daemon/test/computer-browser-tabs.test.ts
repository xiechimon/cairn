import { describe, expect, test } from 'vitest';
import { closeScopeTab, runBrowserTool } from '../src/computer/browser.js';
import type { ComputerProvider } from '../src/computer/provider.js';

interface FakeTab {
  label: string | null;
  url: string;
}

function sharedBrowser(): { provider: ComputerProvider; tabs: FakeTab[] } {
  const tabs: FakeTab[] = [{ label: null, url: 'about:blank' }];
  let active = 0;
  const provider: ComputerProvider = {
    async execute(request) {
      const words: string[] = [];
      const argv = request.argv.slice(1);
      for (let i = 0; i < argv.length; i += 1) {
        const word = argv[i] ?? '';
        if (word === '--session' || word === '--init-script') i += 1;
        else if (word !== '--headed' && word !== '--json') words.push(word);
      }
      const json = request.argv.includes('--json');
      let out = 'ok\n';
      if (words[0] === 'tab' && words[1] === 'list') {
        out = JSON.stringify({
          data: { tabs: tabs.map((tab, index) => ({ ...tab, active: index === active })) },
        });
      } else if (words[0] === 'tab' && words[1] === 'new') {
        tabs.push({ label: words[3] ?? null, url: 'about:blank' });
        active = tabs.length - 1;
      } else if (words[0] === 'tab' && words[1] === 'close') {
        const index = tabs.findIndex((tab) => tab.label === words[2]);
        tabs.splice(index, 1);
        active = 0;
      } else if (words[0] === 'tab') {
        active = tabs.findIndex((tab) => tab.label === words[1]);
      } else if (words[0] === 'open') {
        const tab = tabs[active];
        if (tab) tab.url = words[1] ?? '';
      } else if (words[0] === 'get' && words[1] === 'url') {
        const url = tabs[active]?.url ?? '';
        out = json ? JSON.stringify({ data: { url } }) : `${url}\n`;
      } else if (words[0] === 'snapshot') {
        out = `- heading "${tabs[active]?.url}" [ref=e1]\n`;
      }
      return (async function* () {
        yield { kind: 'stdout' as const, text: out };
        yield { kind: 'exit' as const, code: 0 };
      })();
    },
    async listFiles() {
      return [];
    },
    async readFile() {
      return '';
    },
    async writeFile() {},
    async killAll() {},
  };
  return { provider, tabs };
}

const run = (tabScope: string) => ({
  timeoutMs: 30_000,
  signal: new AbortController().signal,
  cairnOrigins: [],
  session: 'chief:tabs-test',
  tabScope,
});

describe('one browser tab per scope', () => {
  test('an invalid navigation is refused before the scoped tab is created', async () => {
    const { provider, tabs } = sharedBrowser();
    await expect(
      runBrowserTool(provider, 'browser_navigate', { url: 'file:///etc/passwd' }, run('secret')),
    ).rejects.toMatchObject({ delivery: 'not_delivered' });
    expect(tabs).toHaveLength(1);
  });

  test('two scopes navigating in turn keep their own page, and a card tab closes with its step', async () => {
    const { provider, tabs } = sharedBrowser();
    await runBrowserTool(
      provider,
      'browser_navigate',
      { url: 'https://coordinator.example/' },
      run('coordinator'),
    );
    await runBrowserTool(
      provider,
      'browser_navigate',
      { url: 'https://card.example/' },
      run('card-a'),
    );

    const coordinatorView = await runBrowserTool(
      provider,
      'browser_snapshot',
      {},
      run('coordinator'),
    );
    const cardView = await runBrowserTool(provider, 'browser_snapshot', {}, run('card-a'));
    expect(coordinatorView.text).toContain('https://coordinator.example/');
    expect(coordinatorView.text).not.toContain('card.example');
    expect(cardView.text).toContain('https://card.example/');

    await closeScopeTab(provider, { ...run('card-a'), tabScope: 'card-a' });
    expect(tabs.map((tab) => tab.label)).toEqual([null, 'cairn-coordinator']);
    const after = await runBrowserTool(provider, 'browser_snapshot', {}, run('coordinator'));
    expect(after.text).toContain('https://coordinator.example/');
  });
});
