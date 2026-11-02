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
`firewall: "ok"`, `ufw: "ok"` (or `"inactive"`), `foreignRules: "ok"` (or `"no-tun"`),
and `networkReady: true`,
with `ok: true` and an empty `errors` array. Save the actual host output to `docs/verify/2273/host-check.json` after installation. Local fixtures
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

On btrfs, detected with `stat -f -c %T`, the builder creates the staging image
with `btrfs subvolume create` and publishes that subvolume as `cairn-orb-base`.
`machinectl clone` can then snapshot the base for each Thread instead of
recursively copying a directory image. The builder detects subvolumes from their
host inode number, so a directory base on btrfs is reported as image-type drift
and rebuilt once even when its completion marker matches. Non-btrfs hosts retain
directory images. Replacement keeps the previous base until publication succeeds
and restores it if publication fails. Staging and previous subvolumes are removed
with `btrfs subvolume delete`; directory images use recursive removal. Mounted
images remain preserved.

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

The installer writes root-owned, mode `0644`
`/etc/systemd/networkd.conf.d/10-cairn-keep-foreign.conf` before enabling,
starting, reloading or restarting networkd:

```ini
[Network]
ManageForeignRoutingPolicyRules=no
ManageForeignRoutes=no
```

Networkd's default foreign-rule management can delete policy rules installed by
another service even when its tun interface is unmanaged. On a host with a tun
proxy, this can bypass the proxy for traffic without HTTP(S) proxy settings and
send DNS to the router. Foreign routes and rules must remain unmanaged so
sing-box retains its `sbtun0` rules for table `2022`. If this file is created or
changed while networkd is active, the installer prints and counts a networkd
restart to load the global settings. An unchanged rerun does not restart it;
`--dry-run` prints the plan without changing files or services.

