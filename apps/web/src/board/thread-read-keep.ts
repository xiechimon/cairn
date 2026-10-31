let keptUnreadId: string | null = null;

export function keepThreadUnread(id: string): void {
  keptUnreadId = id;
}

export function isThreadKeptUnread(id: string): boolean {
  return keptUnreadId === id;
}

export function releaseThreadKeep(id: string): void {
  if (keptUnreadId === id) keptUnreadId = null;
}
