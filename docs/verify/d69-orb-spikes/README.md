# D69 item 3: Orb on rootless Podman, spikes S1 to S4

Date: 2026-11-03 (host clock), run on omarchy as `ian`, no sudo, no Docker involved. Spikes defined in `docs/research/orb-container-runtime.md` section 8.

Labels: **measured** = run in this session, output kept in the logs next to this file; **inferred** = follows from measured facts, not run.

Host (measured): podman 6.1.4, rootless, crun, netavark, overlay on btrfs (`/home`), cgroup v2, `ian:100000:65536` in `/etc/subuid` and `/etc/subgid`, kernel `user.max_user_namespaces=2147483647` seen inside the container. Outbound access for `podman pull` and `podman build` worked directly; the local proxy at `127.0.0.1:7890` was only used as the upstream of the S3 egress path.

## Result summary

| Spike | Result | Key numbers |
|---|---|---|
| S1 image, sudo, caps, bwrap | PASS, with two design changes | `keep-id:uid=,gid=` accepted; `user` is uid 1000; `sudo -n true` works; smallest working cap set for sudo plus `pacman -S` is `CHOWN DAC_OVERRIDE SETUID SETGID`; recommended set is 7 caps (adds `FOWNER KILL SETFCAP`); `--cap-drop=all --cap-add=...` breaks bwrap; `--proc /proc` inside bwrap needs `--security-opt unmask=/proc/*` |
| S2 sockets over bind mounts | PASS | host-listens/container-connects works; container-listens/host-connects works; both need `keep-id`; sockets created by container root are unreachable from the host |
| S3 egress through a unix socket | PASS for the path, FINDING for the relay | container has only `lo`; direct egress fails; curl reaches `github.com:443` (HTTP 200) through socat to a unix socket; `egress-relay.mjs` cannot listen on a unix socket without code changes (crashes on the first connection), policy refuses private targets when run behind a spike shim |
| S4 commit | PASS | 618 MB, 30005 files in `/home/user/work`; first commit 15.3 s, repeats 1.6 to 2.7 s, changed-layer commits 4.2 to 7.1 s; pause makes no consistent difference; sentinel absent from the image in all three checks; image +590 MB |

## Design changes forced by the results

1. **Do not use `--cap-drop=all --cap-add=...` for the Orb.** With an explicit `--cap-add` podman puts the added caps in the ambient set of the non-root `user` (measured: `CapAmb: a00000eb` for `user`, no sudo involved). That has two effects: `user` holds `DAC_OVERRIDE`, `CHOWN` and the rest without sudo, and `bwrap` refuses to start (`bwrap: Unexpected capabilities but not setuid, old file caps config?`). Use the default capability list minus individual drops instead: `--cap-drop=FSETID --cap-drop=NET_BIND_SERVICE --cap-drop=SETPCAP --cap-drop=SYS_CHROOT`. That gives bounding set `0x800000eb` (`CHOWN DAC_OVERRIDE FOWNER KILL SETGID SETUID SETFCAP`), `CapEff`/`CapAmb` empty for `user`, `CapEff` = bounding set under sudo (measured). `AUDIT_WRITE` is not in podman's default list and sudo works without it (measured), so section 4 of the design should drop it. Because a future podman could change the default list, the host check should assert `CapBnd == 0x800000eb` from `runtime.exec`. Alternative if the explicit form is preferred (inferred to be equivalent for bwrap): keep `--cap-add`, and start the worker through `setpriv --ambient-caps=-all` (measured: bwrap rc 0 with that wrapper).
2. **Nested sandbox: `/proc` mounts fail.** User namespaces can be created inside the container under the default seccomp profile (`unshare -Ur true` rc 0, `bwrap --unshare-user --unshare-pid --unshare-net` without `--proc` rc 0), so the design guess "default seccomp blocks nested userns" is wrong for this host. What fails is mounting a fresh procfs (`bwrap --proc /proc`, `unshare --mount-proc`), because podman masks paths under `/proc`; `seccomp=unconfined` does not help, `--security-opt unmask=/proc/*` does. Claude Code's `enableWeakerNestedSandbox` (no `/proc` mount) therefore keeps working as is. Whether Chromium's sandbox starts was not run here (no Chromium in the image); it needs user namespaces, which work, and possibly a `/proc` mount, which depends on the `unmask` decision (inferred). Lane 1 should test Chromium with and without `unmask=/proc/*` before choosing `--no-sandbox`.
3. **Everything the host must connect to has to be created by `user`, not by root.** A socket created through `sudo` in a bind mount is owned by host uid 100000 with mode 0755, and `ian` gets `EACCES` (measured). The computer image must run x11vnc as `user` and set the socket mode (socat `mode=0600` worked; default umask gave 0755, which `ian` can still use as owner).
4. **`keep-id` is mandatory for the relay directory.** Without it, container `user` gets `Permission denied` on a 0700 directory owned by `ian` (measured). The daemon must also unlink a stale socket file before `listen` (a killed listener left `relay.sock` behind and the next `listen` hit `EADDRINUSE`, measured with node).
5. **`podman build` and `podman run` forward the host proxy variables by default.** `podman build` forwarded `HTTP(S)_PROXY=http://127.0.0.1:7890` into the build and `pacman -Syu` failed because that address is the container's own loopback (measured). `buildImage` must pass `--http-proxy=false`; the same flag on `run` keeps the host proxy from shadowing the in-Orb proxy (inferred, all S2 to S4 runs used it).
6. **`sudo` resets the environment, so proxy variables do not reach `sudo pacman` / `sudo npm`.** Measured both ways: `sudo pacman -Sy` with no network and no preserved env failed to install anything; with `sudo --preserve-env=HTTPS_PROXY,HTTP_PROXY,https_proxy,http_proxy pacman -Sy` it installed a package through the proxy. The image should carry `Defaults env_keep += "HTTP_PROXY HTTPS_PROXY http_proxy https_proxy NO_PROXY no_proxy"` in `/etc/sudoers.d/` (inferred fix, not run).
7. **PR 4 scope for `egress-relay.mjs`** (finding in S3): add a unix-socket listener, skip the `remoteAddress` check for it, set the socket mode to 0600 after `listen`. Without the skip the relay process dies on the first connection.
8. **`--security-opt no-new-privileges` must stay off**: sudo refuses to run (`The "no new privileges" flag is set`, measured).
9. **Snapshot cost is small enough**: a few seconds per commit for a 0.6 GB layer, against the 40 s cold start that #2279 wants to avoid. Committed images contain empty mount-point directories (`/run/cairn`, `/mnt/vol`), so a snapshot-based spawn still needs the same binds.

