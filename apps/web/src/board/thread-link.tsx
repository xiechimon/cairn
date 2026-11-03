import { Link, type LinkProps, useLocation } from 'react-router';
import { threadHref } from './thread-copy.js';

export function useThreadHref(): (todoId: string) => string {
  const location = useLocation();
  return (todoId) => threadHref(todoId, location.pathname === '/app' ? location.search : '');
}

export function ThreadLink({
  todoId,
  ...props
}: Omit<LinkProps, 'to'> & { todoId: string; 'data-phase'?: string | undefined }) {
  const href = useThreadHref();
  return <Link to={href(todoId)} {...props} />;
}
