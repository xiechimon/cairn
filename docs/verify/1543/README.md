# Single-use helper gate, #1543

Biome 2.5.14 was checked first through its installed `configuration_schema.json`: no rule checks exactly one reference to a non-exported function. `noUnusedVariables` covers zero references, while `noUselessReturn` concerns return statements. The official rule index could not be fetched from this sandbox.

The gate uses the existing TypeScript 7.0.2 dependency and its symbol reference API. It checks function declarations and variables initialized with arrow functions or function expressions in changed `.ts`, `.tsx`, and `.mjs` files under `apps`, `packages`, and `scripts`. A declaration must overlap an added diff line. References are counted across the whole file, excluding the declaration name. Existing untouched declarations are ignored. Untracked files must be staged before local checking, matching the comment discipline gate's git-diff behavior.

Run `node scripts/single-use-helper-gate.mjs`. The base defaults to `origin/main`; `SINGLE_USE_HELPER_BASE_SHA` overrides it. Exit codes are 0 for success, 1 for findings, and 2 for invalid configuration, missing base, or parsing errors.

Deliberate exceptions go in `scripts/single-use-helper-allowlist.json` with `path`, `name`, `declaration`, and a nonempty `reason`. The declaration is the exact source text of the function declaration or variable declaration, including its body. A changed body invalidates the exemption.

The independent `single-use-helper-gate` CI job follows the existing advisory comment gate pattern. It is not added to the required `check` job. Repository branch protection was not changed.

## Evidence

`tests.txt` contains actual CLI output from temporary git repositories, including rejected file/function diagnostics and accepted twice-used and exported functions. The test also checks baseline declarations, lexical shadowing, shorthand references, property names, supported roots/extensions, exact exemptions, committed diffs, invalid allowlists, and missing base refs. The test was written and run red before implementation.

Passed:

- `pnpm format`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm spec:parse`
- `node scripts/ui-debt-gate.mjs`
- `node scripts/ui-dead-class-gate.mjs`
- `node --test scripts/single-use-helper-gate.test.mjs`
- `node scripts/single-use-helper-gate.mjs`

No browser E2E was run: this change is a CLI/CI check and the sandbox cannot bind ports. GitHub Actions execution and branch protection were not verified remotely. Local staging failed because the sandbox exposes `.git` read-only, preventing creation of `.git/index.lock`; no local commit could be created.
