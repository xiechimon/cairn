---
Category: A context provider wrapped only the route outlet, while a sibling overlay (the chief drawer) rendered consumers of the same context, so its task links silently fell back to the old navigation
Source: #1937 (2026-10-27)
Level: 2
Safeguard: `apps/web/e2e/chief-home-chat.spec.ts` (the drawer task chip case) clicks a drawer chip on the board and asserts the panel opens with the board still in the URL; before placing a provider, grep every caller of its hook and check each one renders inside it
Intercepts: 1
Recurrences: 0
Notes: Found by the independent review gate, not by the local gates. Negative control: with the provider around the outlet only the case is red; with the drawer inside it is green
---
