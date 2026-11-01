import { Navigate, useParams, useSearchParams } from 'react-router';
import { COLUMN_PARAM } from '../board/columns.js';
import { BOARD_VIEW_PARAM } from '../board/home.js';
import { DEMO_MODE } from '../demo/demo-gate.js';

export function ProjectHomeRedirect() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const next = new URLSearchParams(searchParams);
  next.delete(BOARD_VIEW_PARAM);
  next.delete(COLUMN_PARAM);
  if (id !== undefined) next.set('project', id);
  if (DEMO_MODE) next.set(BOARD_VIEW_PARAM, 'home');
  return <Navigate to={{ pathname: '/app', search: `?${next.toString()}` }} replace />;
}
