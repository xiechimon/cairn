# Explicit evaluation context windows

The shared eval CLI accepts `--context-window 1000000` for chief-dispatch, memory-regression, and project-routing cases. It declares the window only for the chief model and records `meta.context_window` on scored rows. Invalid values and learn cases are rejected before model execution. Omitting the option preserves the existing provider defaults.

The declared window reaches the real server and daemon. The local-provider integration control inspects the daemon's actual `models.json` during the request and compares it with the recorded result metadata. This establishes configuration propagation, not real-provider capacity or model quality.

Run the controls with:

```sh
TMPDIR=/private/tmp pnpm exec vitest run integration/test/chief-dispatch-context-window.test.ts apps/daemon/test/pi-config-effect.test.ts
```

The memory case difficulty requirements in issue #1773 remain separate. Adding this option does not complete those requirements or authorize a model-roster change.
