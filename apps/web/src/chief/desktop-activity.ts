import { useEffect, useState } from 'react';
import { useChiefThreads } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { desktopActivity } from '../desktop-shell.js';
import { threadTurnInFlight } from './orchestration-inflight.js';

const OPEN_DIALOG = '[role="dialog"], [role="alertdialog"]';

function useDialogOpen(enabled: boolean): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const read = (): void => setOpen(document.querySelector(OPEN_DIALOG) !== null);
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['role'],
    });
    return () => observer.disconnect();
  }, [enabled]);
  return open;
}

export function useDesktopActivityReport(): void {
  const bridge = desktopActivity();
  const { live, teamId } = useLiveData();
  const threads = useChiefThreads(teamId, live && bridge !== null);
  const turnInFlight = (threads.data ?? []).some(threadTurnInFlight);
  const dialogOpen = useDialogOpen(bridge !== null);
  useEffect(() => {
    bridge?.report({ turnInFlight, dialogOpen });
  }, [bridge, turnInFlight, dialogOpen]);
}
