---
Category: A React render test put the required children only in createElement's third parameter
Source: #1586 (2026-10-24)
Level: 1
Safeguard: The provider's children are written explicitly into type-checked props; thread and task fixtures use full type declarations
Intercepts: 1
Recurrences: 0
Notes: The original call failed pnpm typecheck with TS2769; passing after explicit children, keeping the component's original required typing
---

