# Orb host provisioning

Run these steps as `ian` from the same Linux checkout used by
`cairn-daemon.service`. Inspect its working directory and exact Node executable:

```sh
systemctl --user show cairn-daemon.service -p WorkingDirectory -p ExecStart
```

Run `<ExecStart-node-path> --version` using the absolute `path=` value above.
The host currently uses mise Node 26.x; the login shell's Node is not the source
of truth. Preview installation, then install twice with the owner's privileges:

```sh
bash scripts/ops/orb/install-host.sh --dry-run
sudo bash scripts/ops/orb/install-host.sh
sudo bash scripts/ops/orb/install-host.sh
```

The second successful install must print `0 changes`. The image builder reads
`claude --version` and `codex --version` from `ian`'s login shell (currently
Claude Code 2.1.302 and codex-cli 0.163.0). It reads the Node major by running
`--version` on the daemon service's ExecStart binary. If service discovery is
unavailable, supply the major verified above explicitly to each command:

```sh
CAIRN_ORB_NODE_MAJOR=26 bash scripts/ops/orb/install-host.sh --dry-run
sudo env CAIRN_ORB_NODE_MAJOR=26 bash scripts/ops/orb/install-host.sh
sudo env CAIRN_ORB_NODE_MAJOR=26 bash scripts/ops/orb/install-host.sh
```

The guest's Arch `nodejs` package must have that same major and satisfy Node
>=22.19. A mismatch aborts before image publication with the expected major;
provide a compatible guest package before retrying. There is no daemon npm
package/version override or fallback.

The installer only creates the `ian`-owned `dist` directory inside its root-owned
parent; the host daemon owns release publication. After the matching checkout
has been built by the normal daemon deployment, restart its service as `ian`
to use the daemon-side release publisher, then inspect the published contract:

```sh
systemctl --user restart cairn-daemon.service
cat /var/lib/cairn-orb/dist/current.json
readlink /var/lib/cairn-orb/dist/current
readlink /var/lib/cairn-orb/dist/cli.mjs
test -f /var/lib/cairn-orb/dist/current/dist/cli.mjs
test -d /var/lib/cairn-orb/dist/current/node_modules
scripts/ops/orb/orb-host-check.sh --json
```

Do not copy a standalone `cli.mjs` or install the daemon from npm. Release
publication requires the matching daemon-side publisher; the host installer does
not implement or substitute for it. A missing release does not fail the network
host check, but guests need a published release to run a Thread.

A passing result exits zero and contains `image: "cairn-orb-base"`,
`cloneStartStop: "ok"`, `egress: "ok"`, `memoryMax: 4294967296`,
`homeVisible: false`, `negativeControl: "denied"`, `privateEgress: "denied"`,
and `firewall: "ok"`, with `ok: true` and an empty `errors` array. Save the actual
host output to `docs/verify/2273/host-check.json` after installation. Local fixtures
are not host acceptance evidence. The check creates and cleans up a unique
`cairn-orb-check-*` container and refuses password prompts.

Decision record: "transport decided by ian 2026-10-31 (option 1)".
The guest dials the host; the host never executes commands in a guest.

## Failure modes and local verification

- Missing or partial images, invalid CLI pins, failed daemon Node discovery, Node
  below 22.19, and a guest/host Node-major mismatch fail closed. Node-major or CLI
  drift rebuilds the image; daemon release changes do not.
- Polkit evaluates both clone source and destination; other users, unnamed
  actions, unrelated units, and nonmatching names receive no grant.
- Resource limits, private users, proxy configuration, and host-path isolation
  must survive cloning and starting any `cairn-orb-*` instance.
- NetworkManager keeps physical interfaces; networkd only manages container
  links. The relay binds the container bridge only. No direct routing is enabled.
- Pre-planted runtime files, symlinks and unrecognized directories are refused.
  Only root creates or removes bind sources; fd operations set runtime ownership
  and mode. A dedicated 64 MiB tmpfs with at most 4096 inodes bounds each guest's
  runtime writes. Mount and unmount failures stop preparation or cleanup. Parent
  ownership, modes and hardlink protection fail closed.
