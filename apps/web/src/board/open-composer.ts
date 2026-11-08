import { useCallback } from 'react';
import { matchPath, useLocation, useNavigate } from 'react-router';
import { getGestureStore } from '../overlay/gesture-machine.js';

const KEPT_PARAMS = ['scenario'];

export interface ComposeState {
  compose: number;
}

export function composeRequest(state: unknown): number | null {
  return typeof state === 'object' && state !== null && 'compose' in state
    ? Number((state as ComposeState).compose)
    : null;
}

function keptParams(search: string): URLSearchParams {
  const current = new URLSearchParams(search);
  const params = new URLSearchParams();
  for (const key of KEPT_PARAMS) {
    const value = current.get(key);
    if (value !== null) params.set(key, value);
  }
  return params;
}

export function useOpenCoordinatorThread(): (threadId: string) => void {
  const navigate = useNavigate();
  const { search } = useLocation();
  return useCallback(
    (threadId: string) => {
      const params = keptParams(search);
      params.set('chief', threadId);
      navigate({ pathname: '/app', search: `?${params.toString()}` });
    },
    [navigate, search],
  );
}

export function useOpenComposer(): (projectId?: string | null) => void {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  return useCallback(
    (projectId?: string | null) => {
      const routeProject =
        pathname === '/app'
          ? new URLSearchParams(search).get('project')
          : (matchPath('/app/project/:id/*', pathname)?.params.id ?? null);
      const params = keptParams(search);
      const project = projectId ?? routeProject;
      if (project != null) {
        params.set('project', project);
        params.set('chat', '1');
      }
      const query = params.toString();
      const target = query === '' ? '' : `?${query}`;
      const gestures = getGestureStore();
      if (gestures.getState().chief === 'settings') gestures.dispatch({ type: 'chief/minimize' });
      const state: ComposeState = { compose: Date.now() };
      navigate(
        { pathname: '/app', search: target },
        { state, replace: pathname === '/app' && search === target },
      );
    },
    [navigate, pathname, search],
  );
}
