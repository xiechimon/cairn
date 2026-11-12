import type { ComputerRecord } from '@cairn/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
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
  reclaim,
}: {
  teamId: string | undefined;
  computer: ComputerRecord | null;
  reclaim: boolean;
}) {
  const qc = useQueryClient();
  const [leaseId, setLeaseId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reclaiming = useRef(false);
  const controlHeld = leaseId !== null || computer?.controlHolder === 'user';

  useEffect(() => {
    if (computer?.controlHolder === 'user') return;
    setLeaseId(null);
  }, [computer?.controlHolder, computer?.id]);

  useEffect(() => {
    if (
      !reclaim ||
      teamId === undefined ||
      computer === null ||
      computer.controlHolder !== 'user' ||
      leaseId !== null ||
      reclaiming.current
    )
      return;
    const computerId = computer.id;
    reclaiming.current = true;
    setBusy(true);
    void acquireComputerControl(teamId, computerId)
      .then((lease) => {
        setLeaseId(lease.leaseId);
        return invalidateConverged(qc, { queryKey: ['computers', teamId] });
      })
      .finally(() => {
        reclaiming.current = false;
        setBusy(false);
      });
  }, [reclaim, teamId, computer, leaseId, qc]);

  useEffect(() => {
    if (teamId === undefined || computer === null || leaseId === null) return;
    const tick = window.setInterval(() => {
      void renewComputerControl(teamId, computer.id, leaseId).catch(() => {
        setLeaseId(null);
      });
    }, RENEW_MS);
    return () => window.clearInterval(tick);
  }, [teamId, computer, leaseId]);

  const acquire = (): Promise<void> => {
    if (teamId === undefined || computer === null) return Promise.resolve();
    setBusy(true);
    return acquireComputerControl(teamId, computer.id)
      .then((lease) => {
        setLeaseId(lease.leaseId);
        return invalidateConverged(qc, { queryKey: ['computers', teamId] });
      })
      .finally(() => setBusy(false));
  };

  const setHeld = (checked: boolean) => {
    if (teamId === undefined || computer === null || busy) return;
    setBusy(true);
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
      .finally(() => setBusy(false));
  };

  return { leaseId, busy, controlHeld, acquire, setHeld };
}
