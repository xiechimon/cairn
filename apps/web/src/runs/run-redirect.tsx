import { Navigate, useParams, useSearchParams } from 'react-router';
import { useChiefThreads } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { useRunTrace } from './run-trace-api.js';
import { TRACE_PARAM, TRACE_RUN_PARAM } from './trace-nav.js';

const TASK_TRACE_PARAM = 'taskTrace';
const TASK_RUN_PARAM = 'taskRun';

export function RunRedirect() {
  const { runId } = useParams();
  const [params] = useSearchParams();
  const { live, teamId } = useLiveData();
  const detail = useRunTrace(runId ?? null);
  const threads = useChiefThreads(teamId, live && detail.data !== undefined);
  const next = new URLSearchParams();
  const scenario = params.get('scenario');
  if (scenario !== null) next.set('scenario', scenario);
  if (params.get('thread') !== null) next.set('thread', params.get('thread') ?? '');
  const task = detail.data?.kind === 'task';
  next.set(task ? TASK_TRACE_PARAM : TRACE_PARAM, '1');
  if (runId !== undefined) next.set(task ? TASK_RUN_PARAM : TRACE_RUN_PARAM, runId);
  if (task && detail.data?.todoId !== null && detail.data?.todoId !== undefined) {
    next.delete('thread');
    next.set('thread', detail.data.todoId);
  }
  if (detail.data?.kind === 'coordinator') {
    if (live && threads.data === undefined) return null;
    const project = (threads.data ?? []).find(
      (thread) => thread.id === detail.data?.threadId,
    )?.projectId;
    next.delete('thread');
    if (project != null) {
      next.set('project', project);
      next.set('chat', '1');
    }
  }
  if (detail.isError) {
    const fallback = new URLSearchParams();
    if (scenario !== null) fallback.set('scenario', scenario);
    return <Navigate to={{ pathname: '/app', search: `?${fallback.toString()}` }} replace />;
  }
  if (runId !== undefined && detail.data === undefined) return null;
  return <Navigate to={{ pathname: '/app', search: `?${next.toString()}` }} replace />;
}
