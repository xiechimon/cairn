import type { SecretBox } from '@cairn/shared';
import { type FeishuBotBody, type FeishuBotStatus, feishuBotBodySchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { feishuBinding } from '../db/schema.js';
import { conflict, HttpError, parseWith } from '../lib/errors.js';

export interface FeishuDeps {
  db: Db;
  box: SecretBox;
}

type BindingRow = typeof feishuBinding.$inferSelect;

function getBinding(deps: FeishuDeps, teamId: string): BindingRow | undefined {
  return deps.db.select().from(feishuBinding).where(eq(feishuBinding.teamId, teamId)).get();
}

export function readFeishuBotStatus(deps: FeishuDeps, teamId: string): FeishuBotStatus {
  const binding = getBinding(deps, teamId);
  if (!binding) return { configured: false, appId: null, openId: null, cairnOrigin: null };
  return {
    configured: true,
    appId: deps.box.open(binding.appIdCipher),
    openId: binding.openId,
    cairnOrigin: binding.cairnOrigin,
  };
}

export function saveFeishuBot(
  deps: FeishuDeps,
  input: { teamId: string; userId: string; body: FeishuBotBody },
): FeishuBotStatus {
  const body = parseWith(feishuBotBodySchema, input.body, 'body');
  deps.db.transaction((tx) => {
    const scoped = { db: tx, box: deps.box };
    const previous = getBinding(scoped, input.teamId);
    const previousAppId = previous ? scoped.box.open(previous.appIdCipher) : null;
    if (body.appSecret === '' && (!previous || previousAppId !== body.appId))
      throw new HttpError(400, 'appSecret is required for a new app');
    const otherBinding = tx
      .select()
      .from(feishuBinding)
      .where(eq(feishuBinding.openId, body.openId))
      .get();
    if (otherBinding && otherBinding.teamId !== input.teamId)
      throw conflict('Feishu recipient already bound');
    const now = Date.now();
    const appSecret = body.appSecret || (previous ? scoped.box.open(previous.appSecretCipher) : '');
    tx.insert(feishuBinding)
      .values({
        teamId: input.teamId,
        userId: input.userId,
        openId: body.openId,
        cairnOrigin: body.cairnOrigin,
        appIdCipher: scoped.box.seal(body.appId),
        appSecretCipher: scoped.box.seal(appSecret),
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: feishuBinding.teamId,
        set: {
          userId: input.userId,
          openId: body.openId,
          cairnOrigin: body.cairnOrigin,
          appIdCipher: scoped.box.seal(body.appId),
          appSecretCipher: scoped.box.seal(appSecret),
          updatedAt: now,
        },
      })
      .run();
  });
  return readFeishuBotStatus(deps, input.teamId);
}

export function unbindFeishuBot(deps: FeishuDeps, teamId: string): void {
  deps.db.delete(feishuBinding).where(eq(feishuBinding.teamId, teamId)).run();
}
