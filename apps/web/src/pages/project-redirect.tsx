import { Navigate, useParams, useSearchParams } from 'react-router';
import { ARTIFACT_NAME_PARAM, ARTIFACT_PARAM } from '../board/file-pane.js';
import { THREAD_PARAM, VIEW_PARAM } from '../board/thread-copy.js';
import { PANE_PARAM, TASKS_TAB_PARAM } from '../board/work-panel.js';

export function ProjectHomeRedirect({ pane, tab }: { pane?: 'tasks'; tab?: 'scheduled' }) {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const next = new URLSearchParams(searchParams);
  next.delete(THREAD_PARAM);
  next.delete(VIEW_PARAM);
  next.delete(ARTIFACT_PARAM);
  next.delete(ARTIFACT_NAME_PARAM);
  if (id !== undefined) {
    next.set('project', id);
    next.set('chat', '1');
  }
  if (pane !== undefined) next.set(PANE_PARAM, pane);
  else next.delete(PANE_PARAM);
  if (tab !== undefined) next.set(TASKS_TAB_PARAM, tab);
  else next.delete(TASKS_TAB_PARAM);
  return <Navigate to={{ pathname: '/app', search: `?${next.toString()}` }} replace />;
}
