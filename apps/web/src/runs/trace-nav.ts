import { useSearchParams } from 'react-router';

export const TRACE_PARAM = 'trace';
export const TRACE_RUN_PARAM = 'run';
export const TRACE_STEP_PARAM = 'step';
export const TRACE_NONE = '~';

const taskKey = (key: string) => `task${key.charAt(0).toUpperCase()}${key.slice(1)}`;

function put(params: URLSearchParams, key: string, value: string | null | undefined): void {
  if (value === null || value === undefined || value === '') params.delete(key);
  else params.set(key, value);
}

export interface TraceNav {
  tracing: boolean;
  runId: string | null;
  stepId: string | null;
  open: (runId?: string | null, stepId?: string | null) => void;
  close: () => void;
  select: (runId: string | null, stepId: string | null) => void;
}

export function useTraceNav(surface: 'task' | null = null): TraceNav {
  const [params, setParams] = useSearchParams();
  const key = (name: string) => (surface === null ? name : taskKey(name));
  const tracing = params.get(key(TRACE_PARAM)) === '1';
  const runId = params.get(key(TRACE_RUN_PARAM));
  const stepId = params.get(key(TRACE_STEP_PARAM));
  const write = (mutate: (next: URLSearchParams) => void, replace = false) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        mutate(next);
        return next;
      },
      { replace },
    );
  const open = (run: string | null = null, step: string | null = null) =>
    write((next) => {
      next.set(key(TRACE_PARAM), '1');
      put(next, key(TRACE_RUN_PARAM), run);
      put(next, key(TRACE_STEP_PARAM), step);
    });
  return {
    tracing,
    runId,
    stepId,
    open,
    close: () =>
      write((next) => {
        next.delete(key(TRACE_PARAM));
        next.delete(key(TRACE_RUN_PARAM));
        next.delete(key(TRACE_STEP_PARAM));
      }),
    select: (run, step) =>
      write((next) => {
        put(next, key(TRACE_RUN_PARAM), run);
        put(next, key(TRACE_STEP_PARAM), step);
      }, true),
  };
}