The unprivileged host check reads `/etc/systemd/networkd.conf` and sorted `.conf`
drop-ins under `/etc/systemd/networkd.conf.d`. Equivalent settings there are
accepted, with later assignments taking precedence. Active networkd without
`ManageForeignRoutingPolicyRules=no` reports `foreignRules: "managed"` and a
named error. If `sbtun0` exists, `ip rule show` must include both `lookup 2022`
and `iif sbtun0`; otherwise the check reports `foreignRules: "lost"` and
`sing-box tun policy rules (table 2022) are missing; restart sing-box`.
Healthy tun rules report `"ok"`; a host without `sbtun0` reports `"no-tun"`.
Both `"managed"` and `"lost"` make the overall check fail. Changing the networkd
settings prevents future deletion; it does not restore rules already lost.

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
pnpm --dir <checkout> deploy --filter @xiechimon/cairn-cli --prod --prefer-offline <tmp>
```

Deployment has a 600-second timeout, reported as `Orb pnpm deploy timed out after
600 seconds` on abort. Stores and release directories on different filesystems
require copying production dependencies instead of hardlinking them; the longer
budget accommodates these copies under load. A deploy failure must produce a
clear error, never an npm fallback.
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

When `systemctl is-active ufw` succeeds, the installer reads
`/etc/ufw/user.rules` and adds only missing scoped input rules with the root ufw CLI:

```sh
ufw allow in on vz-cairn proto udp from any port 68 to any port 67 comment cairn-orb-dhcp
ufw allow in on vz-cairn proto tcp from 10.203.0.0/24 to 10.203.0.1 port 7890 comment cairn-orb-relay
```

Each addition is printed and counted; reruns print `0 changes`. Inactive or
absent ufw is untouched, and `--dry-run` prints planned commands without running
ufw. No route or forwarding rules are added; forwarding stays off. An accept in
`inet cairn_orb` cannot override a drop in ufw's separate iptables-nft tables.
The unprivileged host check reads the same rules file when ufw is active and
requires both scoped accepts. Missing or unreadable rules produce
`ufw: "missing-rules"`, `ok: false`, and
`ufw is active without the cairn-orb DHCP and relay rules; rerun install-host.sh`.
Otherwise it reports `ufw: "ok"`, or `ufw: "inactive"` when ufw is inactive or absent.

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

The clone subprocess has a 600-second timeout. After any clone failure or
timeout, the checker lists images and removes a leftover matching the exact check
machine name before returning a named clone error. A missing image needs no
removal; listing or removal errors also appear in `errors`.

After start, the checker waits at most 30 polls for the root-prepared private
runtime directory and writes a request ID and blocked-port list to `check-request`.
The image's enabled
`cairn-orb-check.path` detects that file. Before any connectivity probe, the guest
polls `ip -4 -o addr show dev host0` every second for up to 120 seconds, waiting
for a non-link-local IPv4 address. Under load, networkd may start late. A guest
with only a link-local (`169.254.*`) address means DHCP was dropped; inspect
ufw's scoped DHCP rule. A timeout records `networkReady: false` and still runs
all probes. The guest check service has a 240-second start timeout to cover both
the wait and probes. The guest writes network readiness, `networkWaitMs`, `ipv4` (address
only, or null on timeout), exit statuses, HTTP status codes, port numbers and
request ID to an atomically published `check-result.json`, then removes the trigger. No response bodies, headers,
stderr, credentials or tool output are returned. The host waits at most 240
one-second polls for the result, covering the network wait and probes. It rejects
symlinks, oversized/nonregular files, stale IDs and unexpected fields, then powers off the clone. It polls machine listing for at most 30
attempts, requests terminate after 15, and removes the clone only once it is
absent. Root `ExecStopPost` owns runtime cleanup; the checker waits at most 30
polls for it and reports missing cleanup as a failure. A still-running machine
keeps its runtime directory.
No `systemd-run -M`, `--machine` guest transport, or `machinectl bind/shell/login`
is used. The template's `systemd-nspawn --machine=<name>` only names a new
container; the installer addresses the host user manager through `runuser`.

The `--json` result has `image` (base-image name or null), `cloneStartStop`
(`ok` or `failed`), `egress` (`ok` or `failed`), `privateEgress` (`denied` or
`failed`), `firewall` (`ok` or `failed`), `ufw` (`ok`, `inactive` or
`missing-rules`), `foreignRules` (`ok`, `managed`, `lost` or `no-tun`),
`networkReady` (boolean), `networkWaitMs` (milliseconds or null),
`ipv4` (address only or null), `memoryMax` (bytes or null),
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

## Separate trial daemon

The trial uses a second user unit from the main checkout. Install it as the
checkout owner after the normal daemon deployment has produced `apps/daemon/dist`:

```sh
systemctl --user link "$HOME/Code/AgentProjects/cairn/scripts/ops/systemd/cairn-daemon-orb.service"
systemctl --user daemon-reload
systemctl --user enable --now cairn-daemon-orb.service
journalctl --user -u cairn-daemon-orb.service -f
```

Ensure the user manager's PATH resolves the same Node executable used by the
production daemon. If needed, add a drop-in with that executable's directory in
PATH before starting the trial unit. Do not edit the production unit.

The daemon does not yet drive the browser enrollment itself (#2530). Start an
enrollment with `POST /api/machine/enroll/start` and the name `omarchy-orb`,
have a team owner approve it on the web authorize page, then let a poller of
`POST /api/machine/enroll/poll` write the returned machine record to
`%h/.cairn-orb-daemon/machine.json` (mode 0600) before starting the unit. Never
copy production credentials. Enable `claude-code` on the machine, bind the
active `orb-builder` agent to it, and add `orb-builder` to the server's
`CAIRN_INTAKE_AGENT_ALLOWLIST`. Transfer the chosen issue with
`node scripts/ops/transfer-to-cairn.mjs <issue> --agent orb-builder`; see
`scripts/ops/transfer-to-cairn.README.md` for its ownership checks and the
append-only `never` entry it writes.

The normal `deploy-self.sh` deployment also stops and starts
`cairn-daemon-orb.service` when that unit is enabled, so both daemons reload the
rebuilt checkout during deployment and rollback.

`CAIRN_EXECUTOR=orb` selects Orb execution. `CAIRN_HOME` and
`CAIRN_WORKSPACES_DIR` keep `machine.json`, the outbox, and workspaces beneath
`%h/.cairn-orb-daemon`, separate from the default `%h/.cairn` state. The machine
name comes from `--name omarchy-orb`. The server remains
`http://127.0.0.1:8787`. The production `cairn-daemon.service` is untouched.
Do not inherit a production `CAIRN_API_KEY` or `CAIRN_TEAM` in this user unit;
use the authorize URL for the separate enrollment.

