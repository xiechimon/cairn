import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { afterEach, expect, test } from 'vitest';
import { openCoordinatorHarness } from '../../src/coordinator/runtime/harness.js';
import { coordinatorStoreId } from '../../src/coordinator/runtime/store-identity.js';

const paths: string[] = [];
afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
});

test('store identity survives reopening but distinguishes new files with reused native IDs', async () => {
  const path = mkdtempSync(join(tmpdir(), 'coordinator-store-identity-'));
  paths.push(path);
  const context = BACKGROUND_CONTEXT;
  const open = (name: string) =>
    openCoordinatorHarness(join(path, name), createModels(), context, { resume: false });
  const first = await open('before.sqlite');
  const before = await coordinatorStoreId(first, context);
  const firstConversation = (await first.root(context)).id;
  await first.close(context);
  const same = await open('before.sqlite');
  expect(await coordinatorStoreId(same, context)).toBe(before);
  await same.close(context);
  const replacement = await open('after.sqlite');
  const after = await coordinatorStoreId(replacement, context);
  expect((await replacement.root(context)).id).toBe(firstConversation);
  expect(after).not.toBe(before);
  expect(after).toMatch(/^[a-f0-9]{32}$/);
  await replacement.close(context);
});
