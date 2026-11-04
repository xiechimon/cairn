import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { smtpAlertFallback } from '../src/services/push-alerts.js';

test('SMTP configuration is absent or rejects unsafe configuration', () => {
  expect(smtpAlertFallback({})).toBeNull();
  expect(() =>
    smtpAlertFallback({
      CAIRN_ALERT_SMTP_URL: 'https://mail.example',
      CAIRN_ALERT_EMAIL_TO: 'to@example.com',
    }),
  ).toThrow();
  expect(() =>
    smtpAlertFallback({
      CAIRN_ALERT_SMTP_URL: 'smtps://sender%40example.com:password@mail.example',
      CAIRN_ALERT_EMAIL_TO: 'to@example.com\r\nBcc: attacker@example.com',
    }),
  ).toThrow();
});

test('SMTP transport passes secure configuration and encoded mail to a scratch curl executable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-alert-smtp-'));
  const capture = join(dir, 'capture.json');
  writeFileSync(
    join(dir, 'curl'),
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const config = fs.readFileSync(0, 'utf8');
const mailPath = args[args.indexOf('--upload-file') + 1];
fs.writeFileSync(process.env.SMTP_CAPTURE, JSON.stringify({ args, config, mail: fs.readFileSync(mailPath, 'utf8'), mailPath }));
process.exit(Number(process.env.SMTP_EXIT || 0));
`,
    { mode: 0o700 },
  );
  vi.stubEnv('PATH', `${dir}:${process.env.PATH}`);
  vi.stubEnv('SMTP_CAPTURE', capture);
  try {
    const fallback = smtpAlertFallback({
      CAIRN_ALERT_SMTP_URL: 'smtps://sender%40example.com:password@mail.example',
      CAIRN_ALERT_EMAIL_TO: 'owner@example.com',
    });
    if (!fallback) throw new Error('No fallback');
    await fallback.send(
      { title: 'Paused\r\nBcc: injected@example.com', body: 'Main red', href: '/app', tag: 'test' },
      'notification-id',
    );
    const result = JSON.parse(readFileSync(capture, 'utf8'));
    expect(result.config).toContain('ssl-reqd');
    expect(result.config).toContain('mail-rcpt = "owner@example.com"');
    expect(result.args.join(' ')).not.toContain('password');
    expect(result.mail).toContain('To: owner@example.com');
    expect(result.mail).not.toContain('\r\nBcc:');
    expect(Buffer.from(result.mail.split('\r\n\r\n')[1] ?? '', 'base64').toString()).toContain(
      'notification-id',
    );
    expect(() => readFileSync(result.mailPath)).toThrow();
    vi.stubEnv('SMTP_EXIT', '1');
    await expect(
      fallback.send({ title: 'Fail', body: '', href: '/', tag: '' }, 'id'),
    ).rejects.toThrow('SMTP delivery failed');
  } finally {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  }
});
