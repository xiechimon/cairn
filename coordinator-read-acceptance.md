# Coordinator repository-read acceptance

Date: 2026-11-09
Status: passed locally; current-head CI and cloud review pending

Implementation: f103c53c4228ecd3d4d46f076d10427ffd09154b

The actual in-server Coordinator runner used the existing host Codex subscription with gpt-6.1-sol, called docs for the selected GitHub project, and completed successfully. No API key was configured, no credentials were copied, and no production configuration was changed.

Returned path: scripts/owned-process.mjs
Returned ref: refs/remotes/origin/main
Returned commit: 685a4ee3fe41f92c3e4b4a38a8e5f39f8cbb9247

The docs response was compared byte-for-byte with the Git object. All three final-answer code blocks were checked against that object after normalizing indentation.

The Coordinator accurately distinguished runOwned delegation from the underlying spawn calls:

```js
const owned = spawnOwned(command, args, options);
```

```js
const child = spawn(file, fileArgs, {
  cwd,
  env: scopeRunner ? { ...busEnv, ...childEnv } : childEnv,
  stdio,
  detached: true,
});
```

```js
const sentinel = spawn(
  process.execPath,
  [
    OWNED_PROCESS_CLI,
    '--sentinel',
    JSON.stringify({ target, chain, deadline: Date.now() + maxRuntimeSec * 1000 }),
  ],
  {
    stdio: ['pipe', 'ignore', 'ignore'],
    detached: true,
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== OWNER_ENV)),
  },
);
```

Regression: Models.getAuth previously returned headers without auth.apiKey under the default authHeader setting, causing the Codex stream to reject before making a request. The new regression failed before the fix and passes afterward. The subscription/provider/docs targeted run passed 23 tests. lint, typecheck, spec:parse and prepush passed.

This is an isolated live-model acceptance, not verification of an updated deployed server. Remote-only repositories remain outside this repair. PR #3494 retains coordinator-hold and is not merged.
