import assert from 'node:assert/strict';
import { feishuBinding, secret } from '../../../apps/server/src/db/schema.js';
import { executeChiefTool } from '../../../apps/server/src/services/chief-tools.js';
import { openSecretValues } from '../../../apps/server/src/services/secrets.js';
import { bootServer, req } from '../../../apps/server/test/helpers.js';

const server = bootServer();
const path = `/api/teams/${server.team.id}/feishu`;
const input = { appId: 'cli_verification123', appSecret: 'synthetic-verification-secret', openId: 'ou_verification123', cairnOrigin: 'https://cairn.example.com' };
try {
  const saved = await req(server.app, 'PUT', path, input);
  assert.equal(saved.status, 200);
  const status = await saved.json();
  assert.equal(Object.hasOwn(status, 'appSecret'), false);
  const binding = server.db.select().from(feishuBinding).get();
  assert.ok(binding);
  assert.ok(binding.appIdCipher.startsWith('v1:'));
  assert.ok(binding.appSecretCipher.startsWith('v1:'));
  assert.ok(!binding.appIdCipher.includes(input.appId));
  assert.ok(!binding.appSecretCipher.includes(input.appSecret));
  assert.equal(server.secretBox.open(binding.appIdCipher), input.appId);
  assert.equal(server.secretBox.open(binding.appSecretCipher), input.appSecret);
  const deps = { ...server.svc, box: server.secretBox, reposDir: server.reposDir, attachmentsDir: server.attachmentsDir };
  const ctx = { teamId: server.team.id, userId: server.user.id, chiefId: 'verification', threadId: 'verification', chiefAgentId: null, conversationId: 'verification' };
  const userSecret = JSON.parse(await executeChiefTool(deps, ctx, 'set_secret', { name: 'feishu.bot.app-secret', value: 'user-owned-value' }));
  assert.equal(typeof userSecret.id, 'string');
  const deletion = JSON.parse(await executeChiefTool(deps, ctx, 'delete_secrets', { names: [userSecret.id] }));
  assert.deepEqual(deletion, { deleted: [userSecret.id] });
  assert.deepEqual(openSecretValues({ db: server.db, box: server.secretBox }, server.team.id, [binding.teamId, binding.appIdCipher]), {});
  assert.deepEqual(await (await req(server.app, 'GET', `/api/teams/${server.team.id}/secrets`)).json(), []);
  const encryptedColumns = { appIdCipher: { envelopeVersion: binding.appIdCipher.split(':')[0], containsSyntheticSecret: binding.appIdCipher.includes(input.appSecret), decryptedValueMatchesInput: server.secretBox.open(binding.appIdCipher) === input.appId }, appSecretCipher: { envelopeVersion: binding.appSecretCipher.split(':')[0], containsSyntheticSecret: binding.appSecretCipher.includes(input.appSecret), decryptedValueMatchesInput: server.secretBox.open(binding.appSecretCipher) === input.appSecret } };
  assert.equal((await req(server.app, 'DELETE', path)).status, 204);
  const remaining = { bindings: server.db.select().from(feishuBinding).all().length, secrets: server.db.select().from(secret).all().length };
  assert.deepEqual(remaining, { bindings: 0, secrets: 0 });
  console.log(JSON.stringify({ syntheticDataOnly: true, status, encryptedColumns, ordinarySecrets: [], agentCredentialValues: {}, chiefUserSecret: { set: userSecret, deleted: deletion.deleted }, afterUnbind: remaining }, null, 2));
} finally {
  server.dispose();
}