## Image used

`scripts/Dockerfile` (spike only): `docker.io/library/archlinux:latest` plus `sudo bubblewrap socat curl`, user `user` uid 1000, `/etc/sudoers.d/user` `user ALL=(ALL) NOPASSWD:ALL` mode 0440.

```sh
podman pull docker.io/library/archlinux:latest        # 19.8 s
podman build --http-proxy=false -t d69spike-arch:1 /tmp/d69spike/img    # 6.9 s, 498 MB (base is 411 MB)
```

Common flags in the runs below (measured as accepted):

```sh
--userns=keep-id:uid=1000,gid=1000 --cpus 4 --memory 4g --memory-swap 4g --pids-limit 4096 --ulimit core=0 --network none
# recommended cap form (design change 1):
--cap-drop=FSETID --cap-drop=NET_BIND_SERVICE --cap-drop=SETPCAP --cap-drop=SYS_CHROOT
```

## S1: image, sudo, packages, bwrap, minimal caps

Full output: `s1.log`. Helper scripts: `scripts/s1-case.sh`, `scripts/s1-extra.sh`.

**Suboptions.** `--userns=keep-id:uid=1000,gid=1000` is accepted by podman 6.1.4 and gives `id` = `uid=1000(user) gid=1000(user) groups=1000(user)` and `uid_map` `1000 0 1` (host `ian` is container `user`) (measured). PASS.

**sudo.** `sudo -n true` rc 0, `sudo id` = `uid=0(root)` (measured).

**Limits as applied** (measured): `memory.max=4294967296`, `memory.swap.max=0`, `pids.max=4096`, `cpu.max=400000 100000`, `ulimit -c` = 0.

**Package install.** Done with network (pasta default) because the base image has no package cache: `sudo pacman -Sy --noconfirm tree` rc 0 and `tree` runs (measured). The offline form also works: `pacman -Sw` in a first run, `podman cp` of the `.pkg.tar.zst` out, then `--network none -v pkg:/pkg:ro` with `sudo pacman -U /pkg/tree-*.pkg.tar.zst` installs and runs `tree` (measured). `pacman -S` through the unix-socket proxy with `--network none` is in S3.

**Original starting set, `--cap-drop=all` plus `--cap-add` of 8 caps** (`CHOWN DAC_OVERRIDE FOWNER SETUID SETGID SETFCAP KILL AUDIT_WRITE`):

