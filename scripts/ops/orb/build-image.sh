#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
dry_run=false
if [[ $# == 1 && $1 == --dry-run ]]; then dry_run=true; elif [[ $# != 0 ]]; then printf 'Usage: build-image.sh [--dry-run]\n' >&2; exit 2; fi
if ! $dry_run && [[ $(id -u) != 0 ]]; then printf 'Run build-image.sh as root\n' >&2; exit 1; fi
host_root=${CAIRN_ORB_ROOT:-}
[[ -z $host_root || $host_root == /* ]] || { printf 'CAIRN_ORB_ROOT must be absolute\n' >&2; exit 2; }
daemon_entry=/opt/cairn/daemon/cli.mjs
agent_uid=$(id -u ian)
[[ $agent_uid =~ ^[0-9]+$ && $agent_uid -gt 0 && $agent_uid -lt 65534 ]] || { printf 'Cannot map ian to guest agent UID\n' >&2; exit 1; }
image=$host_root/var/lib/machines/cairn-orb-base
if ! $dry_run; then
  lock_dir=$host_root/run/lock/cairn-orb
  if [[ ! -d $lock_dir ]]; then printf 'create %s mode 700\n' "$lock_dir"; install -d -m 700 "$lock_dir"; fi
  if [[ ! -e $lock_dir/build.lock ]]; then printf 'create %s/build.lock\n' "$lock_dir"; fi
  exec 9>>"$lock_dir/build.lock"
  flock -n 9 || { printf 'Another image build holds the lock\n' >&2; exit 1; }
fi
host_version() {
  if [[ $(id -un) == ian ]]; then
    bash -lc "$1 --version"
  else
    runuser -u ian -- bash -lc "$1 --version"
  fi
}
claude_version=$(host_version claude | awk 'NR == 1 {print $1}')
codex_version=$(host_version codex | awk 'NR == 1 {print $NF}')
[[ $claude_version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && $codex_version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { printf 'Cannot pin host Claude Code and Codex versions\n' >&2; exit 1; }
daemon_args=(bash -lc 'export XDG_RUNTIME_DIR=/run/user/$(id -u); node "$1" "$2"' cairn-orb "$script_dir/daemon-package.mjs" "${CAIRN_ORB_NODE_MAJOR:-}")
if [[ $(id -un) == ian ]]; then
  node_major=$("${daemon_args[@]}")
else
  node_major=$(runuser -u ian -- "${daemon_args[@]}")
fi
[[ $node_major =~ ^[1-9][0-9]*$ && $node_major -ge 22 ]] || { printf 'Cannot pin host daemon Node major; set CAIRN_ORB_NODE_MAJOR\n' >&2; exit 1; }
recipe=$(cat "$script_dir/build-image.sh" "$script_dir/guest-check.mjs" "$script_dir/daemon-package.mjs" | sha256sum | awk '{print $1}')
expected=$(printf 'recipe=%s\nclaude=%s\ncodex=%s\nnode_major=%s\nagent_uid=%s' "$recipe" "$claude_version" "$codex_version" "$node_major" "$agent_uid")
previous_marker=
if [[ -d $image ]]; then
  if [[ -f $image/etc/cairn-orb-image && $(cat "$image/etc/cairn-orb-image") == "$expected" ]]; then
    machinectl list-images --no-legend --no-pager | awk '$1 == "cairn-orb-base" {found=1} END {exit !found}'
    printf '0 changes\n'
    exit 0
  fi
  current_marker_pattern='^recipe=[a-zA-Z0-9-]+
claude=[0-9]+\.[0-9]+\.[0-9]+
codex=[0-9]+\.[0-9]+\.[0-9]+
node_major=[1-9][0-9]*
agent_uid=[0-9]+$'
  legacy_marker_pattern='^recipe=[a-zA-Z0-9-]+
claude=[0-9]+\.[0-9]+\.[0-9]+
codex=[0-9]+\.[0-9]+\.[0-9]+
pnpm=[0-9]+\.[0-9]+\.[0-9]+(
agent_uid=[0-9]+)?(
daemon_package=(@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*
daemon=[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?)?$'
  if [[ ! -f $image/etc/cairn-orb-image ]] || ! { [[ $(cat "$image/etc/cairn-orb-image") =~ $current_marker_pattern ]] || [[ $(cat "$image/etc/cairn-orb-image") =~ $legacy_marker_pattern ]]; }; then
    printf 'Unrecognized existing base image; preserve it and resolve explicitly\n' >&2
    exit 1
  fi
  previous_marker=$(cat "$image/etc/cairn-orb-image")
  printf 'rebuild cairn-orb-base: recipe or pinned Node/CLI versions changed\n'
fi
printf 'build cairn-orb-base with pacstrap: base git nodejs npm openssh ca-certificates curl\n'
printf 'pin Node major %s @anthropic-ai/claude-code@%s @openai/codex@%s; create agent; install proxy settings; register image\n' "$node_major" "$claude_version" "$codex_version"
printf '%s\n' \
  'create a locked staging image under /var/lib/machines' \
  'install pinned CLI packages with npm lifecycle scripts disabled' \
  'create unprivileged agent user and validate its CLI versions' \
  'lock root login and mask SSH server units' \
  'enable guest systemd-networkd' \
  'install and enable cairn-orb-worker.service, cairn-orb-check.service and cairn-orb-check.path' \
  'map host ian UID to guest agent for private fixed idmapped binds' \
  'write /etc/systemd/system.conf.d/20-cairn-orb-proxy.conf' \
  'write /etc/environment and /etc/profile.d/cairn-orb-proxy.sh' \
  'remove guest package caches and SSH host keys; clear /etc/machine-id' \
  'write /etc/cairn-orb-image completion marker' \
  'register the completed image only after mounts are gone'
if $dry_run; then printf '1 planned changes\n'; exit 0; fi
export HTTP_PROXY=${HTTP_PROXY:-http://127.0.0.1:7890}
export HTTPS_PROXY=${HTTPS_PROXY:-$HTTP_PROXY}
export http_proxy=$HTTP_PROXY https_proxy=$HTTPS_PROXY
printf 'create /var/lib/machines and temporary image\n'
install -d -m 755 "$host_root/var/lib/machines"
stage=$(mktemp -d "$host_root/var/lib/machines/.cairn-orb-build.XXXXXX")
stage=$(cd -- "$stage" && pwd -P)
[[ $stage =~ ^/[a-zA-Z0-9/._-]+$ ]] || { printf 'Preserve image at unsupported path: %s\n' "$stage" >&2; exit 1; }
unmounted() {
  local targets target tree=${1:-$stage}
  if ! targets=$(findmnt --raw --noheadings --output TARGET); then
    printf 'Cannot inspect mounts; preserve image %s\n' "$stage" >&2
    return 1
  fi
  while IFS= read -r target; do
    case "$target" in
      "$tree"|"$tree"/*) printf 'Preserve mounted image %s; unmount it before removal\n' "$tree" >&2; return 1;;
    esac
  done <<< "$targets"
}
cleanup() {
  if [[ -n ${stage:-} && -d $stage ]]; then
    unmounted || return 1
    printf 'remove incomplete image %s\n' "$stage"; rm -rf -- "$stage"; fi
}
trap cleanup EXIT
pacstrap -K -M "$stage" base git nodejs npm openssh ca-certificates curl
printf 'configure image and pinned tools\n'
arch-chroot "$stage" /usr/bin/env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/bin HOME=/root HTTP_PROXY="$HTTP_PROXY" HTTPS_PROXY="$HTTPS_PROXY" http_proxy="$http_proxy" https_proxy="$https_proxy" bash -s -- "$claude_version" "$codex_version" "$agent_uid" "$daemon_entry" "$node_major" <<'GUEST'
set -euo pipefail
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); const expected = Number(process.argv[1]); if (major !== expected || major < 22 || (major === 22 && minor < 19)) { console.error(`Guest Node ${process.versions.node} must match host daemon Node major ${expected} and be >=22.19; install a compatible guest nodejs package before retrying`); process.exit(1); }' "$5"
npm install --global --ignore-scripts --no-audit --no-fund "@anthropic-ai/claude-code@$1" "@openai/codex@$2"
useradd --uid "$3" --create-home --shell /bin/bash agent
[[ $(runuser -u agent -- claude --version | awk 'NR == 1 {print $1}') == "$1" ]]
[[ $(runuser -u agent -- codex --version | awk 'NR == 1 {print $NF}') == "$2" ]]
passwd --lock root
systemctl disable sshd.service sshd.socket || true
systemctl mask sshd.service sshd.socket
systemctl enable systemd-networkd.service
install -d /etc/systemd/system.conf.d
printf '[Manager]\nDefaultEnvironment="HTTP_PROXY=http://10.203.0.1:7890" "HTTPS_PROXY=http://10.203.0.1:7890" "http_proxy=http://10.203.0.1:7890" "https_proxy=http://10.203.0.1:7890" "NO_PROXY=localhost,127.0.0.1,::1" "no_proxy=localhost,127.0.0.1,::1"\n' > /etc/systemd/system.conf.d/20-cairn-orb-proxy.conf
printf 'HTTP_PROXY=http://10.203.0.1:7890\nHTTPS_PROXY=http://10.203.0.1:7890\nhttp_proxy=http://10.203.0.1:7890\nhttps_proxy=http://10.203.0.1:7890\nNO_PROXY=localhost,127.0.0.1,::1\nno_proxy=localhost,127.0.0.1,::1\n' > /etc/environment
printf 'export HTTP_PROXY=http://10.203.0.1:7890 HTTPS_PROXY=http://10.203.0.1:7890 http_proxy=http://10.203.0.1:7890 https_proxy=http://10.203.0.1:7890 NO_PROXY=localhost,127.0.0.1,::1 no_proxy=localhost,127.0.0.1,::1\n' > /etc/profile.d/cairn-orb-proxy.sh
install -d /usr/local/lib/cairn-orb /etc/systemd/system
cat > /etc/systemd/system/cairn-orb-worker.service <<WORKER
[Unit]
Description=Cairn Orb worker
After=local-fs.target
StartLimitIntervalSec=0

[Service]
User=agent
Environment=CAIRN_ORB=1
Restart=always
RestartSec=1
ExecStartPre=/bin/sh -c 'while [ ! -S /run/cairn/relay.sock ]; do sleep 1; done'
TimeoutStartSec=infinity
ExecStart=/usr/bin/node $4 orb-step --socket /run/cairn/relay.sock
UMask=0077

[Install]
WantedBy=multi-user.target
WORKER
cat > /etc/systemd/system/cairn-orb-check.service <<'CHECK'
[Unit]
Description=Cairn Orb metadata probes
After=local-fs.target network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=agent
ExecStart=/usr/bin/node /usr/local/lib/cairn-orb/guest-check.mjs
TimeoutStartSec=120
UMask=0077
CHECK
cat > /etc/systemd/system/cairn-orb-check.path <<'CHECKPATH'
[Unit]
Description=Cairn Orb check trigger
After=local-fs.target

[Path]
PathExists=/run/cairn/check-request
Unit=cairn-orb-check.service

[Install]
WantedBy=multi-user.target
CHECKPATH
systemctl enable cairn-orb-worker.service cairn-orb-check.path
rm -rf /root/.npm /root/.cache /etc/ssh/ssh_host_*
: > /etc/machine-id
GUEST
install -D -m 644 "$script_dir/guest-check.mjs" "$stage/usr/local/lib/cairn-orb/guest-check.mjs"
printf '%s\n' "$expected" > "$stage/etc/cairn-orb-image"
unmounted
backup=
if [[ -e $image ]]; then
  if [[ -z $previous_marker || ! -f $image/etc/cairn-orb-image || $(cat "$image/etc/cairn-orb-image") != "$previous_marker" ]]; then
    printf 'Another image appeared or changed; preserve the existing base\n' >&2
    exit 1
  fi
  unmounted "$image"
  backup=$(mktemp -d "$host_root/var/lib/machines/.cairn-orb-previous.XXXXXX")
  rmdir -- "$backup"
  printf 'preserve previous base at %s until replacement is registered\n' "$backup"
  mv -T -- "$image" "$backup"
fi
printf 'register %s\n' "$image"
if ! mv -T -- "$stage" "$image"; then
  if [[ -n $backup ]]; then printf 'restore previous base\n'; mv -T -- "$backup" "$image"; fi
  exit 1
fi
stage=
if [[ -n $backup ]]; then
  unmounted "$backup"
  printf 'remove previous base %s\n' "$backup"
  rm -rf -- "$backup"
fi
machinectl list-images --no-legend --no-pager | awk '$1 == "cairn-orb-base" {found=1} END {exit !found}'
printf '1 changes\n'