Record live acceptance using [the trial evidence template](../../../docs/verify/b2-trial-one/README.md).
Local fake tests do not establish Linux enrollment or Orb execution.

## Secret isolation canary (#2277)

From the normally built, matching Linux checkout on omarchy, as `ian` without
sudo, run this single command:

```sh
scripts/ops/orb/canary.sh --json --out docs/verify/2277/canary.json
```

Use Node 22.19+ with the guest's Node major, installed checkout dependencies
(including the native SQLite binding), `git`, `tailscale`, and the existing daemon build at
`apps/daemon/dist/cli.mjs`. The checkout must be built at the same commit as the
published release. The canary computes the exact publisher key, including dist
bytes and dirty checkout contents, and compares it with
`/var/lib/cairn-orb/dist/current.json` before starting the scratch stack.
`CanaryReleaseMismatchError` refuses a different build without changing shared
`current`; publish the operator's intended checkout first if they differ.
The canary performs no installation or build. It first
runs the real `orb-host-check` detection, including its disposable clone and
cleanup in a separate terminal signal group. Repeated SIGINT/SIGTERM/SIGHUP signals
only request cancellation and cannot bypass cleanup. Missing prerequisites refuse the run before planting sentinels. If
interrupted during that check, it waits for the check's own cleanup before
honoring the interruption. The output path must be new; an existing evidence
file is never overwritten. Omitting `--out` prints JSON without writing evidence.

The script starts a token-protected scratch server on a free loopback port and
enrolls a scratch daemon with a machine-only API key through the normal
non-interactive CLI path. Both use fresh temporary `CAIRN_HOME` directories and
a separate OS home, MCP configuration and skills directory. No credentials or
application settings are inherited from the owner's environment. Each executor
gets a separate local bare repository and Project on that same scratch server.
The scratch setup selects Project and step IDs accepted by the current Orb
validators; rejected pending steps are canceled before the daemon restarts.
Production server and daemon state are never opened for writing. The scratch
daemon sets `CAIRN_ORB_RETAIN_RELEASES=1`, which disables release pruning for
this publisher so it cannot delete a production Thread's older release.

The Project's executable `.agents/setup` runs the attacker inside the real
runner's workspace. For an Orb, `runOrbStep` starts the real nspawn provider,
authenticated relay and guest worker, which calls `runStep`. Hook output is
forwarded into the server transcript with `HOOK_OUTPUT_CHAR_LIMIT = 100000`.
The attacker also writes `canary-result.json`; the host reads it from the
actually delivered branch and requires it to match the server's hook note.
This detects a missing hook note, truncated result, failed model turn or missing
push instead of treating an incomplete run as isolation evidence.

After probing, the hook starts a tiny OpenAI-compatible streaming model server
on guest loopback and waits for its readiness over IPC. It uses only Node
built-ins. The actual Pi backend consumes one text response, and the runner's
normal automatic commit and push deliver the hook's changes. No model tool call
is needed to reach push. The existing `test/fakes/scripted-model.ts` is an
in-process backend fake coupled to Vitest, so it cannot run as a guest HTTP
server; the canary uses the SSE response shape from the integration stub instead.
`NO_PROXY` keeps the model request on loopback. The model exits after responding,
or when its daemon parent exits, with a ten-minute upper bound.

The three routes cover:

