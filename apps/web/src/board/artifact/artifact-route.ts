import { attachmentExtOf } from '@cairn/shared';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { safeSessionStorage } from '../../safe-storage.js';
import { ARTIFACT_NAME_PARAM, ARTIFACT_PARAM, type FileTarget } from '../file-pane.js';
import { PANE_PARAM, TASKS_TAB_PARAM } from '../work-panel.js';

const TABS_KEY = 'cairn.artifact-tabs';
const MAX_TABS = 12;
let openCount = 0;

function openedOf(state: unknown): number {
  if (typeof state !== 'object' || state === null || !('artifactOpened' in state)) return 0;
  return typeof state.artifactOpened === 'number' ? state.artifactOpened : 0;
}

export function artifactKey(attachmentId: string, fileName: string): string {
  const ext = attachmentExtOf(fileName);
  return ext === '' ? attachmentId : `${attachmentId}.${ext}`;
}

export function artifactTargetOf(params: URLSearchParams): FileTarget | null {
  const key = params.get(ARTIFACT_PARAM);
  if (key === null || key === '') return null;
  return { key, name: params.get(ARTIFACT_NAME_PARAM) ?? key.slice(key.lastIndexOf('/') + 1) };
}

export function withArtifact(prev: URLSearchParams, target: FileTarget | null): URLSearchParams {
  const params = new URLSearchParams(prev);
  if (target === null) {
    params.delete(ARTIFACT_PARAM);
    params.delete(ARTIFACT_NAME_PARAM);
    return params;
  }
  params.delete(PANE_PARAM);
  params.delete(TASKS_TAB_PARAM);
  params.set(ARTIFACT_PARAM, target.key);
  params.set(ARTIFACT_NAME_PARAM, target.name);
  return params;
}

const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedTabs: readonly FileTarget[] = [];
let memoryOnly = false;

function readTabs(): readonly FileTarget[] {
  const storage = safeSessionStorage();
  if (storage === null || memoryOnly) return cachedTabs;
  const raw = storage.getItem(TABS_KEY);
  if (raw === cachedRaw) return cachedTabs;
  cachedRaw = raw;
  try {
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    cachedTabs = Array.isArray(parsed)
      ? parsed.filter(
          (tab): tab is FileTarget =>
            typeof tab === 'object' &&
            tab !== null &&
            typeof (tab as FileTarget).key === 'string' &&
            typeof (tab as FileTarget).name === 'string',
        )
      : [];
  } catch {
    cachedTabs = [];
  }
  return cachedTabs;
}

function writeTabs(tabs: readonly FileTarget[]): void {
  cachedTabs = tabs.slice(-MAX_TABS);
  cachedRaw = JSON.stringify(cachedTabs);
  try {
    safeSessionStorage()?.setItem(TABS_KEY, cachedRaw);
  } catch {
    memoryOnly = true;
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function tabsWith(
  tabs: readonly FileTarget[],
  target: FileTarget,
  replaces: string | null,
): FileTarget[] {
  if (tabs.some((tab) => tab.key === target.key))
    return tabs.map((tab) => (tab.key === target.key ? target : tab));
  if (replaces !== null && tabs.some((tab) => tab.key === replaces))
    return tabs.map((tab) => (tab.key === replaces ? target : tab));
  return [...tabs, target];
}

export interface ArtifactPanelState {
  target: FileTarget | null;
  opened: number;
  tabs: readonly FileTarget[];
  open: (target: FileTarget, replaces?: string | null) => void;
  select: (target: FileTarget) => void;
  closeTab: (key: string) => void;
  closePanel: () => void;
}

export function useArtifactPanel(): ArtifactPanelState {
  const location = useLocation();
  const navigate = useNavigate();
  const stored = useSyncExternalStore(subscribe, readTabs);
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const target = artifactTargetOf(params);
  const tabs = useMemo(
    () => (target === null ? stored : tabsWith(stored, target, null)),
    [stored, target?.key, target?.name],
  );
  const go = useCallback(
    (next: FileTarget | null, replace: boolean, state?: { artifactOpened: number }) => {
      const search = withArtifact(new URLSearchParams(location.search), next).toString();
      navigate(
        { pathname: location.pathname, search: search === '' ? '' : `?${search}` },
        { replace, state },
      );
    },
    [navigate, location.pathname, location.search],
  );
  const open = useCallback(
    (next: FileTarget, replaces: string | null = null) => {
      writeTabs(tabsWith(readTabs(), next, replaces));
      openCount += 1;
      go(next, target !== null, { artifactOpened: openCount });
    },
    [go, target],
  );
  const select = useCallback((next: FileTarget) => go(next, true), [go]);
  const closePanel = useCallback(() => go(null, true), [go]);
  const closeTab = useCallback(
    (key: string) => {
      const current = tabsWith(readTabs(), target ?? { key, name: key }, null);
      const at = current.findIndex((tab) => tab.key === key);
      const rest = current.filter((tab) => tab.key !== key);
      writeTabs(rest);
      if (target?.key !== key) return;
      const neighbour = rest[Math.min(Math.max(at, 0), rest.length - 1)];
      go(neighbour ?? null, true);
    },
    [go, target],
  );
  return { target, opened: openedOf(location.state), tabs, open, select, closeTab, closePanel };
}
