import { useCallback, useEffect, useRef, useState } from 'react';
import { createDraftTransport } from '../api/drafts.js';
import { DraftSync } from './draft-sync.js';

function readLocal(localKey: string): string {
  try {
    return localStorage.getItem(localKey) ?? '';
  } catch {
    return '';
  }
}

function writeLocal(localKey: string, value: string): void {
  try {
    if (value === '') localStorage.removeItem(localKey);
    else localStorage.setItem(localKey, value);
  } catch {}
}

export function useServerDraft(options: {
  teamId: string | undefined;
  scope: string;
  localKey: string;
  enabled: boolean;
  initial?: string;
}): [string, (next: string | ((current: string) => string)) => void] {
  const { teamId, scope, localKey, enabled, initial = '' } = options;
  const [text, setText] = useState(() => (enabled ? readLocal(localKey) : initial));
  const textRef = useRef(text);
  const syncRef = useRef<DraftSync | null>(null);

  const adopt = useCallback((next: string) => {
    textRef.current = next;
    setText(next);
  }, []);

  useEffect(() => {
    if (!enabled) {
      adopt(initial);
      return;
    }
    if (teamId === undefined) return;
    const sync = new DraftSync({
      transport: createDraftTransport(teamId, scope),
      storage: localStorage,
      localKey,
      onRemote: adopt,
    });
    syncRef.current = sync;
    adopt(sync.current());
    void sync.refresh();
    const refresh = () => {
      if (document.visibilityState === 'visible') void sync.refresh();
    };
    const persist = () => void sync.flush({ keepalive: true });
    const leave = () => {
      if (document.visibilityState === 'hidden') persist();
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    document.addEventListener('visibilitychange', leave);
    window.addEventListener('pagehide', persist);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
      document.removeEventListener('visibilitychange', leave);
      window.removeEventListener('pagehide', persist);
      sync.dispose();
      if (syncRef.current === sync) syncRef.current = null;
    };
  }, [enabled, teamId, scope, localKey, initial, adopt]);

  const setDraft = useCallback(
    (next: string | ((current: string) => string)) => {
      const value = typeof next === 'function' ? next(textRef.current) : next;
      adopt(value);
      if (syncRef.current !== null) syncRef.current.edit(value);
      else if (enabled) writeLocal(localKey, value);
    },
    [adopt, enabled, localKey],
  );

  return [text, setDraft];
}
