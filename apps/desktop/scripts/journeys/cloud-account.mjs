import assert from 'node:assert/strict';
import { join } from 'node:path';

export default async function cloudAccount({ window, mode, evidenceDir }) {
  await window.goto(new URL('/app', window.url()).toString());
  const trigger = window.getByTestId('sidebar-account');
  await trigger.waitFor({ timeout: 15_000 });

  const statusResult = await window.evaluate(async () => {
    const res = await fetch('/api/cloud/status');
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  });
  assert.equal(statusResult.status, 200, 'GET /api/cloud/status did not return 200');
  assert.equal(typeof statusResult.body?.configured, 'boolean');
  assert.equal(typeof statusResult.body?.linked, 'boolean');

  await trigger.click();
  await window.getByTestId('sidebar-account-popover').waitFor({ timeout: 15_000 });
  await window.getByTestId('cloud-account-subtitle').waitFor({ timeout: 15_000 });

  if (statusResult.body.configured && !statusResult.body.linked) {
    await window.getByTestId('cloud-sign-in').waitFor({ timeout: 15_000 });
  }
  if (mode === 'remote-server') {
    await window.getByTestId('cloud-switch-local').waitFor({ timeout: 15_000 });
  }

  await window.screenshot({ path: join(evidenceDir, `${mode}-cloud-account.png`) });

  const settingsBtn = statusResult.body.linked
    ? window.getByTestId('cloud-migrate-data')
    : window.getByTestId('cloud-account-settings');
  await settingsBtn.click();
  await window.getByTestId('account-appearance').waitFor({ timeout: 15_000 });
  assert.equal(new URL(window.url()).pathname, '/app/settings/account');
}
