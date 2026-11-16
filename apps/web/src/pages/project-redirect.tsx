import { Navigate, useParams, useSearchParams } from 'react-router';

export function ProjectHomeRedirect({ pane, tab }: { pane?: 'tasks'; tab?: 'scheduled' }) {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const next = new URLSearchParams(searchParams);
  if (id !== undefined) {
    next.set('project', id);
    next.set('chat', '1');
  }
  if (pane !== undefined) next.set('pane', pane);
  if (tab !== undefined) next.set('tab', tab);
  return <Navigate to={{ pathname: '/app', search: `?${next.toString()}` }} replace />;
}
