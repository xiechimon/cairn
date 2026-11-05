# Deploy on Railway

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new)

`railway.json` makes Railway build the `Dockerfile` and health-check `/app`. The button opens Railway's new-project page; choose Deploy from GitHub repo and this repository, then:

1. Attach a volume mounted at `/data`.
2. Set `CAIRN_TOKEN` to `${{secret(64, "abcdef0123456789")}}` (Railway generates a random value once) and `RAILWAY_RUN_UID=0` (Railway volumes are root-owned; the image otherwise runs as the `node` user).
3. Generate a public domain. `PORT` is supplied by Railway.

Point a daemon at the public server. Create an API key in the web UI (`/app/api-keys`), then on the machine that runs builds:

```sh
cairn start --server https://<your-app>.up.railway.app --api-key <cairn_...> --team <teamId>
```
