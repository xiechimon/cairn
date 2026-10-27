import {
  createContext,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router';
import type { Phase } from '../fixtures/records.js';

export const PANEL_PARAM = 'panel';
export const TASK_PARAM = 'task';

export interface TaskSeed {
  title?: string;
  seq?: number;
  phase?: Phase;
}

interface OpenOptions {
  opener?: HTMLElement | null;
  focus?: boolean;
  seed?: TaskSeed;
}

export interface TaskPanelApi {
  open: boolean;
  taskId: string | null;
  seed: TaskSeed | null;
  hosted: boolean;
  needCount: number;
  wantsFocus: boolean;
  openTask: (id: string, options?: OpenOptions) => void;
  showList: (options?: OpenOptions) => void;
  close: () => void;
  registerHost: () => () => void;
  setNeedCount: (count: number) => void;
  focusTaken: () => void;
}

const CLOSED = { open: false, taskId: null };

const TaskPanelContext = createContext<TaskPanelApi | null>(null);

export function useTaskPanel(): TaskPanelApi | null {
  return useContext(TaskPanelContext);
}

export function TaskPanelRoot({
  children,
  onTaskOpen,
}: {
  children: ReactNode;
  onTaskOpen?: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const [state, setState] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const taskId = params.get(TASK_PARAM);
    return { open: params.has(PANEL_PARAM) || taskId != null, taskId };
  });
  const [seed, setSeed] = useState<TaskSeed | null>(null);
  const [hosts, setHosts] = useState(0);
  const [needCount, setNeedCount] = useState(0);
  const [wantsFocus, setWantsFocus] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const wasHosted = useRef(false);
  const onTaskOpenRef = useRef(onTaskOpen);
  onTaskOpenRef.current = onTaskOpen;
  const hosted = hosts > 0;

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const inUrl = params.has(PANEL_PARAM) || params.has(TASK_PARAM);
    if (navigationType === 'POP')
      setState(inUrl ? { open: true, taskId: params.get(TASK_PARAM) } : CLOSED);
    if (!inUrl) return;
    params.delete(PANEL_PARAM);
    params.delete(TASK_PARAM);
    const rest = params.toString();
    navigate(
      { pathname: location.pathname, search: rest === '' ? '' : `?${rest}`, hash: location.hash },
      { replace: true, state: location.state },
    );
  }, [location, navigationType, navigate]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const panel = hosted && state.open ? '1' : null;
    const task = hosted && state.open ? state.taskId : null;
    if (url.searchParams.get(PANEL_PARAM) === panel && url.searchParams.get(TASK_PARAM) === task)
      return;
    if (panel == null) url.searchParams.delete(PANEL_PARAM);
    else url.searchParams.set(PANEL_PARAM, panel);
    if (task == null) url.searchParams.delete(TASK_PARAM);
    else url.searchParams.set(TASK_PARAM, task);
    window.history.replaceState(window.history.state, '', url);
  }, [hosted, state, location]);

  useEffect(() => {
    if (wasHosted.current && !hosted) {
      setState(CLOSED);
      opener.current = null;
    }
    wasHosted.current = hosted;
  }, [hosted]);

  const openTask = useCallback((id: string, options: OpenOptions = {}) => {
    if (options.opener !== undefined) opener.current = options.opener;
    setSeed(options.seed ?? null);
    setState({ open: true, taskId: id });
    setWantsFocus(options.focus === true);
    onTaskOpenRef.current?.();
  }, []);

  const showList = useCallback((options: OpenOptions = {}) => {
    if (options.opener !== undefined) opener.current = options.opener;
    setState({ open: true, taskId: null });
    setWantsFocus(options.focus === true);
  }, []);

  const close = useCallback(() => {
    setState(CLOSED);
    const target = opener.current;
    opener.current = null;
    if (target != null) requestAnimationFrame(() => target.isConnected && target.focus());
  }, []);

  const focusTaken = useCallback(() => setWantsFocus(false), []);

  const registerHost = useCallback(() => {
    setHosts((n) => n + 1);
    return () => setHosts((n) => n - 1);
  }, []);

  const api = useMemo<TaskPanelApi>(
    () => ({
      open: state.open,
      taskId: state.taskId,
      seed,
      hosted,
      needCount,
      wantsFocus,
      openTask,
      showList,
      close,
      registerHost,
      setNeedCount,
      focusTaken,
    }),
    [
      state,
      seed,
      hosted,
      needCount,
      wantsFocus,
      openTask,
      showList,
      close,
      registerHost,
      focusTaken,
    ],
  );
  return <TaskPanelContext.Provider value={api}>{children}</TaskPanelContext.Provider>;
}

export function isPlainClick(event: MouseEvent): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

export function useOpenTaskInPlace() {
  const panel = useTaskPanel();
  return useCallback(
    (event: MouseEvent<HTMLElement>, id: string, seed?: TaskSeed): boolean => {
      if (panel == null || !panel.hosted || !isPlainClick(event)) return false;
      event.preventDefault();
      panel.openTask(id, { opener: event.currentTarget, focus: event.detail === 0, seed });
      return true;
    },
    [panel],
  );
}
