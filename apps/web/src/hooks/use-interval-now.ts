import { useEffect, useState } from 'react';

export function useIntervalNow(active: boolean, intervalMs = 1000, immediate = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    if (immediate) setNow(Date.now());
    const tick = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(tick);
  }, [active, intervalMs, immediate]);
  return now;
}
