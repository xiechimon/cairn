import type { TodoDeliverables } from '@cairn/shared';
import { useSyncExternalStore } from 'react';
import type { ThreadUpdates } from '../thread-panel-model.js';

export const INLINE_ARTIFACT_PREFIX = 'inline:';
const MAX_INLINE_ENTRIES = 64;

export interface InlineArtifactMeta {
  title: string;
  label?: string;
  stage?: string | null;
  when?: string | null;
  markdown: string;
  deliverables?: TodoDeliverables;
  todoId?: string;
  updates?: ThreadUpdates | null;
  readOnly?: boolean;
}

const entries = new Map<string, InlineArtifactMeta>();
const listeners = new Set<() => void>();

export function isInlineArtifactKey(key: string): boolean {
  return key.startsWith(INLINE_ARTIFACT_PREFIX);
}

export function inlineArtifactKey(id: string): string {
  return `${INLINE_ARTIFACT_PREFIX}${encodeURIComponent(id)}.md`;
}

export function registerInlineArtifact(key: string, meta: InlineArtifactMeta): void {
  if (entries.has(key)) entries.delete(key);
  entries.set(key, meta);
  while (entries.size > MAX_INLINE_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useInlineArtifact(key: string): InlineArtifactMeta | null {
  return useSyncExternalStore(
    subscribe,
    () => entries.get(key) ?? null,
    () => null,
  );
}
