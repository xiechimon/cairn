import { Navigate, useParams, useSearchParams } from 'react-router';
import { DEMO_MODE } from '../demo/demo-gate.js';

export function ProjectHomeRedirect() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const next = new URLSearchParams(searchParams);
  if (id !== undefined) next.set('project', id);
  if (DEMO_MODE) next.set('view', 'home');
  return <Navigate to={{ pathname: '/app', search: `?${next.toString()}` }} replace />;
}
