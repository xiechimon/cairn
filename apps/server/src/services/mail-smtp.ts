import { createTransport } from 'nodemailer';

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
}

export interface OutgoingMail {
  from: string;
  to: string;
  subject: string;
  text: string;
  inReplyTo: string | null;
}

export type SendMail = (config: SmtpConfig, mail: OutgoingMail) => Promise<void>;

const SMTP_TIMEOUT_MS = 30 * 1000;

export const sendSmtpMail: SendMail = async (config, mail) => {
  const transport = createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.password },
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
  });
  try {
    await transport.sendMail({
      from: mail.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      ...(mail.inReplyTo === null ? {} : { inReplyTo: mail.inReplyTo, references: mail.inReplyTo }),
    });
  } finally {
    transport.close();
  }
};
