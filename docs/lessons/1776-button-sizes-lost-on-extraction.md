---
Category: The chief conversation extraction left the old drawer button-size changes on a component that no longer rendered those controls
Source: PR #1776 reconciliation (2026-10-27)
Level: 2
Safeguard: The chief-panel browser test measures the rendered header and composer controls at 24px after conversation extraction
Intercepts: 1
Recurrences: 0
Notes: The test fails before the class changes are applied to ChiefConversation, reporting a 20px target where 24px is required; existing detail-composer alignment assertions are retained
---
