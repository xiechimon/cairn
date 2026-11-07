import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../../scripts/test-tmpdir.mjs';
import { readCodexLogin } from '../../src/coordinator/codex-login.js';
import { coordinatorApiKey, coordinatorProviders } from '../../src/coordinator/credentials.js';
import { createCoordinatorModels } from '../../src/coordinator/runtime/models.js';
import { routingRule } from '../../src/db/schema.js';
import { setCoordinatorServerContextEnabled } from '../../src/services/coordinator-context.js';
import { createProvider } from '../../src/services/providers.js';
import { bootServer } from '../helpers.js';

const dirs: string[] = [];
const disposers: (() => void)[] = [];
const savedHome = process.env.CODEX_HOME;

function jwt(expSeconds: number): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'none' })}.${part({ exp: expSeconds })}.sig`;
}

function codexHome(token: string | null): string {
  const home = makeTestTempDir('codex-home-');
  dirs.push(home);
  mkdirSync(home, { recursive: true });
  if (token !== null) {
    writeFileSync(join(home, 'auth.json'), JSON.stringify({ tokens: { access_token: token } }));
  }
  return home;
}

beforeEach(() => setCoordinatorServerContextEnabled(true));
afterEach(() => {
  setCoordinatorServerContextEnabled(false);
  if (savedHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = savedHome;
  for (const d of disposers.splice(0)) d();
  for (const d of dirs.splice(0)) releaseTestTempDir(d);
});

describe('Codex subscription credential for the in-server Coordinator', () => {
  it('reads a live access token and refuses an expired or missing one', () => {
    const live = jwt(Math.floor(Date.now() / 1000) + 3600);
    const expired = jwt(Math.floor(Date.now() / 1000) - 3600);
    expect(readCodexLogin(join(codexHome(live), 'auth.json'))).toBe(live);
    expect(readCodexLogin(join(codexHome(expired), 'auth.json'))).toBeNull();
    expect(readCodexLogin(join(codexHome(null), 'auth.json'))).toBeNull();
  });

  it('maps the keyless openai-codex provider onto the pi-ai Codex responses API', () => {
    const models = createCoordinatorModels();
    models.useStepProvider({
      kind: 'http',
      providerId: 'openai-codex',
      label: 'Codex',
      api: 'openai-responses',
      authHeader: true,
      compat: {},
      models: [{ id: 'gpt-6.1-sol', name: 'gpt-6.1-sol' }],
    });
    expect(models.models.getModel('openai-codex', 'gpt-6.1-sol')).toMatchObject({
      api: 'openai-codex-responses',
      baseUrl: 'https://chatgpt.com/backend-api',
      reasoning: true,
    });
  });

  it('resolves the route and key from the host login without storing the token', () => {
    const live = jwt(Math.floor(Date.now() / 1000) + 3600);
    process.env.CODEX_HOME = codexHome(live);
    const s = bootServer();
    disposers.push(() => s.dispose());
    createProvider(
      { db: s.db, box: s.secretBox },
      {
        teamId: s.team.id,
        body: {
          providerId: 'openai-codex',
          label: 'Codex',
          baseUrl: '',
          api: 'openai-responses',
          models: [{ id: 'gpt-6.1-sol', name: 'gpt-6.1-sol' }],
        },
        createdBy: s.user.id,
      },
    );
    s.db
      .insert(routingRule)
      .values({
        id: 'rule-codex',
        teamId: s.team.id,
        use: 'coordinator',
        provider: 'openai-codex',
        modelId: 'gpt-6.1-sol',
        thinkingLevel: 'low',
        createdAt: 1,
        updatedAt: 1,
      })
      .run();

    const providers = coordinatorProviders({ db: s.db, box: s.secretBox }, s.team.id);
    expect(providers?.router).toMatchObject({
      provider: 'openai-codex',
      modelId: 'gpt-6.1-sol',
      thinkingLevel: 'low',
    });
    expect(providers?.summary.provider).toBe('openai-codex');
    expect(coordinatorApiKey({ db: s.db, box: s.secretBox }, s.team.id, 'openai-codex')).toBe(live);
    expect(JSON.stringify(s.db.select().from(routingRule).all())).not.toContain(live);
  });
});
