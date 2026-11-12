# tsnet-sidecar

Go sidecar that joins the owner's tailnet with Tailscale `tsnet` (pinned in `go.mod`) and proxies tailnet and Funnel connections to the cairn server. Design: `docs/research/remote-access-tsnet.md`.

```sh
CGO_ENABLED=0 go build -trimpath -ldflags '-s -w' -o tsnet-sidecar .
./tsnet-sidecar --state-dir ~/.cairn/tsnet --tailnet-upstream unix:/path/tailnet.sock --funnel-upstream unix:/path/funnel.sock
```

## Flags

| Flag | Meaning |
|---|---|
| `--state-dir` | tsnet state directory, required. Created with mode 0700. |
| `--tailnet-upstream` | Server listener for tailnet traffic, required. `unix:<path>` or `tcp:<host:port>`. |
| `--funnel-upstream` | Server listener for Funnel traffic. Funnel is refused while it is unset. |
| `--hostname` | Node name on the tailnet, default `cairn`. |
| `--control-url` | Coordination server, default Tailscale. |
| `--poll-interval` | Status poll interval, default 1s. |
| `--upload-logs` | Allow tsnet to upload node logs to Tailscale. Off by default: the sidecar sets `TS_NO_LOGS_NO_SUPPORT=true` before starting tsnet. |

## Protocol

stdout carries one JSON object per line; logs go to stderr. stdin carries one JSON command per line. Closing stdin, `SIGINT` or `SIGTERM` stops the sidecar.

| Event | Fields | Meaning |
|---|---|---|
| `authUrl` | `url` | The node needs login. Repeated only when the URL changes or login is needed again. |
| `ready` | `ips`, `dnsName` | The node is running and the tailnet listener (`:443`, TLS) is serving. |
| `funnel` | `enabled`, `url` or `error` | Result of a funnel command. On error Funnel stays off. |
| `error` | `error` | A non-fatal problem, or the fatal one before exit code 1. |
| `stopped` | | Listeners and the node are closed. |

| Command | Fields |
|---|---|
| `funnel` | `enabled`: `true` listens on `:8443` with `FunnelOnly`, `false` closes it. |
| `shutdown` | |

## Trust

Every proxied request loses `Tailscale-*`, `X-Forwarded-*`, `Forwarded` and `X-Real-Ip` headers. Only the tailnet listener sets `Tailscale-User-Login` and `Tailscale-User-Name`, from WhoIs of the peer address; the Funnel listener never does.
