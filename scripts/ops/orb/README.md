# Orb host provisioning

Owner install command, from the repository checkout on the Linux host:

```sh
sudo bash scripts/ops/orb/install-host.sh
```

Preview every privileged step without changing the host:

```sh
bash scripts/ops/orb/install-host.sh --dry-run
```

Run the installer twice; the second successful run must print `0 changes`.
As `ian`, run the exact post-install check command:

```sh
scripts/ops/orb/orb-host-check.sh --json
```

A passing result exits zero and contains `image: "cairn-orb-base"`,
`cloneStartStop: "ok"`, `egress: "ok"`, `memoryMax: 4294967296`,
`homeVisible: false`, `negativeControl: "denied"`, `privateEgress: "denied"`,
and `firewall: "present"`. Save the actual host
output to `docs/verify/2273/host-check.json` after installation. Local fixtures
are not host acceptance evidence. The check creates and cleans up a unique
`cairn-orb-check-*` container and refuses password prompts.

## Failure modes and local verification

- Missing or partial images, invalid CLI pins, and Node below 22.19 fail closed.
- Polkit evaluates both clone source and destination; other users, unnamed
  actions, unrelated units, and nonmatching names receive no grant.
- Resource limits, private users, proxy configuration, and host-path isolation
  must survive cloning and starting any `cairn-orb-*` instance.
- NetworkManager keeps physical interfaces; networkd only manages container
  links. The relay binds the container bridge only. No direct routing is enabled.
- Dry runs perform no mutations. Completed installs converge to zero changes;
  failed steps are never recorded as completed.
- Missing images, authorization denial, failed execution, failed cleanup, broken
  proxy egress, visible host homes, and incorrect limits cannot produce success.

Local Node tests use only built-ins, recorded command-output fixtures, a fake
polkit object, and stateful fake host commands. The owner must still verify
actual systemd, polkit, package installation, and proxy behavior on the host.

The host needs `nft`, `ip`, `nmcli`, systemd, and a Node executable available
through root's PATH or `ian`'s login shell. The installer copies that executable
to `/usr/local/lib/cairn-orb/node` for the relay, so a home-based Node install
works with the user unit's `ProtectHome=yes`. Binary content and mode converge
on reruns. Host CLI pins come from `claude
--version` and `codex --version` in that login shell. Corepack installs the
repository's exact pnpm version. Existing networkd-managed host links or earlier network configuration files
stop the installer before changes.
A completed base image is rebuilt when the recipe or pinned host CLI versions
change. The previous base survives failed builds and is replaced only after
the staging image is complete and unmounted. Unrecognized images are preserved
and stop installation. The rebuild is printed and counted; the next run prints
`0 changes`. Existing clones keep their original tools.

The proxy subnet is `10.203.0.0/24`, with the relay at `10.203.0.1:7890` on
`vz-cairn`. The subnet must be unused on the host. The container DHCP server
advertises no router or DNS server. The relay resolves names locally, checks
every returned address, then sends `CONNECT <checked-ip>:<port>` to the upstream
proxy at `127.0.0.1:7890`. IPv6 authorities use brackets. This pins the actual
connection without allowing the upstream to repeat DNS resolution. HTTP
absolute URIs use that same tunnel with an origin-form request and the destination
Host header; HTTPS retains the client TLS handshake and SNI.
NetworkManager ignores `ve-*`, `vz-*`, and nspawn's bridged `vb-*` slave links.
Networkd manages only `ve-*` and `vz-*`; nspawn attaches and raises its slaves.

Systemd does not expand instance-name prefixes when looking up drop-ins. A
shared start-preparation hook returns immediately for unrelated machines and
installs the trusted template under `/run/systemd/nspawn/<name>.nspawn` before
each matching start. It reads the requested limits drop-in and applies its
properties to that exact unit with `systemctl set-property --runtime`.
The polkit rule denies privileged bind and copy operations, including for
matching machines. Workspace transfer needs a separately scoped authorization
path; the existing real-smoke runner's bind operation is not authorized here.

The filtering relay uses Node built-ins and runs as the user unit, bound only
to the bridge IP and accepting only `10.203.0.0/24`. It refuses loopback, RFC1918,
link-local, CGNAT (including the tailnet), multicast, unspecified addresses,
IPv6 ULA and IPv4-mapped equivalents, including mixed public/private DNS
answers. It caps request and upstream response headers at 16 KiB, idle time
at 30 seconds, concurrent clients at 128 and unit tasks at 256.

The installer prints and installs its own `inet cairn_orb` nftables table.
Only container-subnet TCP/7890 to the bridge and DHCP client UDP/68 to server
UDP/67 reach host input; all other input and forwarding from `vz-cairn` drop.
DHCP replies originate on the host output path. The transaction flushes only
this owned table and recreates its rules, leaving existing host tables intact.
The enabled `cairn-orb-firewall.service` restores it before networkd at reboot;
networkd and nspawn require that service to succeed before starting. Guests
on the shared bridge can still communicate at layer 2.

The host check runs read-only `nft list table inet cairn_orb`. If the host
requires root for that read, it reports `firewall: "owner-check-required"` and
`ok: false`; the owner must separately run `sudo nft list table inet cairn_orb`
and verify the input and forward rules above. This is an owner-run acceptance
check, not permission for the agent to use sudo. The guest negative checks
explicitly bypass NO_PROXY and require HTTP 403 for both `127.0.0.1:8787` and
`10.203.0.1:8787`; connectivity errors cannot count as successful filtering.

The polkit transient-unit protection relies on the installed
`systemd-nspawn@.service` template existing: systemd must load that template
instead of allowing a caller to supply an arbitrary transient unit definition.
Residual privileges include root execution inside matching `cairn-orb-*`
containers (mapped by `PrivateUsers=pick`), start/stop/restart of those units,
scoped kill/terminate/unregister and shell/login/PTY/inspection, and cloning
matching images or removing matching images except `cairn-orb-base`. Clones
may use the base as a source; they cannot replace or remove it. The rule grants
no `open_root_directory`, `poweroff` or `reboot` machine-management verbs.

Per-machine runtime settings remain
under `/run` until reboot. Unrelated administrative actions retain their
existing authentication policy for named targets; unscoped machine-management
actions receive no grant. Image builds use an exclusive lock and preserve
staging trees with active or unreadable mounts.
