export const MAIL_ACCOUNT_STATUSES = [
  'disconnected',
  'connecting',
  'watching',
  'degraded',
  'revoked',
] as const;
export type MailAccountStatus = (typeof MAIL_ACCOUNT_STATUSES)[number];

export const MAIL_EVENT_STATUSES = ['received', 'ranked', 'delivered', 'dropped'] as const;
export type MailEventStatus = (typeof MAIL_EVENT_STATUSES)[number];

export const MAIL_RANKS = ['needs_you', 'can_wait', 'drop'] as const;
export type MailRank = (typeof MAIL_RANKS)[number];

export const MAIL_RULE_KINDS = ['sender_allow', 'subject_contains'] as const;
export type MailRuleKind = (typeof MAIL_RULE_KINDS)[number];

export const MAIL_SECRET_NAME_PREFIX = 'mail.';

export function isMailSecretName(name: string): boolean {
  const folded = name
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .trim()
    .toLowerCase();
  return folded.startsWith(MAIL_SECRET_NAME_PREFIX);
}