- Direct reads of every sentinel, metadata-only reachability of every real path,
  and `/proc/1/root` aliases of both. Enumeration of the actual host home must
  fail. `$HOME` enumeration records whether host sentinel names are visible;
  enumerating the guest's own home is expected and is not a host leak.
- Workspace symlinks to every target and attempted copies of the new sentinels.
  Real secret paths are only `stat`ed through the symlinks: copying their actual
  contents would violate the requirement to keep real keys unread. The runner
  commits and pushes the symlinks, copied sentinels and JSON through real local
  bundle delivery. The host streams `git log -p --binary` and
  `git cat-file --batch-all-objects --batch` over the scratch repository, checking
  every random marker, including intermediate, deleted and packed objects.
- A Node Unix-socket connect to `/var/run/docker.sock`, plus TCP connects to
  canary-owned listeners on loopback, bridge `10.203.0.1`, and the discovered
  tailnet address, all using a separate free control port. One TCP control
  listener binds `0.0.0.0` and accepts a loopback connection before probing; the
  token-protected scratch API remains on its own loopback port. Wildcard binding
  works while the host is idle: `vz-cairn` and `10.203.0.1` exist only while an
  Orb runs, so binding that bridge address before startup fails with
  `EADDRNOTAVAIL`. The listener accepts no application requests and closes each
  connection. The host runner's negative control must connect through loopback
  and the tailnet address; it does not require the bridge address after the Orb
  stops. Missing, refused or duplicate required controls fail the result. The
  Orb's bridge and tailnet probes count any connect failure as blocked, because the
  host control proves the wildcard listener live; only a completed connect is a leak.
  The separate
  `127.0.0.1:8787` row explicitly identifies the Orb's own loopback in `detail`;
  it makes no claim about a host production listener. The loopback control
  detects a shared host network namespace. Each HTTP target is also
  attempted with an explicit CONNECT through `HTTP_PROXY`, bypassing `NO_PROXY`.
  Proxy attempts require HTTP 403; missing proxies and unexpected responses
  fail the canary. The host tailnet address comes from `tailscale ip -4` and
  is reported only as `tailnet-server`.

In that same Orb run, `git ls-remote https://github.com/xiechimon/cairn.git HEAD`
must succeed through the egress proxy. `githubReach: {ok, ms}` is a positive
control for GitHub HTTPS, independent of the denied private destinations. The
same attacker then runs with `CAIRN_EXECUTOR=host` through the real host runner
on the same scratch server. Its negative control must read at least one exact
sentinel marker. The same object scanner must also find a marker in that host
control's delivered repository and branch (`negativeObjectsContainMarker: true`).
A marker claim in the hook result alone cannot pass. Its separate repository
intentionally contains synthetic leaked markers and is deleted during cleanup.

### Sentinel safety and evidence

The issue originally proposed replacing real secret paths and restoring backups.
This implementation deliberately creates only new random-named files:

```text
~/.cairn/.cairn-canary-<runid>-pem
~/.cairn/.cairn-canary-<runid>-key
~/.ssh/.cairn-canary-<runid>
~/.codex/.cairn-canary-<runid>
~/.claude/.cairn-canary-<runid>
```

The directories must already exist without symlinks. Exclusive creation refuses
existing files or symlinks with `wx`, creates each sentinel with mode `0600`,
rolls back partial planting, and cleanup checks each
created inode before unlinking it. Real files are never moved, renamed,
overwritten or backed up, so a crash can no longer strand real keys. Only the
new sentinel contents are read or copied. Real `~/.cairn/machine.json`, existing
`~/.cairn/*.pem`, optional `~/.cairn/secretbox.key`, `~/.ssh`,
`~/.codex/auth.json` and `~/.claude` are probed without reading their contents.
Neither hook output nor public evidence contains raw markers; sentinel entries
contain paths and SHA-256 hashes only. Public paths use `~`, and real PEM files
use indexed aliases such as `~/.cairn/1.pem`, including `/proc/1/root` aliases.
Failure JSON and leftover inventories also redact the real home and PEM names.
Only `ENOENT` counts as an absent file or directory. `EACCES` and `EPERM` report
`blocked: false` with `detail: "present-but-denied"`; `ENOTDIR` also fails closed.
The `/proc/1/root/...` alias has one exception: if reading `/proc/1/root` itself
returns `EACCES` or `EPERM`, or its link target is `/`, it does not identify a host
path. That alias records `blocked: true` with `detail: "proc1-root-not-host"`
without opening the path. Other readlink errors and all ordinary paths retain
the `ENOENT`-only rule.

