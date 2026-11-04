# Button size verification for PR #1776

The branch reconciles the button sizes with the chief conversation extraction and the chief stop controls on main.

## Failure modes

- The extracted conversation keeps 20px controls while changes target the obsolete drawer.
- Larger controls overflow the chief header or collide with composer actions.
- Task detail and new-task composer geometry changes break existing interaction assertions.

## Results

The new chief-panel geometry case failed before the conversation classes changed: expected 24, received 20. It passed after the change, checking five header and composer controls at 24 by 24 CSS pixels. The screenshot comes from that browser case.

The focused chief-panel and detail-3pane run passed 26 cases. The final pnpm prepush run passed 26 checks, including 745 fixture E2E cases, lint, typecheck and spec collection. Logs preserve the commands and outputs.

## Limits

These are browser fixture checks of CSS geometry and interactions. They do not exercise a live provider or establish production deployment. The older comparison screenshots under docs/verify/button-tiers are historical evidence from the original PR.
