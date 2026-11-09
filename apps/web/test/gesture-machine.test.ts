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
  test('settings opens and minimize returns to the conversation', () => {
    const settings = reduceGesture(closed, { type: 'chief/settings' });
    expect(settings.state.chief).toBe('settings');
    expect(reduceGesture(settings.state, { type: 'chief/settings' }).state).toBe(settings.state);
    expect(reduceGesture(settings.state, { type: 'chief/minimize' }).state.chief).toBe('none');
  });

  test('Escape pops only the top layer and leaves the Coordinator view alone', () => {
    let state: GestureState = { chief: 'settings', escStack: [] };
    state = reduceGesture(state, { type: 'esc/push', id: 'a' }).state;
    state = reduceGesture(state, { type: 'esc/push', id: 'b' }).state;

    const first = reduceGesture(state, { type: 'escape' });
    expect(first.dismissed).toBe('b');
    expect(first.state.chief).toBe('settings');
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
    const store = createGestureStore({ chief: 'settings', escStack: [] });
    const log: string[] = [];
    const outer = store.pushLayer(() => log.push('outer'));
    store.pushLayer(() => log.push('inner'));

    store.dispatch({ type: 'escape' });
    expect(log).toEqual(['inner']);
    expect(store.getState().chief).toBe('settings');
    expect(store.getState().escStack).toEqual([outer]);

    store.dropLayer(outer);
    expect(store.getState().escStack).toEqual([]);
    store.dispatch({ type: 'escape' });
    expect(log).toEqual(['inner']);
  });
});

describe('single landing file', () => {
  test('no chief view updater or second Escape listener exists', () => {
    const src = walk(join(webRoot, 'src')).filter(
      (path) => path.endsWith('.ts') || path.endsWith('.tsx'),
    );
    const hits: string[] = [];
    for (const path of src) {
      if (path.endsWith(`${join('overlay', 'gesture-machine.ts')}`)) continue;
      const text = readFileSync(path, 'utf8');
      if (
        text.includes('setChiefView((') ||
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

});
