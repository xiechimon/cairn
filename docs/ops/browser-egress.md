# Browser egress

The agent browser on a daemon host routes its traffic two ways, from the daemon's environment:

- `https_proxy` / `HTTPS_PROXY` / `http_proxy` / `HTTP_PROXY` — one flat exit for every site. Set in the daemon unit drop-in or `~/.config/cairn/server.env` style env files.
- `CAIRN_PROXY_PAC_URL` — a PAC URL for per-site routing; when set it wins over the flat proxy. Serve the PAC file from a loopback address on the host (for example a small static server on `127.0.0.1`), so browser startup does not depend on the network it is about to use.

The same args reach every browser surface: agent sessions (`AGENT_BROWSER_ARGS`), the owner-facing manual browser, and the resident CloakBrowser launcher. Chromium resolves the PAC script per request, so `FindProxyForURL` can send blocked sites through a residential or tailnet exit and keep the rest direct:

```js
function FindProxyForURL(url, host) {
  if (host.endsWith('zhipin.com')) return 'PROXY 127.0.0.1:7890';
  return 'DIRECT';
}
```

Notes:

- This routes browser traffic only; agent CLIs and the daemon's own API calls keep their own env.
- Per-thread profile isolation is a separate item on the roadmap board; egress applies per browser launch, not per thread.
- A PAC URL pointing at a dead endpoint makes every navigation fail — keep it loopback and owned by the same user unit as the daemon.
