# Launch owner actions

What launch needs, split by who can do it. The left column a lane can ship; the right column only the owner can do (accounts, payments, credentials, 2FA). Ordered by the roadmap board's Seq field.

## Needs the owner

| # | Action | Why it blocks | Where it lands |
|---|--------|---------------|----------------|
| 1 | ~~Apple Developer Program ($99/yr) + Developer ID certificate~~ DEFERRED (2026-11-27): macOS already signs; paid Apple/Windows certs skipped during pre-launch evaluation | Deferred by owner decision on 2026-11-27 | `docs/ops/desktop-signing.md` |
| 2 | Back up the existing macOS signing certificate + notarization credentials off-machine | Losing them kills every future signed release | `docs/ops/desktop-signing.md` |
| 3 | ~~Windows code-signing certificate (EV or Azure Trusted Signing)~~ DEFERRED (2026-11-27): paid Windows certs skipped for now | Deferred by owner decision on 2026-11-27 | `desktop-release.yml` |
| 4 | npm publish access for `@xiechimon/cairn` on the release runner | The `npx` install path must keep working alongside desktop apps | `scripts/ops/` |
| 5 | Telegram bot token via @BotFather | IM entry cannot pair without it | secrets UI once the adapter lands |
| 6 | WeChat iLink bot registration + QR pairing on the owner's account | The WeChat adapter needs a live bot token; personal WeChat ≥ 8.0.69, one bot per account | `docs/design/im-connections.md` |
| 6b | ~~Slack app~~ DONE: `cairn` (A0CJ8NCNRM5) created + installed in `xmon-group`; xoxb- + xapp- tokens + app credentials in `~/.config/cairn/slack-app.env`; Socket Mode verified live via `apps.connections.open` | The Slack adapter pairs against the per-workspace app; each user creates their own | `docs/design/im-connections.md` |
| 7 | Composio account + API key | The consumer-app catalog decision routes through Composio | connector settings |
| 8 | Decide the tailnet policy: Funnel exposure on/off for remote phone reach | Phone reach without IM rides the tailnet; exposure is the owner's call | [Private phone access over Tailscale](../deploy/tailscale-mobile.md) |
| 9 | GitHub repo secrets for desktop-release secrets (signing material) | Release workflow needs them once certs exist | repo settings |
| 10 | First real-install smoke of each desktop artifact on a clean machine | The second-person criterion is measured, not assumed | `verify-cairn` evidence |

## Lanes can ship (no owner needed)

- The W0–W3 board items: specs, registries, adapters, gates, UI work behind review.
- ~~`desktop-release.yml` gating on the commit's green CI~~ DONE: `decide` refuses a SHA without green `check`/`pack-smoke`/`e2e-gate` (`scripts/ops/release-gate.mjs`), and `publish` waits on the `live-verify` new-task journey pass with evidence archived as an artifact.
- Adapter code for Telegram and WeChat iLink behind feature wiring, testable with recorded fixtures — credentials slot in when the owner does rows 5–6.
- Windows/Linux packaging and the daemon win32/Linux support work.
- Per-site egress env wiring, per-thread browser profiles, action-registry send/submit classes.

## Deferred by owner decision (do not start)

- Paid Apple Developer ($99/yr) and paid Windows code-signing certificates until launch monetization justifies the cost (2026-11-27 owner decision).
- Native iOS client catch-up after web settles: focus mobile reach on IM connectors (`Telegram`, `WeChat`, `Slack`) (2026-11-27 owner decision).
- Projectless save-for-later todos (`todo.projectId` nullable): dropped; every todo belongs to a project (2026-11-27 owner decision).
- Paid external API/cert spend deferred; Cairn Cloud Phase 1 uses Fly.io Machines + Volumes, BYOK Personal Cloud, and Creem as Merchant of Record, never Stripe (2026-11-27 owner decision).
- Telemetry collection endpoint (Backlog — self-operated Cloudflare Worker is the researched template).
- Payment-action registration (no payment surface exists).
- Engine breadth beyond the shipped set (W1 order unchanged).
- Draft-release manual publish step (direct publish stays for now).
