import { type RefObject, useCallback, useEffect, useState } from 'react';
import type { FixtureSet } from '../fixtures/records.js';
import { NewTaskDialog } from './new-task-dialog.js';
import { QuickEntry } from './quick-entry.js';
import { type NewTaskSurfaceOpts, useNewTaskSurface } from './use-new-task-surface.js';

export interface NewTaskSurfaceApi {
  openDialog: () => void;
  openQuickEntry: () => void;
}

interface NewTaskSurfaceRootProps {
  fixture: FixtureSet;
  opts?: NewTaskSurfaceOpts;
  apiRef: RefObject<NewTaskSurfaceApi | null>;
}

export function NewTaskSurfaceRoot({ fixture, opts, apiRef }: NewTaskSurfaceRootProps) {
  const { openDialog, dialogProps } = useNewTaskSurface(fixture, opts);
  const [quickOpen, setQuickOpen] = useState(false);
  const openQuickEntry = useCallback(() => setQuickOpen(true), []);
  const closeQuickEntry = useCallback(() => setQuickOpen(false), []);

  useEffect(() => {
    apiRef.current = { openDialog, openQuickEntry };
  });

  const submitQuick = useCallback(
    (spec: string) => {
      const start = dialogProps.onSaveAndStart;
      if (start != null) start(spec);
      else dialogProps.onSave(spec);
      setQuickOpen(false);
    },
    [dialogProps],
  );

  return (
    <>
      <NewTaskDialog {...dialogProps} />
      <QuickEntry
        open={quickOpen}
        onClose={closeQuickEntry}
        onOpen={openQuickEntry}
        onSubmit={submitQuick}
      />
    </>
  );
}
