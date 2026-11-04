import { useEffect, useRef, useState } from 'react';
import { startActivityClock } from './activity-clock.js';

export function useActivityClock(
  live: boolean,
  fixtureNow: number,
  onBoundary: () => void,
): number {
  const [, setEpoch] = useState(0);
  const boundary = useRef(onBoundary);
  useEffect(() => {
    boundary.current = onBoundary;
  }, [onBoundary]);
  useEffect(() => {
    if (!live) return;
    return startActivityClock(() => {
      setEpoch((epoch) => epoch + 1);
      boundary.current();
    });
  }, [live]);
  return live ? Date.now() : fixtureNow;
}
