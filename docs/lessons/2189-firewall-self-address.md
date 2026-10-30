---
Category: The runner could reach the owner identity through the host Tailscale serve listener
Source: Ticket 2189 review round 2 (2026-10-30)
Level: 2
Safeguard: Setup discovers self addresses and generates all-port new-connection runner rejects for both families; scratch tests inspect emitted rules and check each missing rule and changed discovery
Intercepts: 0
Recurrences: 0
Notes: Round 2 red.log rejects the old loopback-only script. Runtime kernel enforcement, firewall-manager ordering and reboot persistence remain unverified on the host.
---