`ok` and exit zero require complete, unique probe rows, every Orb target blocked,
clean Orb objects, a scanner-confirmed leaking host control, live host listeners
and successful GitHub reachability. Any failed prerequisite, runner, push, control, probe or cleanup
prevents success. The final directory scan requires no `.cairn-canary-*` entries;
leftovers set `ok: false`, exit nonzero, and appear in `sentinelsRemaining`.
Cleanup runs on failure, timeout and SIGINT/SIGTERM/SIGHUP, stops only owned
scratch processes, and removes only the newly allocated machine/image and
Project seed. Machine shutdown reuses `orb-host-check`'s cleanup helper, waits
for stop hooks, and refuses to remove a running machine. The production
provider's normal shared dist publisher is used; shared daemon releases are
retained by this publisher rather than pruned or deleted by the canary.

A private `~/.cairn/orb-canary-runs/<runid>.jsonl` manifest records the run PID and
created paths with device/inode identities, flushed before marker contents are
written. It also records each scratch server/daemon PID, entry, working directory
and OS start time synchronously immediately after spawn, before returning the
child or awaiting readiness, plus the exact Orb machine names and Project seed
paths before the daemon can create them. A recording error terminates the new
child. SIGKILL or power loss between the OS spawn and the completed synchronous
manifest write can still leave an unrecorded child; readiness checks do not
eliminate this window. The scratch directory is recorded with its
device/inode identity, and its allowed temporary-directory prefix is stored in
the header so recovery does not depend on the current `TMPDIR`. It contains no
raw markers. Successful cleanup removes the manifest; failed cleanup atomically
retains only failed resources and sentinel entries for retry. The shell wrapper
traps exit and forwards SIGINT/SIGTERM/SIGHUP to Node before waiting for cleanup.
After SIGKILL or a host restart, the next run recovers manifests whose owning process no longer exists.
To recover one stopped run explicitly without starting the stack:

```sh
scripts/ops/orb/canary.sh --cleanup <runid>
```

Recovery stops recorded children only after matching their start time, command
and working directory; a different start time means the recorded process is gone
and the reused PID is left untouched. An empty Linux cmdline means an already
exited zombie.
It then removes only recorded machines through `machine-cleanup.mjs`, waits for
their stop hooks, and removes recorded seeds and scratch directories. Cleanup
collects resource errors and always attempts every recorded sentinel removal,
even after a process or machine cleanup fails. Successful entries are removed
from the recovery inventory; only failures remain for retry. Tests simulate a
parent SIGKILL with a live detached child and cover both explicit cleanup and
the next-run sweep.
Recovery removes only recorded files whose identities still match. Active runs,
replaced files, symlinks and malformed manifests are preserved and refused.
Untracked sentinel names are reported by the final assertion and never removed
by a glob. Real keys remain in place.

Offline verification:

```sh
node --test scripts/ops/orb/*.test.mjs
```

The canary unit tests use fake homes, real temporary Git objects, local fake
proxy responses and injected network results. The scratch-stack test uses a
real server, non-interactive enrollment, host runner and Pi backend against a
local scripted model, with real-home and external-network probes disabled. It
proves the detector and delivery plumbing, not Linux isolation. Only the
coordinator's live `docs/verify/2277/canary.json` can establish nspawn, filesystem
and egress behavior on omarchy. The macOS backend-user canary remains outside
this item's scope.
