import { Navigate, useParams, useSearchParams } from 'react-router';
import { ARTIFACT_NAME_PARAM, ARTIFACT_PARAM } from '../board/file-pane.js';
import { THREAD_PARAM, VIEW_PARAM } from '../board/thread-copy.js';
import { PANE_PARAM, TASKS_TAB_PARAM } from '../board/work-panel.js';

export function projectRedirectSearch(
  searchParams: URLSearchParams,
  options: { id?: string; pane?: 'tasks'; tab?: 'scheduled' },
): string {
  const next = new URLSearchParams(searchParams);
  next.delete(THREAD_PARAM);
  next.delete(VIEW_PARAM);
  next.delete(ARTIFACT_PARAM);
  next.delete(ARTIFACT_NAME_PARAM);
  next.delete('chief');
  if (options.id !== undefined) {
    next.set('project', options.id);
    next.set('chat', '1');
  } else {
    next.delete('project');
    next.delete('chat');
  }
  if (options.pane !== undefined) next.set(PANE_PARAM, options.pane);
  else next.delete(PANE_PARAM);
  if (options.tab !== undefined) next.set(TASKS_TAB_PARAM, options.tab);
  else next.delete(TASKS_TAB_PARAM);
  const serialized = next.toString();
  return serialized === '' ? '' : `?${serialized}`;
}

export function ProjectHomeRedirect({ pane, tab }: { pane?: 'tasks'; tab?: 'scheduled' }) {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  return (
    <Navigate
      to={{ pathname: '/app', search: projectRedirectSearch(searchParams, { id, pane, tab }) }}
      replace
    />
  );
}
