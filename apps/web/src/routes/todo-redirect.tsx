import { Navigate, useLocation, useParams } from 'react-router';
import { threadHrefFrom } from '../board/thread-copy.js';

export function TodoRedirect() {
  const { id } = useParams();
  const location = useLocation();
  if (id === undefined) return <Navigate to="/app" replace />;
  return <Navigate to={threadHrefFrom(id, location.search)} replace />;
}
