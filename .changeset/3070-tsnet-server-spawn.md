---
'@xiechimon/cairn': minor
---

Add opt-in embedded Tailscale access. With `CAIRN_TSNET=1` the server supervises the tsnet sidecar (restart with backoff, clean shutdown) and serves tailnet traffic on a private Unix socket whose identity comes from the sidecar's WhoIs lookup, never from a request header. Node log upload to Tailscale is off unless `CAIRN_TSNET_UPLOAD_LOGS=1`. Nothing starts by default.