- Dry runs perform no mutations. Completed installs converge to zero changes;
  failed steps are never recorded as completed.
- Missing images, authorization denial, missing or malformed guest metadata, failed cleanup, broken
  proxy egress, visible host homes, and incorrect limits cannot produce success.

Local Node tests use only built-ins, recorded command-output fixtures, a fake
polkit object, and stateful fake host commands. The owner must still verify
actual systemd, polkit, package installation, and proxy behavior on the host.

The host needs `nft`, `ip`, `nmcli`, systemd, and a Node executable available
through root's PATH or `ian`'s login shell. The installer copies that executable
to `/usr/local/lib/cairn-orb/node` for the relay, so a home-based Node install
works with the user unit's `ProtectHome=yes`. Binary content and mode converge
on reruns. Existing networkd-managed host links or earlier network configuration
files stop the installer before changes.
The image contains Node and pinned Claude Code/Codex CLIs, with npm lifecycle
scripts disabled. It installs no daemon package or production dependencies.
`/etc/cairn-orb-image` records `node_major`, `claude`, `codex`, `agent_uid`, and
the recipe hash. A completed base image is rebuilt when those values change.
Legacy markers containing pnpm or daemon package/version pins are recognized
and rebuilt once into this contract. The previous base survives failed builds
and is replaced only after the staging image is complete and unmounted.
Unrecognized images are preserved and stop installation. The rebuild is printed
and counted; the next run prints `0 changes`. Existing clones keep their tools.

The proxy subnet is `10.203.0.0/24`, with the relay at `10.203.0.1:7890` on
`vz-cairn`. The subnet must be unused on the host. The container DHCP server
advertises no router or DNS server. The relay resolves names locally, checks
every returned address, then sends `CONNECT <checked-ip>:<port>` to the upstream
proxy at `127.0.0.1:7890`. IPv6 authorities use brackets. This pins the actual
connection to the checked IP under the measured upstream configuration. HTTP
absolute URIs use that same tunnel with an origin-form request and the destination
Host header; HTTPS retains the client TLS handshake and SNI.
NetworkManager ignores `ve-*`, `vz-*`, and nspawn's bridged `vb-*` slave links.
Networkd manages only `ve-*`, `vz-*` and the `vb-*` zone ports (stock `80-container-vb.network`); every other link is unmanaged.

Systemd does not expand instance-name prefixes when looking up drop-ins. A
shared start-preparation hook clears fixed binds for unrelated machines and
installs the trusted template under `/run/systemd/nspawn/<name>.nspawn` before
each matching start. It reads the requested limits drop-in and applies its
properties to that exact unit with `systemctl set-property --runtime`.
The template drop-in passes three fixed binds using the systemd `%i` instance
specifier. The existing preparation hook writes the fixed bind arguments into a root-owned environment file only for
matching Orb machines. The active bind variable defaults to empty, so unrelated
machines receive no Orb binds:

| Host source | Guest target | Access |
| --- | --- | --- |
| `/run/cairn-orb/%i` | `/run/cairn` | writable, `idmap,norbind` |
| `/var/lib/cairn-orb/dist` | `/opt/cairn/daemon` | read-only, `idmap,norbind` |
| `/var/lib/cairn-orb/seed` | `/seed` | read-only, `idmap,norbind` |

The installer prints and installs `/etc/tmpfiles.d/cairn-orb.conf`, which
recreates `/run/cairn-orb` at boot. Both `/run/cairn-orb` and
`/var/lib/cairn-orb` are `root:root`, mode `0755`. The installer creates `dist`
and `seed` inside the latter, owned by `ian`, mode `0755`. Nspawn binds those
directories themselves, read-only. Their parent cannot be modified by `ian`,
so changing their contents cannot replace a bind source. Symlinks inside the
exported directories resolve in the guest namespace and cannot redirect a bind
to another host path.