```
CapEff (user): 00000000a00000eb   CapAmb (user): 00000000a00000eb
bwrap --ro-bind / / true  -> bwrap: Unexpected capabilities but not setuid, old file caps config?   (rc 1)
unshare -Ur true          -> rc 0
setpriv --ambient-caps=-all bwrap --ro-bind / / true -> rc 0
```

With default caps (no `--cap-drop`) or with individual `--cap-drop`, `CapEff`/`CapAmb` of `user` are 0 and plain `bwrap --ro-bind / / true` is rc 0 (measured). With `--cap-drop=all` and no `--cap-add`, sudo fails (`sudo: unable to change to root gid: Operation not permitted`) (measured).

**Removing caps one at a time** from `CHOWN DAC_OVERRIDE FOWNER SETUID SETGID SETFCAP KILL`, using the individual-drop form, each run does `sudo -n true`, a `chown` as root, `sudo pacman -Sy --noconfirm tree`, runs `tree`, and `bwrap --ro-bind / / true`:

| Removed | sudo | chown | pacman install | Error |
|---|---|---|---|---|
| none (7-cap set) | ok | ok | ok | |
| CHOWN | ok | fail | fail | `failed to chown temporary download directory` |
| DAC_OVERRIDE | ok | ok | fail | `could not chdir to download directory` |
| SETUID | fail | fail | fail | `sudo: setresuid(-1, 1, -1): Operation not permitted` |
| SETGID | fail | fail | fail | `sudo: unable to change to root gid` |
| FOWNER | ok | ok | ok | |
| SETFCAP | ok | ok | ok | |
| KILL | ok | ok | ok | |

All measured. Removing `FOWNER`, `SETFCAP` and `KILL` together (set `CHOWN DAC_OVERRIDE SETUID SETGID`) still passes sudo, pacman install of `tree`, and `pacman -S git nodejs`. What those three still buy, each measured alone: `FOWNER` lets root `chmod` a file owned by `user` (rc 0 with, 1 without); `KILL` lets root signal a process of `user` (`sudo kill -0` rc 0 with, 1 without); `SETFCAP` lets `setcap cap_net_raw+ep /usr/bin/ping` succeed (rc 0 with, `unable to set CAP_SETFCAP effective capability` without). `FSETID`, `NET_BIND_SERVICE`, `SETPCAP` and `SYS_CHROOT` (default caps) were dropped in all runs above without breaking anything.

**Smallest working set: `CHOWN DAC_OVERRIDE SETUID SETGID`** for sudo plus package install. **Recommended: those four plus `FOWNER KILL SETFCAP`** (what an interactive root user is expected to be able to do) and no `AUDIT_WRITE`. Package install paths that need other caps (for example a package with a `mknod` post-install step) were not enumerated.

**bwrap and nested namespaces, 7-cap set, default seccomp, as `user`** (measured):

```
bwrap --ro-bind / / true                               rc 0
bwrap --unshare-user --unshare-pid --unshare-ipc --unshare-uts --unshare-net --ro-bind / / --dev /dev --tmpfs /tmp sh -c ...   rc 0
bwrap --unshare-all --ro-bind / / --dev /dev bash -c ...                                                            rc 0
bwrap --unshare-all --ro-bind / / --proc /proc --dev /dev true   rc 1  bwrap: Can't mount proc on /proc: Operation not permitted
unshare -Ur true                                       rc 0
unshare -Urmpf --mount-proc true                       rc 1  unshare: mount /proc failed: Operation not permitted
unshare -Urn ip link                                   rc 0  (only lo)
same two /proc probes with --security-opt seccomp=unconfined: still rc 1
same two /proc probes with --security-opt unmask=/proc/*:     rc 0
```

Also: `--security-opt no-new-privileges` makes sudo exit with `The "no new privileges" flag is set, which prevents sudo from running as root.` (measured).

PASS. Changes: design changes 1, 2, 5, 8.

## S2: unix sockets across bind mounts

Full output: `s2.log`. Helpers: `scripts/host-server.mjs`, `scripts/host-client.mjs` (node 24 on the host), socat in the container.

```sh
mkdir -m 0700 /tmp/d69spike/run /tmp/d69spike/computer
podman run -d --name d69spike-s2 --userns=keep-id:uid=1000,gid=1000 <cap drops> --network none \
  -v /tmp/d69spike/run:/run/cairn:rw -v /tmp/d69spike/computer:/run/cairn-computer:rw d69spike-arch:1 sleep 600
```

