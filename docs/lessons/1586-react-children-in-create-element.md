---
Category: A React render test put required children only in the third argument of createElement
Source: #1586 (2026-10-24)
Level: 1
Safeguard: the provider's children are written explicitly into the type-checked props; thread and task fixtures use full type declarations
Intercepts: 1
Recurrences: 0
Notes: the original call failed typecheck with TS2769; passing with explicit children kept the component's original required types
---
