---
Category: A restore API probe used a live keyfile constructor that could create a replacement key
Source: #2190 (2026-10-30)
Level: 1
Safeguard: The API helper accepts only scratch home and transport mode and constructs an ephemeral secret box
Intercepts: 0
Recurrences: 0
Notes: A direct helper regression verifies that an absent key sentinel is never created. Live key access belongs only to the separate decryption probe.
---
