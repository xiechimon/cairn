# Default public-web fetching

## Primary sources

| Source | Observed behavior | Trade-off |
| --- | --- | --- |
| [Scrapling installation](https://github.com/D4Vinci/Scrapling/blob/v0.5.1/docs/index.md#installation), [package metadata](https://github.com/D4Vinci/Scrapling/blob/v0.5.1/pyproject.toml) | Firsthand: Python >=3.10; base package is parser-only. `scrapling[rag]` includes HTTP fetchers, CLI and Markdown conversion. | Fetcher extras include Playwright Python packages, but do not download browsers. |
| [HTTP fetcher](https://github.com/D4Vinci/Scrapling/blob/v0.5.1/scrapling/fetchers/requests.py), [CLI](https://github.com/D4Vinci/Scrapling/blob/v0.5.1/docs/cli/extract-commands.md) | Firsthand: `scrapling extract get URL output.md` requires no Scrapling account or API key; cookies and proxies are optional. | A website may still require its own login or refuse automated access. No universal access guarantee. |
| [Browser installer](https://github.com/D4Vinci/Scrapling/blob/v0.5.1/scrapling/cli.py) | Firsthand: `scrapling install` separately downloads Chromium and installs OS dependencies. | Leave this opt-in; it can require administrator privileges on Linux. Browser size varies by platform/version. |
| [uv releases](https://github.com/astral-sh/uv/releases/tag/0.13.8) | Firsthand: standalone macOS/Linux arm64/x64 archives with published SHA-256 digests; approximately 14–20 MB compressed. uv can provision Python without system Python. | First startup requires network and disk space; no shell installer or administrator account is necessary. |
| [Agent Reach installation](https://github.com/Panniantong/Agent-Reach/blob/main/docs/install.md) | Firsthand: install from the official release URL, not the unrelated PyPI package; setup and channel configuration are separate. | Authentication depends on the requested channel, not on Agent Reach as a whole. |
| Cairn `cli.ts`, `machine-loop.ts`, `backend/skills.ts`, desktop `runner.ts` | Firsthand: Agent Reach was not installed by Cairn. Its doctor was called unconditionally every ten minutes; local skills could expose an existing installation. Desktop uses the same daemon foreground entry point. | A shared startup provisioner covers both desktop and CLI without npm postinstall. |

## Recommendation

Inference: Provision a private pinned `scrapling[rag]==0.5.1` environment at daemon startup, using a checksum-pinned standalone uv and managed Python 3.12. Never install browsers by default. Add that environment to the daemon and child agents' PATH. Probe actual importability and version rather than treating a successful package download as readiness. Keep equivalent usage guidance in the shared session prompt and Coordinator prompt. Filter Agent Reach skills and doctor reporting until the user explicitly enables it; leave all installed packages and credentials untouched.

Firsthand: Linux x64 installed packages occupy approximately 367 MiB, managed Python 112 MiB and uv 37 MiB, excluding shared caches. The package environment lives at `${CAIRN_HOME}-web-tools`, outside the daemon's credential directory: the Linux sandbox deliberately hides `CAIRN_HOME` but exposes the rest of the home overlay read-only. No confinement policy is weakened to expose the public tools.

## State and wire design

- Scrapling: absent → provisioning → ready. A failed provision logs an actionable error, omits the capability, and does not prevent machine enrollment; the next start retries. Installation is idempotent. HTTP readiness is checked at most every ten minutes; failed probes remove stale readiness. No network request is made by the probe.
- `capabilities.scrapling` is optional `{version}` and means the HTTP fetcher imports successfully. Enrollment and presence carry it; shared parsing drops malformed values independently. Older readers ignore the new field. No database migration or dispatch requirement is added.
- Agent Reach: disabled by default. `cairn web-tools agent-reach --enable` installs the official release only if missing, then writes a private enable marker under `CAIRN_HOME`. `--disable` removes only that marker. The doctor and skill discovery consult the marker. No package, skill or credential is deleted; restart the Runner after changing the marker so its child PATH is refreshed.
- Concurrent setup invocations use separate temporary uv download directories; uv serializes package-environment writes. A marker is written only after installation succeeds. Disabling during an outstanding doctor discards the result on the next read.
- Workers in isolated orbs provision inside the guest, never assume the host's Python environment is mounted. Coordinator guidance routes research to a task and does not claim that the in-server Coordinator has shell access.

## Verification

Targeted tests cover provisioning failure/retry, readiness/cache invalidation, opt-in persistence, skill visibility, shared wire parsing, and both worker session prompt composition and Coordinator guidance. A clean isolated real environment must fetch and extract a known public page without credentials or browser downloads. macOS archive selection is tested on Linux; running the macOS binary requires a Mac and is not claimed here.
