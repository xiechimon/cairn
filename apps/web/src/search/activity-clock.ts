export function nextLocalMidnight(now: number): number {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next.getTime();
}

export function startActivityClock(refresh: (now: number) => void): () => void {
  let date = new Date().toDateString();
  let timer: ReturnType<typeof setTimeout>;
  const update = () => {
    clearTimeout(timer);
    const now = Date.now();
    const nextDate = new Date(now).toDateString();
    if (date !== nextDate) {
      date = nextDate;
      refresh(now);
    }
    timer = setTimeout(update, nextLocalMidnight(now) - now);
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') update();
  };
  update();
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
