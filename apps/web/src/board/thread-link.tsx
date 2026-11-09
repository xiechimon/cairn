import { useCallback } from 'react';
import { Link, type LinkProps, useLocation, useSearchParams } from 'react-router';
import { THREAD_PARAM, threadHref, threadHrefFrom, VIEW_PARAM } from './thread-copy.js';

export function useThreadHref(): (todoId: string) => string {
  const location = useLocation();
  return (todoId) =>
    location.pathname === '/app'
      ? threadHref(todoId, location.search)
      : threadHrefFrom(todoId, location.search);
}

export function ThreadLink({
  todoId,
  ...props
}: Omit<LinkProps, 'to'> & { todoId: string; 'data-phase'?: string | undefined }) {
  const href = useThreadHref();
  return <Link to={href(todoId)} {...props} />;
}

export function useOpenThread(): (todoId: string) => void {
  const [, setSearchParams] = useSearchParams();
  return useCallback(
    (todoId: string) =>
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        params.set(THREAD_PARAM, todoId);
        params.delete(VIEW_PARAM);
        return params;
      }),
    [setSearchParams],
  );
}

export function useCloseThread(): () => void {
  const [, setSearchParams] = useSearchParams();
  return useCallback(
    () =>
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          params.delete(THREAD_PARAM);
          params.delete(VIEW_PARAM);
          return params;
        },
        { replace: true },
      ),
    [setSearchParams],
  );
}
