# Flat hover feedback

UI brief: settings lists and shared row/card controls. Remove partial background bands and hover elevation; keep keyboard outlines, borders and dividers. Reference: [t3code Environments](../../design/references/settings/t3code-environments.jpg). Rules: V7, V21, A2, R1.

## Evidence

Every image is a real Chromium capture at 1440 px, 2x scale, with the pointer (red dot, injected only for the capture) over the row. Before is the web source from origin/main built in fixture mode; after is this branch.

| State | Light before | Light after | Dark before | Dark after |
| --- | --- | --- | --- | --- |
| Machines, name hovered | ![Machines, name hovered light before](machine-name-hover-light-before.png) | ![Machines, name hovered light after](machine-name-hover-light-after.png) | ![Machines, name hovered dark before](machine-name-hover-dark-before.png) | ![Machines, name hovered dark after](machine-name-hover-dark-after.png) |
| Machines, menu hovered | ![Machines, menu hovered light before](machine-menu-hover-light-before.png) | ![Machines, menu hovered light after](machine-menu-hover-light-after.png) | ![Machines, menu hovered dark before](machine-menu-hover-dark-before.png) | ![Machines, menu hovered dark after](machine-menu-hover-dark-after.png) |
| Machines, keyboard focus | n/a | ![Machines, keyboard focus light after](machine-focus-light-after.png) | n/a | ![Machines, keyboard focus dark after](machine-focus-dark-after.png) |
| Providers | ![Providers light before](list-providers-hover-light-before.png) | ![Providers light after](list-providers-hover-light-after.png) | ![Providers dark before](list-providers-hover-dark-before.png) | ![Providers dark after](list-providers-hover-dark-after.png) |
| MCP servers | ![MCP servers light before](list-mcp-hover-light-before.png) | ![MCP servers light after](list-mcp-hover-light-after.png) | ![MCP servers dark before](list-mcp-hover-dark-before.png) | ![MCP servers dark after](list-mcp-hover-dark-after.png) |
| Skills | ![Skills light before](list-skills-hover-light-before.png) | ![Skills light after](list-skills-hover-light-after.png) | ![Skills dark before](list-skills-hover-dark-before.png) | ![Skills dark after](list-skills-hover-dark-after.png) |
| API keys | ![API keys light before](list-apikeys-hover-light-before.png) | ![API keys light after](list-apikeys-hover-light-after.png) | ![API keys dark before](list-apikeys-hover-dark-before.png) | ![API keys dark after](list-apikeys-hover-dark-after.png) |
| Secrets | ![Secrets light before](list-secrets-hover-light-before.png) | ![Secrets light after](list-secrets-hover-light-after.png) | ![Secrets dark before](list-secrets-hover-dark-before.png) | ![Secrets dark after](list-secrets-hover-dark-after.png) |

Computed backgrounds under the omarchy row on main: dark name hover paints `machine-toggle` at 808x22 px (first line only); light menu hover paints `machine-menu` at 28x28 px. After: no descendant of the row changes background. Machine focus has no before image because focus rendering is unchanged by design (a 2px solid outline).

## Regression guard

`apps/web/e2e/paper-hover-bands.spec.ts` run against a fixture build of the old sources fails `machines light` and `machines dark` (`V21: machine-toggle changes background on only part of the row`, box `[392,154,808,22]`); the other 12 pass. Against this branch all 14 pass. Command, with a preview server for each build:

```sh
E2E_PORT=<port> pnpm --filter @cairn/web exec playwright test e2e/paper-hover-bands.spec.ts
```

G8 in `scripts/ui-drift-gate.mjs` scans web TS, TSX and CSS for hover/active shadow utilities and box-shadow or `all` transitions; a `deliberate-shadow: reason` annotation on the preceding line permits an exception.
