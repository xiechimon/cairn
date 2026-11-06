---
'@xiechimon/cairn': minor
'@xiechimon/cairn-cli': patch
---

Make the bare server safe by default. `HOST` now defaults to `127.0.0.1`. The first start generates an access token in `$CAIRN_HOME/token` (mode 0600) and the API always requires it; `CAIRN_AUTH=off` is the only opt-out and is accepted only on a loopback bind. A non-loopback `HOST` without a token refuses to start. The `Tailscale-User-Login` header no longer grants access and `CAIRN_TAILSCALE_USERS` is ignored; sign in with the access token.
