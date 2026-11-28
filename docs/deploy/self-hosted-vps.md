# Self-host Cairn on a VPS with Docker Compose

Run the single-tenant Cairn server behind Caddy automatic HTTPS on any Linux VPS with Docker, while your Mac or Linux Runners connect back to it.

## Prerequisites

- A Linux VPS with Docker Engine and the Docker Compose plugin (`docker compose version`)
- A domain or subdomain (`A` / `AAAA` DNS record) pointing to the VPS IP
- Ports `80/tcp`, `443/tcp`, and `443/udp` reachable from the internet so Caddy can obtain and renew TLS certificates
- Git on the VPS if building the image from a checkout of this repository

## 1. Configure environment

Clone the repository onto the VPS and create `deploy/vps/.env` from the example file:

```sh
git clone https://github.com/xiechimon/cairn.git cairn
cd cairn/deploy/vps
cp .env.example .env
```

Generate a 64-character hex owner token and fill in `CAIRN_DOMAIN` and `CAIRN_TOKEN`:

```sh
openssl rand -hex 32
```

Restrict `.env` permissions so other users on the host cannot read the token:

```sh
chmod 600 .env
```

Minimal required values in `deploy/vps/.env`:

```sh
CAIRN_DOMAIN=cairn.example.com
CAIRN_TOKEN=<output from openssl rand -hex 32>
```

Keep `CAIRN_TOKEN` in a password manager as well; Docker Compose passes it into the container, where `CAIRN_REQUIRE_TOKEN=1` refuses startup if the token is empty.

## 2. Build and start Cairn + Caddy

From `deploy/vps`:

```sh
docker compose up -d --build
```

Verify both services stay healthy:

```sh
docker compose ps
docker compose logs -f cairn caddy
```

Wait until Caddy acquires the certificate and `https://$CAIRN_DOMAIN/app` loads in your browser. Both containers use `restart: unless-stopped`, so they come back automatically after host reboots.

## 3. Sign in from your browser and enroll a Runner

Open `https://<your-domain>/app` in your browser, click **Sign in with access token**, and paste the `CAIRN_TOKEN` value from `deploy/vps/.env` to establish your owner session.

To sign in another browser or mobile device without sharing the owner token, mint a one-time pairing link with `CAIRN_TOKEN` and open `https://<your-domain>/app#pair=<code>&env=<environmentId>` using the returned fields:

```sh
curl -s -X POST \
  -H "Authorization: Bearer $(grep '^CAIRN_TOKEN=' .env | cut -d= -f2-)" \
  "https://$(grep '^CAIRN_DOMAIN=' .env | cut -d= -f2-)/api/remote/pairing"
```

On each Mac or Linux machine where tasks execute, install the CLI once (`npm i -g @xiechimon/cairn-cli`) and enroll the Runner against the VPS origin using interactive browser approval:

```sh
cairn start --server "https://<your-domain>"
```

On a headless machine without a browser, create an API key in **Settings -> API keys** and enroll directly:

```sh
cairn start --server "https://<your-domain>" --api-key <cairn_...> --team <teamId>
```

## 4. Backups and optional Litestream WAL replication

All server state lives in the named Docker volume `cairn-data` mounted at `/data`:

- **Whole-account portable archive**: export an atomic `.tar.gz` archive anytime from **Settings -> Account -> Data and backups** (`POST /api/server/backup/export`). You can import that same archive on another self-hosted host or Cairn Cloud instance without losing repos or encrypted credentials.
- **Continuous SQLite WAL replication (optional)**: set `CAIRN_LITESTREAM_BUCKET`, `LITESTREAM_ACCESS_KEY_ID`, and `LITESTREAM_SECRET_ACCESS_KEY` (plus `CAIRN_LITESTREAM_ENDPOINT`, `CAIRN_LITESTREAM_PATH`, and `CAIRN_LITESTREAM_REGION` for R2/Tigris/MinIO) in `deploy/vps/.env` and restart with `docker compose up -d`. The compose template sets `stop_grace_period: 30s` so `SIGTERM` drains HTTP/SSE sockets and flushes the final WAL frame. Because `secretbox.key` sits alongside `server.db` under `/data/server`, also back up `cairn-data` or keep a whole-account export.

## 5. Upgrade cleanly

From the repository checkout on the VPS, the `cairn` directory you cloned in step 1:

```sh
cd ~/cairn
git pull --ff-only
cd deploy/vps
docker compose up -d --build
docker compose ps
```

All server state lives in the `cairn-data` volume, so rebuilding the image keeps your account, and the server applies any pending schema migrations itself on start. Watch the first start of a new version until both services are healthy:

```sh
docker compose logs -f cairn
```

Export a whole-account archive (step 4) before an upgrade that touches storage. If the container exits instead of turning healthy, that log names the failing step; restore the volume from your snapshot, check out the previous release tag, and rebuild to get the earlier version back.

## Troubleshooting

- **`cairn` container exits immediately with code 1**: `CAIRN_REQUIRE_TOKEN=1` requires non-empty `CAIRN_TOKEN` in `deploy/vps/.env` (the container never generates a default token on a non-loopback server). Check `docker compose logs cairn`.
- **HTTPS handshake or ACME challenge fails**: verify DNS resolves `CAIRN_DOMAIN` to the VPS and host/cloud firewall allows inbound TCP `80` and `443`.
- **Sign-in returns 403 behind your own reverse proxy or a nonstandard port**: the server compares the request's `Origin` with the public origin it was configured with. The compose template fills `CAIRN_WEB_ORIGIN` from `CAIRN_DOMAIN`, so fronting Cairn with another proxy on a different port means setting `CAIRN_WEB_ORIGIN` in `deploy/vps/.env` to the exact origin you open, port included, for example `https://cairn.example.com:8443`.
- **Real-time task logs stall behind custom proxies**: `deploy/vps/Caddyfile` configures `flush_interval -1` for SSE responses. Keep unbuffered streaming enabled if you place another reverse proxy or CDN in front of Caddy.
