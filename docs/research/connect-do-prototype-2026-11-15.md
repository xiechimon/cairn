# Personal Durable Object relay experiment

This transport experiment is an alternative to the Tunnel proposal in [Cairn Connect](../design/cairn-connect.md), not approval to enable that proposal. The owner requested trying a user-deployed free-account relay on 2026-11-15. Existing credential storage, model routing and machine task claiming remain unchanged.

## Primary sources

| Source | Observed pattern | Trade-off for Cairn |
| --- | --- | --- |
| [Cloudflare hibernating WebSocket server and source](https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/) | Observed: read the official source: `acceptWebSocket`, serialized connection attachments and runtime auto-response preserve connection identity across hibernation. | Inferred: use a DO as the rendezvous for outbound host/client sockets, not a local HTTP listener exposed through an unrestricted proxy. |
| [Cloudflare WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) | Observed: incoming sockets can hibernate; outgoing sockets cannot. Timers and pending work can prevent hibernation. | Inferred: both endpoints connect into the DO. Avoid DO timers and use automatic ping/pong responses. |
| [Cloudflare pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) | Observed: Free supports SQLite-backed DOs; 100,000 metered requests/day, 13,000 GB-s/day and 5GB aggregate SQL storage. Incoming WebSocket messages use a 20:1 request ratio. Excess free operations fail. | Inferred: light personal use can fit free allowances; connection count alone cannot establish a free-use guarantee. No model costs are included. |
| [Deploy buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/) | Observed: the official browser flow clones a public GitHub/GitLab repository and provisions DO bindings. A subdirectory must be independently buildable. | Inferred: isolate the experimental package from workspace imports. Account authorization, secure first-owner setup and device pairing are not supplied by a deploy button. |
| [OWASP WebSocket security](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html) | Observed: authenticate upgrades, validate origins/messages, bound resources and never put credentials in URLs or payload logs. | Inferred: begin with separately authenticated non-browser endpoints, bounded text envelopes and no arbitrary upstream selection. Browser enrollment needs a separate application-auth contract. |
| [Miniflare runtime tests](https://developers.cloudflare.com/workers/testing/miniflare/writing-tests/) | Observed: official Node test examples exercise Worker code in real local workerd via Miniflare. | Inferred: use serial black-box runtime tests without adding a second Vitest integration to the existing Vitest 5 workspace. |

The observations above are first-hand documentation/source reads, not live Cloudflare acceptance. No new model-auth protocol, inference gateway, third-party task scheduler or UI is involved, so those research domains are outside this transport-only experiment.

## Recommendation

Build an isolated experimental Worker/DO and local smoke harness. Prove authenticated host/client routing, response isolation, offline behavior, replacement connection behavior and rejection paths before adding any Cairn HTTP adapter. Use only ephemeral local test credentials. Do not deploy, enroll a real machine, configure cloud secrets or restart production without approval. See the [design](../design/connect-do-prototype.md) for its intentionally limited contract.
