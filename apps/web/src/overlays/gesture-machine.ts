import { isEditableOutsideChiefDrawer } from './hotkeys.js';

export type ChiefView = 'none' | 'drawer' | 'settings';

export interface GestureState {
  chief: ChiefView;
  escStack: readonly string[];
}

export type GestureEvent =
  | { type: 'chief/toggle' }
  | { type: 'chief/open' }
  | { type: 'chief/minimize' }
  | { type: 'chief/settings' }
  | { type: 'esc/push'; id: string }
  | { type: 'esc/drop'; id: string }
  | { type: 'escape' };

export interface GestureResult {
  state: GestureState;
  dismissed: string | null;
}

const idle = (state: GestureState): GestureResult => ({ state, dismissed: null });

function withChief(state: GestureState, chief: ChiefView): GestureResult {
  if (state.chief === chief) return idle(state);
  return { state: { ...state, chief }, dismissed: null };
}

export function reduceGesture(state: GestureState, event: GestureEvent): GestureResult {
  switch (event.type) {
    case 'chief/toggle':
      return withChief(state, state.chief === 'drawer' ? 'none' : 'drawer');
    case 'chief/open':
      return withChief(state, 'drawer');
    case 'chief/minimize':
      return withChief(state, 'none');
    case 'chief/settings':
      return withChief(state, 'settings');
    case 'esc/push': {
      if (state.escStack.includes(event.id)) {
        const rest = state.escStack.filter((id) => id !== event.id);
        return { state: { ...state, escStack: [...rest, event.id] }, dismissed: null };
      }
      return { state: { ...state, escStack: [...state.escStack, event.id] }, dismissed: null };
    }
    case 'esc/drop': {
      if (!state.escStack.includes(event.id)) return idle(state);
      return {
        state: { ...state, escStack: state.escStack.filter((id) => id !== event.id) },
        dismissed: null,
      };
    }
    case 'escape': {
      if (state.escStack.length === 0) return idle(state);
      const dismissed = state.escStack[state.escStack.length - 1] ?? null;
      return {
        state: { ...state, escStack: state.escStack.slice(0, -1) },
        dismissed,
      };
    }
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

export interface GestureStore {
  getState: () => GestureState;
  subscribe: (listener: () => void) => () => void;
  dispatch: (event: GestureEvent) => GestureResult;
  pushLayer: (onClose: () => void) => string;
  dropLayer: (id: string) => void;
}

export function createGestureStore(initial: GestureState): GestureStore {
  let state = initial;
  const listeners = new Set<() => void>();
  const closers = new Map<string, () => void>();
  let seq = 0;
  const store: GestureStore = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch(event) {
      const result = reduceGesture(state, event);
      const changed = result.state !== state;
      state = result.state;
      if (changed) {
        for (const listener of listeners) listener();
      }
      if (result.dismissed !== null) {
        const close = closers.get(result.dismissed);
        closers.delete(result.dismissed);
        close?.();
      }
      return result;
    },
    pushLayer(onClose) {
      const id = `layer-${seq}`;
      seq += 1;
      closers.set(id, onClose);
      store.dispatch({ type: 'esc/push', id });
      return id;
    },
    dropLayer(id) {
      closers.delete(id);
      store.dispatch({ type: 'esc/drop', id });
    },
  };
  return store;
}

let singleton: GestureStore | null = null;

export function getGestureStore(initialChief?: ChiefView): GestureStore {
  if (singleton === null) {
    singleton = createGestureStore({ chief: initialChief ?? 'none', escStack: [] });
  }
  return singleton;
}

export function bindGestureKeys(store: GestureStore): () => void {
  const onKey = (event: KeyboardEvent) => {
    if (event.isComposing) return;
    if (event.key === 'Escape') {
      store.dispatch({ type: 'escape' });
      return;
    }
    if (event.defaultPrevented || event.repeat) return;
    if (!(event.metaKey || event.ctrlKey)) return;
    if (event.key.toLowerCase() !== 'j') return;
    if (isEditableOutsideChiefDrawer(event.target)) return;
    event.preventDefault();
    store.dispatch({ type: 'chief/toggle' });
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}

let unbindKeys: (() => void) | null = null;

export function ensureGestureKeys(): void {
  if (unbindKeys !== null) return;
  if (typeof window === 'undefined') return;
  unbindKeys = bindGestureKeys(getGestureStore());
}

export function pushEscLayer(onClose: () => void): string {
  return getGestureStore().pushLayer(onClose);
}

export function dropEscLayer(id: string): void {
  getGestureStore().dropLayer(id);
}
