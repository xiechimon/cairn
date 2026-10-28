# Explicit evaluation context windows

The shared eval CLI accepts `--context-window 1000000` for chief-dispatch, memory-regression, and project-routing cases. It declares the window only for the chief model and records `meta.context_window` on scored rows. Invalid values, learn cases, and chief models outside the roster are rejected before model execution. Error rows record `requested_context_window`, because a failed setup does not establish materialization. Omitting the option preserves the existing provider defaults.

The declared window reaches the real server and daemon. The local-provider integration control inspects the daemon's actual `models.json` during the request and compares it with the recorded result metadata. This establishes configuration propagation, not real-provider capacity or model quality.

Run the controls with:

```sh
TMPDIR=/private/tmp pnpm exec vitest run integration/test/chief-dispatch-context-window.test.ts apps/daemon/test/pi-config-effect.test.ts
```

The memory case difficulty requirements in issue #1773 remain separate. Adding this option does not complete those requirements or authorize a model-roster change.

## Evidence

`context-isolated-green.log` records 107 passing tests on source commit `2ca1ade918b3311764874d730e717ca1053c9a91`, based on main `d3c8d5039`. The command also includes `apps/server/test/merge-gate-paths.test.ts`. `context-isolated-default.json` and `context-isolated-1000000.json` preserve the observed daemon model configuration and scored-row metadata. The tested provider is a local HTTP stub; no real-provider capacity claim follows from these checks.

`context-window-red.log` records the test-first control from the parent delivery branch before this option existed: two failures and seven passes. The failing controls were the unrecognized explicit option and the missing learn-case rejection. That run belongs to the parent branch, rather than the isolated source commit above.

Evidence logs have trailing whitespace and final empty lines normalized. Test output text and outcomes are unchanged.

## Independent review correction

The first independent review blocked head `bdc21db4f4b98d3cac0a8f3a78aba83e2d8e8578` on fallback-model attribution and error metadata. `context-independent-first-review.md` preserves its final scorecard. `context-reviewer-controls-red.log` records three actual failing CLI cases and nine passing controls on that head. After the correction, `context-reviewer-controls-green.log` records 110 passing checks across the CLI, daemon configuration, and approval-path suites. Fresh independent re-review remains pending.
