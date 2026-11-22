import type { TrayData } from './tray-data.js';

const QUOTA_REFRESH_INTERVAL = 60_000;

export function createTrayRefresh(
  load: (claimQuotaRefresh: () => boolean) => Promise<TrayData>,
  publish: (data: TrayData) => void,
  now = Date.now,
) {
  let opened = false;
  let active: Promise<void> | undefined;
  let lastQuotaRefresh = -Infinity;
  return (menuOpened = false): Promise<void> => {
    opened ||= menuOpened && now() - lastQuotaRefresh >= QUOTA_REFRESH_INTERVAL;
    active ??= Promise.resolve().then(async () => {
      try {
        do {
          const requested = opened;
          opened = false;
          const data = await load(() => {
            const at = now();
            if (!requested || at - lastQuotaRefresh < QUOTA_REFRESH_INTERVAL) return false;
            lastQuotaRefresh = at;
            return true;
          });
          publish(data);
        } while (opened && now() - lastQuotaRefresh >= QUOTA_REFRESH_INTERVAL);
      } finally {
        opened = false;
        active = undefined;
      }
    });
    return active;
  };
}