At every start, the root `ExecStartPre` preparation hook creates the exact
`/run/cairn-orb/<machine>` directory. It uses `lstat` to refuse pre-planted files,
symlinks and directories without its root-owned device/inode record in
`/run/systemd/nspawn/<machine>.runtime`. It creates a missing directory with
`mkdir`, opens it with `O_DIRECTORY|O_NOFOLLOW`, and immediately mounts a dedicated
tmpfs through the inherited fd before nspawn binds it. The mount uses
`size=64M,nr_inodes=4096,mode=0700,uid=<ian>,gid=<ian>,nosuid,nodev,noexec`.
The helper reopens the mounted directory without following symlinks, sets its
ownership and mode through that fd, and records both the tmpfs and underlying
directory identities. Repeated preparation recognizes the recorded mount.
An old runtime directory from the previous owner-writable parent design requires
administrator inspection and removal before starting; it is never adopted
automatically. `ExecStopPost` checks the mounted identity, unmounts through its fd
(lazily if a normal unmount fails), checks the underlying identity, then removes
the directory and record. Failed unmounts preserve the directory and record;
failed removal after unmount can retry without unmounting the host filesystem.
GNU `rm` handles nested symlinks without traversal and refuses to cross filesystem
boundaries. The daemon never creates or removes the bind source: after `machinectl start`, it waits for
the prepared directory, then creates `relay.sock` and `outbox/` inside it.

