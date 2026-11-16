export const LOW_QUOTA_LEFT_PERCENT = 20;

export const isLowQuota = (left: number | null) => left !== null && left <= LOW_QUOTA_LEFT_PERCENT;
