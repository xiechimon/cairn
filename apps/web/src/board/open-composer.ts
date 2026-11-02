import { useCallback } from 'react';
import { matchPath, useLocation, useNavigate } from 'react-router';
import { DEMO_MODE } from '../demo/demo-gate.js';
import { getGestureStore } from '../overlay/gesture-machine.js';
import { BOARD_VIEW_PARAM } from './home.js';

const KEPT_PARAMS = ['scenario'];

export interface ComposeState {
  compose: number;
}

export function composeRequest(state: unknown): number | null {
  return typeof state === 'object' && state !== null && 'compose' in state
    ? Number((state as ComposeState).compose)
    : null;
}

export function useOpenComposer(): (projectId?: string | null) => void {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  return useCallback(
    (projectId?: string | null) => {
      const current = new URLSearchParams(search);
      const routeProject =
        pathname === '/app'
          ? current.get('project')
          : (matchPath('/app/project/:id/*', pathname)?.params.id ?? null);
      const params = new URLSearchParams();
      for (const key of KEPT_PARAMS) {
        const value = current.get(key);
        if (value !== null) params.set(key, value);
      }
      const project = projectId ?? routeProject;
      if (project != null) params.set('project', project);
      if (DEMO_MODE) params.set(BOARD_VIEW_PARAM, 'home');
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
