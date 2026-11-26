import assert from 'node:assert/strict';
import { join } from 'node:path';

export default async function coordinatorChat({ window, mode, evidenceDir }) {
  await window.goto(new URL('/app', window.url()).toString());
  await window.getByTestId('home-c').waitFor({ timeout: 15_000 });
  const composer = window.getByTestId('chief-composer-block');
  await composer.waitFor({ timeout: 15_000 });
  await composer.click();
  const meter = window.getByTestId('home-c').getByTestId('composer-context-meter');
  await meter.waitFor({ timeout: 15_000 });
  assert.equal(await meter.isVisible(), true, 'Coordinator composer meter was not visible');
  await window.screenshot({ path: join(evidenceDir, `${mode}-coordinator-chat.png`) });
}
