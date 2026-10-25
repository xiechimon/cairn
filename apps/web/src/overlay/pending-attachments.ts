import { useCallback, useEffect, useRef, useState } from 'react';
import type { PendingAttachment } from './attachment-paste.js';

export interface PendingTracker {
  pending: PendingAttachment[];
  track: (files: File[]) => string[];
  untrack: (uids: string[]) => void;
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
        url: file.type.toLowerCase().startsWith('image/') ? URL.createObjectURL(file) : null,
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
        if (gone.has(entry.uid) && entry.url !== null) URL.revokeObjectURL(entry.url);
      }
      return current.filter((entry) => !gone.has(entry.uid));
    });
  }, []);

  useEffect(
    () => () => {
      for (const entry of liveRef.current) {
        if (entry.url !== null) URL.revokeObjectURL(entry.url);
      }
    },
    [],
  );

  return { pending, track, untrack };
}