`norbind` prevents nested mounts from propagating. `PrivateUsers=pick` is retained,
and the image pins `agent` to host `ian`'s numeric UID. Per
[systemd's idmap contract](https://www.freedesktop.org/software/systemd/man/latest/systemd-nspawn.html#--bind=),
identity `idmap` maps guest root to host UID 0 and guest `agent` to host `ian`'s
UID on these mounts only; it is not a root-to-ian mapping. Outside these binds,
the private user namespace retains its allocated UID range. Host root-owned
parents are never mounted, `dist` and `seed` are read-only, and the only writable
export is the newly prepared disposable runtime directory. Guest-created UID-0
files may exist there, but unrelated host root-owned files are not exposed.
The preparation hook requires `fs.protected_hardlinks=1`, preventing `ian` from
introducing hardlinks to files it neither owns nor can already read and write
([kernel contract](https://docs.kernel.org/admin-guide/sysctl/fs.html#protected-hardlinks)).
The runtime filesystem must have `nosuid,nodev`; unsupported protection fails
startup. Together these controls close source swaps, external symlink traversal
and hardlink import of host root files that `ian` cannot already modify.

Mode `0700` initially prevents other host users, including `cairn-runner`, from
traversing the runtime directory. Compromised guest code running as `agent` has
the same UID as `ian` on the idmapped mount and can chmod its own runtime
directory and socket. Filesystem modes alone therefore do not keep other host
users out after guest compromise: the per-step relay token is the authentication
boundary. Another container has its own user namespace and only its exact runtime
directory mounted; the runtime parent and other machines' sockets are absent.
No network listener exposes the relay socket. Actual filesystem idmap support,
root/agent UID observations and cross-user/container isolation must still be checked on the Linux host after
installation; local tests validate the installed arguments and exercise directory
lifecycle operations, with root ownership, tmpfs mount/unmount and GNU cleanup
commands simulated.

The revised dist contract was decided on 2026-10-31: guests run the same daemon
build as the host's git checkout. npm's `@xiechimon/cairn-cli` through 0.2.2
predates the relay protocol and cannot supply this build.
The daemon-side publisher produces a self-contained
`/var/lib/cairn-orb/dist/releases/<key>/` containing the built `dist/` files and
production `node_modules`. Dependencies must come from the checkout's lockfile:

```sh
pnpm --dir <checkout> deploy --filter @xiechimon/cairn-cli --prod --offline <tmp>
```

An offline deploy failure must produce a clear error, never an npm fallback.
The key is `<package version>-<git short SHA of the checkout>`, with
`-dirty-<content hash>` appended for a dirty build. Publication uses a temporary
directory followed by atomic rename; identical keys are reused. Relative
symlinks `current -> releases/<key>` and `cli.mjs -> current/dist/cli.mjs`
keep the entry stable. `current.json` contains `{key, version, sha}`. Releases
beyond the newest three are pruned only when they are not `current`.
The guest resolves imports through the entry's real path inside the release,
so its dependencies resolve from
`/opt/cairn/daemon/releases/<key>/node_modules`. No image-provided daemon
dependencies are needed.
Put Project seeds at `/var/lib/cairn-orb/seed/<projectId>/repo`, as `ian`.
The image uses one `daemon_entry` variable, `/opt/cairn/daemon/cli.mjs`. The enabled
`cairn-orb-worker.service` runs as `agent`, waits for `/run/cairn/relay.sock`,
and runs exactly `/usr/bin/node /opt/cairn/daemon/cli.mjs orb-step --socket /run/cairn/relay.sock`
with `Restart=always`.
The daemon relay protocol owns authentication, step binding, heartbeat, tool
and done messages; host crash fallback and the 120-second watchdog remain
on the host. This host/image change requires the daemon transport rework.

The polkit rule grants only scoped image clone/remove, unit start, and machine
kill/terminate. `machinectl poweroff` uses the machine `kill` authorization;
there is no separate `poweroff` verb grant. Listing needs no extra grant.
Shell, login, PTY, inspection, bind, copy, unregister, root-directory access,
unit stop/restart and unrelated operations receive no Orb grant.

The filtering relay uses Node built-ins and runs as the user unit, bound only
to the bridge IP and accepting only `10.203.0.0/24`. It refuses loopback, RFC1918,
link-local, CGNAT (including the tailnet), multicast, unspecified addresses,
IPv6 ULA and IPv4-mapped equivalents, including mixed public/private DNS
answers. Destination ports default to 80, 443 and 22 for both CONNECT and
absolute-URI HTTP. Other ports receive HTTP 403 before DNS resolution or upstream
contact. Override the comma-separated `CAIRN_ORB_ALLOWED_PORTS` through an
`egress-relay.service` environment drop-in; it replaces the defaults. Empty or
invalid port lists prevent startup. After changing the drop-in, reload the user
manager and restart the relay. It caps request and upstream response headers
at 16 KiB, idle time at 30 seconds, concurrent clients at 128 and unit tasks at 256.

The installer prints and installs its own `inet cairn_orb` nftables table.
Only container-subnet TCP/7890 to the bridge and DHCP client UDP/68 to server
UDP/67 reach host input; all other input and forwarding from `vz-cairn` drop.
DHCP replies originate on the host output path. The transaction flushes only
this owned table and recreates its rules, leaving existing host tables intact.
The enabled `cairn-orb-firewall.service` restores it before networkd at reboot;
networkd and nspawn require that service to succeed before starting. Guests
on the shared bridge can still communicate at layer 2.

The host check needs no sudo or nftables read access. It requires
`systemctl is-active cairn-orb-firewall.service` to report `active`. Inside the
throwaway container as `agent`, the baked `cairn-orb-check.service` uses `timeout 3 bash -c` with `/dev/tcp` to
connect directly to `10.203.0.1`, bypassing all proxy settings. TCP/7890 must
connect; TCP/22 and TCP/5231 must time out (exit 124). Set the comma-separated
`CAIRN_ORB_CHECK_BLOCKED_PORTS` environment variable to replace the blocked ports
with two to sixteen distinct ports, excluding 7890. Missing tools, incomplete
probes, an inactive service, reachable blocked ports, or an unreachable proxy
produce `firewall: "failed"` and `ok: false`. A refused connection does not count as a firewall drop. These probes sample
selected ports rather than proving every firewall rule. The guest proxy negative checks explicitly bypass NO_PROXY and
require HTTP 403 for both `127.0.0.1:80` and `10.203.0.1:22` (allowed ports, so the address filter refuses them); connectivity
errors cannot count as successful proxy filtering. Public egress has three
retries bounded by a 20-second retry window and a 30-second subprocess timeout.

After start, the checker waits at most 30 polls for the root-prepared private
runtime directory and writes a request ID and blocked-port list to `check-request`.
The image's enabled
`cairn-orb-check.path` detects that file. The guest writes only exit statuses,
HTTP status codes, port numbers and request ID to an atomically published
`check-result.json`, then removes the trigger. No response bodies, headers,
stderr, credentials or tool output are returned. The host waits at most 150
polls, rejects symlinks, oversized/nonregular files, stale IDs and unexpected
fields, then powers off the clone. It polls machine listing for at most 30
attempts, requests terminate after 15, and removes the clone only once it is
absent. Root `ExecStopPost` owns runtime cleanup; the checker waits at most 30
polls for it and reports missing cleanup as a failure. A still-running machine
keeps its runtime directory.
No `systemd-run -M`, `--machine` guest transport, or `machinectl bind/shell/login`
is used. The template's `systemd-nspawn --machine=<name>` only names a new
container; the installer addresses the host user manager through `runuser`.

The `--json` result has `image` (base-image name or null), `cloneStartStop`
(`ok` or `failed`), `egress` (`ok` or `failed`), `privateEgress` (`denied` or
`failed`), `firewall` (`ok` or `failed`), `memoryMax` (bytes or null),
`homeVisible` (boolean or null), `negativeControl` (`denied` or `failed`),
`daemonRelease` (`{key, version, sha}` from `/var/lib/cairn-orb/dist/current.json`,
or null when absent or unreadable), `ok` (boolean), and `errors` (string array).
`daemonRelease` is informational and never affects `ok`. Exit status is zero only when
`ok` is true. Configuration or user-validation errors return `ok: false` and
`errors` without the probe fields.

## Risk notes

The proxy path relies on sing-box not re-resolving checked IP destinations or
using fake-IP DNS, as measured on 2026-10-31. A later sing-box configuration
change, including sniff override or fake-IP, could reopen loopback access
through the upstream; the bridge firewall does not cover that proxy path.
The relay does not block the host's own public IPv4 address, so hairpin NAT to
router port forwards remains reachable on allowed destination ports.

Networkd has `Requires=cairn-orb-firewall.service` and starts after it. A failed
firewall unit keeps the container bridge down. Physical host networking remains
managed by NetworkManager and is unaffected.

The polkit transient-unit protection relies on the installed
`systemd-nspawn@.service` template existing: systemd must load that template
instead of allowing a caller to supply an arbitrary transient unit definition.
The Orb rule grants only scoped clone/remove, start, kill and terminate actions.
As reported by the owner for this host, `ian` is also in `docker` and `wheel`;
polkit scoping is not a real boundary against a compromised `ian` process today.
Clones may use the base as a source; they cannot replace, remove or start it.
The fixed idmapped binds require kernel/filesystem support; unsupported mounts
fail startup instead of falling back to permissive modes. Image UID changes
require rebuilding the base and recreating existing clones. The build lock is
root-owned under `/run/lock/cairn-orb`, separate from private relay directories.

transport decided by ian 2026-10-31 (option 1). The mount-source swap finding
is addressed by root-owned bind-source parents, root preparation and stop hooks,
and fd-based runtime ownership changes. `ian` retains ownership of the source
contents without permission to rename or replace a source inode. Identity idmap
is retained with the read-only exports, private runtime and hardlink gate above.
This records the fix within option 1; it does not claim a new independent review
verdict or Linux host acceptance.

Every guest can read all Project seeds under the explicitly decided shared
read-only `/seed` mount; this is not a boundary between Projects. Multi-user
hosting in phase 2/3 requires per-Project seed binds instead of the shared `/seed`.
The worker unit sets `CAIRN_ORB=1`, but needs the separate daemon change that accepts
`orb-step --socket` and implements the authenticated relay client. Current
main's stdin/stdout worker cannot satisfy that interface.

The independent security review passed before this alignment and hardening round;
that verdict does not cover this new patch. Live Linux acceptance remains required
before delivery of PR #2341. This macOS worktree run does not exercise Linux nspawn mounts, polkit or root host provisioning.

Per-machine runtime settings remain
under `/run` until reboot. Unrelated administrative actions retain their
existing authentication policy for named targets; unscoped machine-management
actions receive no grant. Image builds use an exclusive lock and preserve
staging trees with active or unreadable mounts.