(a) Host listens, container `user` connects (measured):

```
host stat:         ian:ian 700 directory / ian:ian 600 socket
in-container stat: 1000:1000 700 directory / 1000:1000 600 socket
container: echo hello-from-container-user | socat - UNIX-CONNECT:/run/cairn/relay.sock
host got: hello-from-container-user ; container received: pong-from-host to hello-from-container-user
```

(b) Container `user` listens on `/run/cairn-computer/vnc.sock` (`socat UNIX-LISTEN:...,fork,mode=0600 EXEC:"echo pong-from-container-user"`), host process as `ian` connects (measured):

```
host stat:         ian:ian 700 directory / ian:ian 600 socket
in-container stat: 1000:1000 700 directory / 1000:1000 600 socket
host client received: pong-from-container-user
```

A second socket created by `user` without `mode=` (default umask) is `ian:ian 755` on the host and also connectable by `ian` (measured).

(c) Owner and mode are identical on both sides for everything `user` creates (table above). Negative controls (measured):

- Default rootless mapping, no `keep-id`: container `user` (uid 1000) against the 0700 `ian` directory: `socat ... connect(...): Permission denied`; `stat` inside shows the directory as `0:0`.
- Socket created by container root through sudo (`sudo socat UNIX-LISTEN:/run/cairn-computer/root.sock ...`): host sees owner uid 100000, mode 755; the host connect fails with `EACCES`. The file also cannot be deleted by `ian` outside `podman unshare`.

PASS. Changes: design changes 3 and 4.

## S3: egress through a unix socket, `--network none`

Full output: `s3.log`. Helpers: `scripts/relay-unix-direct.mjs`, `scripts/relay-unix-shim.mjs`.

**Nothing gets out without the socket** (measured, no bridge running):

```
interfaces: lo only (127.0.0.1/8, ::1); `ip route` prints nothing
curl --noproxy '*' https://github.com        -> Could not resolve host
curl --noproxy '*' https://1.1.1.1            -> Failed to connect ... Could not connect to server
curl -x http://127.0.0.1:7890 https://github.com (no listener) -> Could not connect to server
ping -c1 1.1.1.1 as root-in-container         -> connect: Network is unreachable
```

**With the unix socket.** The bridge on the host is spike-only; the real policy lives in `scripts/ops/orb/egress-relay.mjs`:

```sh
socat UNIX-LISTEN:/tmp/d69spike/run/egress.sock,fork,mode=0600 TCP:127.0.0.1:7890 &     # host, spike-only
# inside the container, as user:
socat TCP-LISTEN:7890,bind=127.0.0.1,fork,reuseaddr UNIX-CONNECT:/run/cairn/egress.sock &
curl -sS -o /dev/null -w '%{http_code}' -x http://127.0.0.1:7890 https://github.com     # 200
curl -sS -o /dev/null -w '%{http_code}' https://api.github.com   # 200 with HTTPS_PROXY set
curl --noproxy '*' -m 5 https://1.1.1.1                          # still fails
```

All measured. PASS for the path: 443 is reachable only through the proxy variables, and the container still has only `lo`.

**The relay's own policy.** Reading `egress-relay.mjs` (measured): the CLI entry listens on `relayDefaults.host:port` = `10.203.0.1:7890` with no environment override of the address, and the `connection` handler calls `allowed.check(socket.remoteAddress, ...)`. Run unchanged on a unix socket (`createRelay({})` then `server.listen('/tmp/d69spike/run/relay-direct.sock')`), the first connection kills the process:

```
relay process crashed: ERR_INVALID_ARG_TYPE The "address" argument must be of type string. Received undefined
```

So it cannot serve a unix socket without code changes: that is PR 4's job, and the file was not modified. To still test the refusal policy, `relay-unix-shim.mjs` wraps the unmodified `createRelay()` in a `net.Server` on a unix socket that defines `remoteAddress` as `10.203.0.2` on each accepted socket before emitting `connection`. Behind that shim (measured):

```
CONNECT 10.0.0.1:443         -> HTTP/1.1 403
CONNECT 127.0.0.1:443        -> HTTP/1.1 403
CONNECT 169.254.169.254:80   -> HTTP/1.1 403
CONNECT 100.64.0.5:443       -> HTTP/1.1 403
CONNECT 192.168.1.1:22       -> HTTP/1.1 403
CONNECT github.com:25        -> HTTP/1.1 403      (port not allowed)
CONNECT github.com:443       -> tunnel opened (no response line within the 3 s socat window on a raw probe)
from the container: https://github.com -> 200; https://10.0.0.1 -> CONNECT tunnel failed, response 403;
                    https://169.254.169.254 -> 403; plain http to 10.1.2.3:8080 via the proxy -> 403
sudo --preserve-env=... pacman -Sy --noconfirm tree (network none, through the shim) -> installed
```

