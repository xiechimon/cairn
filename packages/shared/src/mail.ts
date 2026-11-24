import { z } from 'zod';

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

export const MAIL_ERROR_CODES = [
  'auth-rejected',
  'host-not-found',
  'connection-refused',
  'timeout',
  'connection-lost',
] as const;
export type MailErrorCode = (typeof MAIL_ERROR_CODES)[number];

export const MAIL_WAKE_MODES = ['all', 'rules'] as const;
export type MailWakeMode = (typeof MAIL_WAKE_MODES)[number];

export interface MailServerPreset {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
}

const QQ_SERVERS: MailServerPreset = {
  imapHost: 'imap.qq.com',
  imapPort: 993,
  smtpHost: 'smtp.qq.com',
  smtpPort: 465,
};
const OUTLOOK_SERVERS: MailServerPreset = {
  imapHost: 'outlook.office365.com',
  imapPort: 993,
  smtpHost: 'smtp-mail.outlook.com',
  smtpPort: 587,
};

export const MAIL_SERVER_PRESETS: Readonly<Record<string, MailServerPreset>> = {
  'qq.com': QQ_SERVERS,
  'foxmail.com': QQ_SERVERS,
  '163.com': { imapHost: 'imap.163.com', imapPort: 993, smtpHost: 'smtp.163.com', smtpPort: 465 },
  '126.com': { imapHost: 'imap.126.com', imapPort: 993, smtpHost: 'smtp.126.com', smtpPort: 465 },
  'gmail.com': {
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
  },
  'outlook.com': OUTLOOK_SERVERS,
  'hotmail.com': OUTLOOK_SERVERS,
};

export function mailServerPreset(address: string): MailServerPreset | null {
  const domain = address.trim().toLowerCase().split('@')[1];
  return domain === undefined ? null : (MAIL_SERVER_PRESETS[domain] ?? null);
}

const mailHost = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i, 'invalid host');
const mailPort = z.number().int().min(1).max(65535);

export const mailAccountCreateBodySchema = z
  .object({
    address: z.string().trim().min(3).max(254).email(),
    imapHost: mailHost,
    imapPort: mailPort,
    smtpHost: mailHost,
    smtpPort: mailPort,
    password: z.string().min(1).max(512),
    wakeMode: z.enum(MAIL_WAKE_MODES).default('all'),
  })
  .strict();
export type MailAccountCreateBody = z.infer<typeof mailAccountCreateBodySchema>;

export const mailAccountPatchBodySchema = z.object({ wakeMode: z.enum(MAIL_WAKE_MODES) }).strict();
export type MailAccountPatchBody = z.infer<typeof mailAccountPatchBodySchema>;

export const mailRuleCreateBodySchema = z
  .object({
    matchKind: z.enum(MAIL_RULE_KINDS),
    pattern: z.string().trim().min(1).max(200),
  })
  .strict();
export type MailRuleCreateBody = z.infer<typeof mailRuleCreateBodySchema>;

export interface MailRuleRecord {
  id: string;
  matchKind: MailRuleKind;
  pattern: string;
}

export interface MailAccountRecord {
  id: string;
  address: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  status: MailAccountStatus;
  lastError: MailErrorCode | null;
  lastMailAt: number | null;
  nextRetryAt?: number | null;
  retryAttempt?: number;
  wakeMode: MailWakeMode;
  rules: MailRuleRecord[];
}
