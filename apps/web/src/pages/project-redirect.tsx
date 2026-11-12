import { Navigate, useParams, useSearchParams } from 'react-router';

export function ProjectHomeRedirect() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const next = new URLSearchParams(searchParams);
  if (id !== undefined) {
    next.set('project', id);
    next.set('chat', '1');
  }
  return <Navigate to={{ pathname: '/app', search: `?${next.toString()}` }} replace />;
}