The node `listen` created the socket as `srwxr-xr-x`, so PR 4 must `chmod 0600` after `listen` (or rely on a 0700 parent directory). Side finding (inferred): the same `remoteAddress` call would also throw for a TCP client that resets before the `connection` handler runs, so the guard belongs in PR 4 for both listeners.

PASS for the socket path; FINDING for the relay (design change 7). Also design changes 5 and 6.

## S4: `podman commit` on btrfs/overlay

Full output: `s4.log`. Helper: `scripts/grep-image.sh`.

Setup (measured): container from the S1 image with `/run/cairn` bind (rw) and a named volume at `/mnt/vol`; `/home/user/work` filled with five 100 MB random files and 400 npm-style packages of 75 small files (1 to 3 KB): 618 MB, 30005 files; 2 min 3 s to create with a shell loop. Sentinel `D69SENTINEL-<24 hex>` written to `/run/cairn/relay.sock.token` and `/mnt/vol/vol.token`; a control string `LAYERMARK-control` written into the container layer.

Timings (measured, `time podman commit --pause=<bool>`):

| Case | Seconds |
|---|---|
| first commit, 618 MB layer, `--pause=true` (cold) | 15.3 |
| second commit, same layer, `--pause=false` | 2.4 |
| third, `--pause=true` | 2.7 |
| new 100 MB + 2000 files, `--pause=false` | 4.2 |
| next new 100 MB + 2000 files, `--pause=true` | 7.1 |
| one tiny file changed, `--pause=false` | 5.0 |
| unchanged 825 MB layer, `--pause=false` x3 | 1.8, 1.7, 2.0 |
| unchanged 825 MB layer, `--pause=true` x3 | 1.6, 2.7, 2.7 |

Pausing makes no consistent difference at this size. The first commit pays for compressing the layer; later commits of a changed layer take 4 to 7 s because the whole upper layer is re-archived (inferred from timings, a one-file change still cost 5 s). All well under the 40 s cold start that #2279 targets. This was one container on an otherwise idle host; no repeat on a loaded host.

Size (measured, `podman images`, uncompressed): base image 498 MB, committed 1.08 GB after the first setup (+590 MB for 618 MB of content), 1.31 GB after 825 MB of container layer. Committed images share the base layers (`podman system df` showed the container layer at 825 MB virtual 1.32 GB).

Sentinel proof (measured), image `r3-paused` and the first unpaused commit:

- A: running the committed image without mounts shows empty `/run/cairn` and `/mnt/vol`; `cat /run/cairn/relay.sock.token` -> No such file or directory; `/home/user/work` has its 34008 files (the layer data is there).
- B: `podman unshare` then `podman image mount` and `grep -rlaF` over the whole root file system (47217 files): sentinel hits 0; control marker found exactly at `/home/user/work/layer.mark`; `/run/cairn` and `/mnt/vol` are empty directories. Same result for the unpaused image.
- C: `podman save --format oci-dir`, each of the four layer blobs decompressed and grepped: sentinel 0 hits, control marker 1 hit (in the 767 MB layer); sentinel not in config or manifest JSON either.

PASS: bind-mounted and volume-mounted files are excluded from the commit, as the OCI semantics predicted. Change: design change 9. The positive control shows the grep method can find a string that is in the layer.

## Not covered

- Chromium itself (no Chromium in the image); see design change 2.
- Snapshot restore time (spawn from the committed image) and `podman commit` while a Node worker is writing; only commit was measured.
- CRIU checkpoint (not used by the design).
- Behaviour with a host uid other than 1000.
- The `OrbRuntime` health fields, canaries and `Linger`-based user units; these belong to PR 2 and PR 6.

## Cleanup

Everything created is listed and removed at the end of the session: container `d69spike-s4` (the others ran with `--rm` or were removed), volume `d69spike-vol`, images `localhost/d69spike-arch:1`, twelve `localhost/d69spike-snap:*` tags and the pulled `docker.io/library/archlinux:latest`. `podman ps -a`, `podman images`, `podman volume ls` were empty afterwards (measured). The scratch directory `/tmp/d69spike` keeps only small scripts and empty directories.
