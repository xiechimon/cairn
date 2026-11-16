import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { MachineIdentityContext, MachineName, type NamedMachine } from '../src/components/machine-label.js';

function render(capabilities: NamedMachine['capabilities']): string {
  return renderToStaticMarkup(createElement(MachineName, { machine: { name: 'runner', capabilities } }));
}

describe('machine OS identity', () => {
  test.each([
    ['darwin', 'arch', 'macOS'],
    ['windows', 'ubuntu', 'Windows'],
    ['linux', 'arch', 'Arch Linux'],
    ['linux', 'ubuntu', 'Ubuntu'],
    ['linux', 'debian', 'Debian'],
    ['linux', 'manjaro', 'Manjaro'],
    ['linux', 'unknown-derivative', 'Linux'],
    ['linux', 'Arch', 'Linux'],
    ['linux', 'constructor', 'Linux'],
    ['linux', undefined, 'Linux'],
  ] as const)('renders %s / %s as %s', (osPlatform, osDistribution, label) => {
    const html = render({ osPlatform, osDistribution });
    expect(html).toContain(`data-slot="machine-os-icon" aria-hidden="true" title="${label}"`);
    expect(html).not.toContain('aria-label=');
    expect(html).toContain('runner');
  });

  test('Arch and Ubuntu have different marks; unknown OS never borrows a Linux mark', () => {
    const arch = render({ osPlatform: 'linux', osDistribution: 'arch' });
    const ubuntu = render({ osPlatform: 'linux', osDistribution: 'ubuntu' });
    expect(arch.match(/<path d="([^"]+)"/)?.[1]).not.toBe(ubuntu.match(/<path d="([^"]+)"/)?.[1]);
    expect(render({ osPlatform: 'other', osDistribution: 'arch' })).toContain('aria-hidden="true"');
    expect(render(undefined)).not.toContain('aria-label=');
  });

  test('duplicate-name suffixes survive the leading mark and plain-text names stay escaped', () => {
    const machine: NamedMachine = { id: 'machine-one1234', name: 'Arch <runner>', capabilities: { osPlatform: 'linux' } };
    const html = renderToStaticMarkup(createElement(MachineName, { machine, all: [machine, { id: 'other-5678', name: machine.name }] }));
    expect(html).toContain('Arch &lt;runner&gt;');
    expect(html).toContain('#1234');
    expect(html).toContain('title="Linux"');
  });

  test('id-only references resolve current metadata, never guess by name or replace explicit metadata', () => {
    const machines: NamedMachine[] = [{ id: 'arch-1', name: 'runner', capabilities: { osPlatform: 'linux', osDistribution: 'arch' } }];
    for (const [machine, expected] of [
      [{ id: 'arch-1', name: 'previous-name' }, 'Arch Linux'],
      [{ id: 'other-id', name: 'runner' }, null],
      [{ name: 'runner' }, null],
      [{ id: 'arch-1', name: 'runner', capabilities: { osPlatform: 'linux', osDistribution: 'ubuntu' } }, 'Ubuntu'],
    ] as const) {
      const html = renderToStaticMarkup(createElement(MachineIdentityContext.Provider, { value: machines, children: createElement(MachineName, { machine }) }));
      if (expected === null) expect(html).not.toContain('title=');
      else expect(html).toContain(`title="${expected}"`);
    }
  });
});
