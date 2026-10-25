import { type RefObject, useEffect } from 'react';
import type { FixtureSet } from '../fixtures/records.js';
import { NewTaskDialog } from './new-task-dialog.js';
import { type NewTaskSurfaceOpts, useNewTaskSurface } from './use-new-task-surface.js';

export interface NewTaskSurfaceApi {
  openDialog: () => void;
}

interface NewTaskSurfaceRootProps {
  fixture: FixtureSet;
  opts?: NewTaskSurfaceOpts;
  apiRef: RefObject<NewTaskSurfaceApi | null>;
}

export function NewTaskSurfaceRoot({ fixture, opts, apiRef }: NewTaskSurfaceRootProps) {
  const { openDialog, dialogProps } = useNewTaskSurface(fixture, opts);
  useEffect(() => {
    apiRef.current = { openDialog };
  });
  return <NewTaskDialog {...dialogProps} />;
}
