import type { ComputerRecord } from '@cairn/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  acquireComputerControl,
  releaseComputerControl,
  renewComputerControl,
} from './computer-screen.js';
import { invalidateConverged } from './invalidate.js';

const RENEW_MS = 10 * 60_000;

export function useComputerControl({
  teamId,
  computer,
}: {
  teamId: string | undefined;
  computer: ComputerRecord | null;
}) {
  const qc = useQueryClient();
  const [leaseId, setLeaseId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const controlHeld = leaseId !== null || computer?.controlHolder === 'user';

  useEffect(() => {
    if (computer?.controlHolder === 'user') return;
    setLeaseId(null);
  }, [computer?.controlHolder, computer?.id]);

  useEffect(() => {
    if (teamId === undefined || computer === null || leaseId === null) return;
    const tick = window.setInterval(() => {
      void renewComputerControl(teamId, computer.id, leaseId).catch(() => {
        setLeaseId(null);
      });
    }, RENEW_MS);
    return () => window.clearInterval(tick);
  }, [teamId, computer, leaseId]);

  const setHeld = (checked: boolean) => {
    if (teamId === undefined || computer === null || busy) return;
    setBusy(true);
    setFailed(false);
    const releaseWithFreshLease = () =>
      acquireComputerControl(teamId, computer.id).then((lease) =>
        releaseComputerControl(teamId, computer.id, lease.leaseId),
      );
    const run = checked
      ? acquireComputerControl(teamId, computer.id).then((lease) => {
          setLeaseId(lease.leaseId);
        })
      : (leaseId !== null
          ? releaseComputerControl(teamId, computer.id, leaseId).catch(releaseWithFreshLease)
          : releaseWithFreshLease()
        ).then(() => {
          setLeaseId(null);
        });
    void run
      .then(() => invalidateConverged(qc, { queryKey: ['computers', teamId] }))
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  };

  return { leaseId, busy, failed, controlHeld, setHeld };
}
