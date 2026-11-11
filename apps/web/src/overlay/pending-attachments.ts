import { useCallback, useEffect, useRef, useState } from 'react';
import type { PendingAttachment } from './attachment-paste.js';

export interface PendingTracker {
  pending: PendingAttachment[];
  track: (files: File[]) => string[];
  untrack: (uids: string[]) => void;
  fail: (uid: string) => void;
  clearFailed: () => void;
}

function revoke(entry: PendingAttachment): void {
  if (entry.url !== null) URL.revokeObjectURL(entry.url);
}

export function usePendingAttachments(): PendingTracker {
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const seqRef = useRef(0);
  const liveRef = useRef<PendingAttachment[]>([]);
  liveRef.current = pending;

  const track = useCallback((files: File[]): string[] => {
    const entries: PendingAttachment[] = files.map((file) => {
      seqRef.current += 1;
      return {
        uid: `pending-${seqRef.current}`,
        name: file.name,
        mime: file.type,
        size: file.size,
        url: file.type.toLowerCase().startsWith('image/') ? URL.createObjectURL(file) : null,
        failed: false,
      };
    });
    setPending((current) => [...current, ...entries]);
    return entries.map((entry) => entry.uid);
  }, []);

  const untrack = useCallback((uids: string[]): void => {
    if (uids.length === 0) return;
    const gone = new Set(uids);
    setPending((current) => {
      for (const entry of current) {
        if (gone.has(entry.uid)) revoke(entry);
      }
      return current.filter((entry) => !gone.has(entry.uid));
    });
  }, []);

  const fail = useCallback((uid: string): void => {
    setPending((current) =>
      current.map((entry) => (entry.uid === uid ? { ...entry, failed: true } : entry)),
    );
  }, []);

  const clearFailed = useCallback((): void => {
    setPending((current) => {
      if (!current.some((entry) => entry.failed)) return current;
      for (const entry of current) {
        if (entry.failed) revoke(entry);
      }
      return current.filter((entry) => !entry.failed);
    });
  }, []);

  useEffect(
    () => () => {
      for (const entry of liveRef.current) revoke(entry);
    },
    [],
  );

  return { pending, track, untrack, fail, clearFailed };
}
