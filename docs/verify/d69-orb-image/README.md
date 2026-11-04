# D69 item 3, PR 3: Orb container image

Date: 2026-11-03/04 (host clock), omarchy, rootless podman 6.1.4, user `ian`, no sudo, Docker untouched.
Labels: **measured** = run in this session; **inferred** = follows from measured facts.

Files: `apps/daemon/orb-image/Dockerfile`, `apps/daemon/orb-image/entry.sh`, `scripts/ops/orb/build-container-image.sh`, `scripts/ops/orb/build-container-image.test.mjs`.

## Build

```sh
bash scripts/ops/orb/build-container-image.sh      # last stdout line is the tag
```

Pins in this run (measured): Node major 24 from `.nvmrc` (Arch `nodejs-lts-krypton` 24.22.2), Claude Code 2.1.316 and codex-cli 0.166.0 from `ian`'s login shell, pnpm 12.5.1 from `scripts/ops/orb/pnpm.version`, `USER_UID=1000`. The Arch base is `docker.io/library/archlinux@sha256:ece6c971fec3c532fd508bce299a446deaf469feecbfe7c353e995bc1a5e7bba` (the `latest` index digest resolved on 2026-11-03; amd64 manifest `sha256:42217d5f...`, created 2026-11-02).

Result (measured):

```
Successfully tagged localhost/cairn-orb-base:eb315075e947f674
cairn-orb-base:eb315075e947f674          # stdout, last line
```

- Wall time of the script 214 s, of which about 80 s was waiting for `/tmp/cairn-heavy.lock` held by another process (measured: `flock` child alive 75 s before `podman build` started), so the build itself took about 135 s. The base layer was already pulled (19.8 s in the spike).
- Image size 1.56 GB (`podman images`), 8 layers, base 411 MB.
- The build needed no proxy: `podman build --http-proxy=false` reached the Arch mirrors and the npm registry directly, so no `--build-arg` proxy was used.
- A second run of the script printed `image cairn-orb-base:eb315075e947f674 already exists; skipping build` and the tag, in 0.08 s.
- Editing `build-container-image.sh` does not change the tag; the hash covers `Dockerfile`, `entry.sh` and the pins (tests below).

## Run with PR 2's flags (measured)

```sh
podman run --rm --userns=keep-id:uid=1000,gid=1000 --network none \
  --cap-drop=FSETID --cap-drop=NET_BIND_SERVICE --cap-drop=SETPCAP --cap-drop=SYS_CHROOT \
  --http-proxy=false --init --pull=never cairn-orb-base:eb315075e947f674 bash -c '...'
```

```
uid=1000(user) gid=1000(user) groups=1000(user)
sudo -n true: ok; sudo id -u: 0
v24.22.2                      (.nvmrc: 24)
recipe=eb315075e947f674  claude=2.1.316  codex=0.166.0  pnpm=12.5.1  node_major=24  agent_uid=1000    (/etc/cairn-orb-image)
2.1.316 (Claude Code)
codex-cli 0.166.0             (also prints: WARNING: failed to clean up stale arg0 temp dirs: Cross-device link (os error 18))
12.5.1
bwrap --ro-bind / / true: rc 0
tmux 3.8; Python 3.14.9; git 2.56.0; OpenSSH_10.6p1; socat 1.8.1.3
CLAUDE_CONFIG_DIR=/var/lib/cairn-claude/config   drwxrwx--T root:user   settings.json -rw-r--r-- root:root
rm settings.json as user: Operation not permitted
sudo env_keep: HTTP_PROXY=http://x:1 set on the caller survives `sudo -n env`
CapEff 0000000000000000  CapBnd 00000000800000eb  CapAmb 0000000000000000   (matches the spike)
```

### Entry script in a real container

A fake `cli.mjs` that records its environment stood in for the daemon dist; the relay socket and an HTTP responder on a unix socket were created on the host by `ian`. Mounts as in PR 2: `/run/cairn` (rw), `/opt/cairn/daemon` (ro), `/seed` (ro), the egress socket at `/run/cairn-egress/egress.sock`, env `CAIRN_ORB=1` and `CAIRN_ORB_EGRESS_SOCKET`, no command (the image `CMD` is the entry script).

```
argv=orb-step --socket /run/cairn/relay.sock uid=1000 CAIRN_ORB=1 HTTP_PROXY=http://127.0.0.1:7890 https_proxy=http://127.0.0.1:7890 NO_PROXY=localhost,127.0.0.1,::1
argv=orb-step ...                       (second start after the fake worker exited 75)
egress-reply=proxied:GET http://example.test/hello HTTP/1.1      (curl via the proxy variables, socat to the host unix socket)
direct=blocked                          (curl --noproxy '*' https://1.1.1.1 under --network none)
container exit code 0
worker exit 3 -> container exit 3 after one start
podman stop while waiting for a missing relay.sock -> exit code 143 (graceful, inside the 10 s grace)
```

## Tests

`node --test scripts/ops/orb/build-container-image.test.mjs`: 20 tests, a fake `podman` on `PATH` for the build script and fake `node`, `socat`, `ss` for the entry script (the constants for the two socket paths are rewritten into a temporary copy).

## Not covered

- The image does not carry the daemon dist; `/home/agent` in `apps/daemon/src/orb/worker.ts` (`ORB_AGENT_HOME`) is still the nspawn user's home and does not exist here. The image user is `user` with `/home/user`; PR 5 owns that rename.
- Chromium and the `computer` stage (lane 1). The Dockerfile has only `base`; a `computer` stage must start with `USER root` and end with `USER user`.
- Pacman package installation from inside the Orb with `sudo` through the proxy (the env_keep line was verified; the install path is the spike's S3).
