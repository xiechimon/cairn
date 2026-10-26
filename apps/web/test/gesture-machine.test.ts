// Global gesture transitions (#1267). The chief drawer and the Escape
// layer stack change state only through reduceGesture. A second ⌘J is a
// second event that closes the drawer; it does not pass through an
// intermediate open (#1266). The browser half of that regression is
// e2e/chief-toggle-flash.spec.ts.
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
  createGestureStore,
  reduceGesture,
  type GestureState,
} from '../src/overlay/gesture-machine.js';

const webRoot = fileURLToPath(new URL('..', import.meta.url));

const closed: GestureState = { chief: 'none', escStack: [] };

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

describe('reduceGesture', () => {
  test('⌘J opens a closed drawer and the next event closes it (#1266)', () => {
    const opened = reduceGesture(closed, { type: 'chief/toggle' });
    expect(opened.dismissed).toBeNull();
    expect(opened.state.chief).toBe('drawer');

    const minimized = reduceGesture(opened.state, { type: 'chief/toggle' });
    expect(minimized.state.chief).toBe('none');
    expect(minimized.state.escStack).toEqual([]);
    expect(minimized.dismissed).toBeNull();
  });

  test('toggle from settings opens the drawer', () => {
    const settings: GestureState = { chief: 'settings', escStack: [] };
    expect(reduceGesture(settings, { type: 'chief/toggle' }).state.chief).toBe('drawer');
  });

  test('FAB open stays open; minimize from settings closes', () => {
    const opened = reduceGesture(closed, { type: 'chief/open' });
    expect(opened.state.chief).toBe('drawer');
    expect(reduceGesture(opened.state, { type: 'chief/open' }).state).toBe(opened.state);

    const settings = reduceGesture(opened.state, { type: 'chief/settings' });
    expect(settings.state.chief).toBe('settings');
    expect(reduceGesture(settings.state, { type: 'chief/minimize' }).state.chief).toBe('none');
  });

  test('Escape pops only the top layer and leaves the drawer alone', () => {
    let state: GestureState = { chief: 'drawer', escStack: [] };
    state = reduceGesture(state, { type: 'esc/push', id: 'a' }).state;
    state = reduceGesture(state, { type: 'esc/push', id: 'b' }).state;

    const first = reduceGesture(state, { type: 'escape' });
    expect(first.dismissed).toBe('b');
    expect(first.state.chief).toBe('drawer');
    expect(first.state.escStack).toEqual(['a']);

    const second = reduceGesture(first.state, { type: 'escape' });
    expect(second.dismissed).toBe('a');
    expect(second.state.escStack).toEqual([]);

    const idle = reduceGesture(second.state, { type: 'escape' });
    expect(idle.dismissed).toBeNull();
    expect(idle.state).toBe(second.state);
  });
});

describe('gesture store', () => {
  test('Escape runs the top closer and a later drop is a no-op', () => {
    const store = createGestureStore({ chief: 'drawer', escStack: [] });
    const log: string[] = [];
    const outer = store.pushLayer(() => log.push('outer'));
    store.pushLayer(() => log.push('inner'));

    store.dispatch({ type: 'escape' });
    expect(log).toEqual(['inner']);
    expect(store.getState().chief).toBe('drawer');
    expect(store.getState().escStack).toEqual([outer]);

    store.dropLayer(outer);
    expect(store.getState().escStack).toEqual([]);
    store.dispatch({ type: 'escape' });
    expect(log).toEqual(['inner']);
  });
});

describe('single landing file', () => {
  test('chief toggle updater and a second ⌘J or Escape listener are absent', () => {
    const src = walk(join(webRoot, 'src')).filter(
      (path) => path.endsWith('.ts') || path.endsWith('.tsx'),
    );
    const hits: string[] = [];
    for (const path of src) {
      if (path.endsWith(`${join('overlay', 'gesture-machine.ts')}`)) continue;
      const text = readFileSync(path, 'utf8');
      if (
        text.includes('setChiefView((') ||
        text.includes("prev === 'drawer'") ||
        text.includes("useChordHotkey('j'") ||
        text.includes('useChiefToggleHotkey')
      ) {
        hits.push(path.slice(webRoot.length + 1));
      }
    }
    const esc = readFileSync(join(webRoot, 'src/overlay/use-esc.ts'), 'utf8');
    expect(esc.includes('addEventListener')).toBe(false);
    expect(hits).toEqual([]);
  });

  test('#1266 flash spec stays in this regression set', () => {
    const spec = readFileSync(join(webRoot, 'e2e/chief-toggle-flash.spec.ts'), 'utf8');
    expect(spec).toContain('opacityTransitions');
    const affected = spawnSync(
      process.execPath,
      [
        join(webRoot, '../../scripts/e2e-affected.mjs'),
        '--dry-run',
        'apps/web/src/overlay/gesture-machine.ts',
      ],
      { encoding: 'utf8' },
    );
    expect(affected.stdout).toContain('chief-toggle-flash.spec.ts');
  });
});
