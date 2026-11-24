export interface ExpiringSubscription {
  enabled?: boolean;
  expiresAt: number | null;
  label: string;
}

const EXPIRY_WARNING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function subscriptionExpiryWarning(
  subscription: ExpiringSubscription,
  now: number,
  format: {
    expired: (name: string) => string;
    expiring: (name: string, days: number) => string;
  },
): string | null {
  if (subscription.enabled === false) return null;
  if (subscription.expiresAt === null || subscription.expiresAt - now > EXPIRY_WARNING_WINDOW_MS)
    return null;
  if (subscription.expiresAt <= now) return format.expired(subscription.label);
  return format.expiring(subscription.label, Math.ceil((subscription.expiresAt - now) / DAY_MS));
}
