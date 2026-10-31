#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
dry_run=false
if [[ $# == 1 && $1 == --dry-run ]]; then dry_run=true; elif [[ $# != 0 ]]; then printf 'Usage: build-image.sh [--dry-run]\n' >&2; exit 2; fi
if ! $dry_run && [[ $(id -u) != 0 ]]; then printf 'Run build-image.sh as root\n' >&2; exit 1; fi
host_root=${CAIRN_ORB_ROOT:-}
[[ -z $host_root || $host_root == /* ]] || { printf 'CAIRN_ORB_ROOT must be absolute\n' >&2; exit 2; }
image=$host_root/var/lib/machines/cairn-orb-base
if ! $dry_run; then
  lock_dir=$host_root/run/cairn-orb
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
pnpm_version=$(sed -n 's/.*"packageManager": "pnpm@\([0-9.]*\)".*/\1/p' "$script_dir/../../../package.json")
[[ $pnpm_version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { printf 'Cannot pin pnpm version\n' >&2; exit 1; }
recipe=$(sha256sum "$script_dir/build-image.sh" | awk '{print $1}')
expected=$(printf 'recipe=%s\nclaude=%s\ncodex=%s\npnpm=%s' "$recipe" "$claude_version" "$codex_version" "$pnpm_version")
if [[ -d $image ]]; then
  if [[ -f $image/etc/cairn-orb-image && $(cat "$image/etc/cairn-orb-image") == "$expected" ]]; then
    machinectl list-images --no-legend --no-pager | awk '$1 == "cairn-orb-base" {found=1} END {exit !found}'
    printf '0 changes\n'
    exit 0
  fi
  printf 'Existing base image does not match the recipe; preserve it and resolve explicitly\n' >&2
  exit 1
fi
printf 'build cairn-orb-base with pacstrap: base git nodejs npm corepack openssh ca-certificates curl\n'
printf 'pin @anthropic-ai/claude-code@%s @openai/codex@%s pnpm@%s; create agent; install proxy settings; register image\n' "$claude_version" "$codex_version" "$pnpm_version"
printf '%s\n' \
  'create a locked staging image under /var/lib/machines' \
  'enable Corepack shims and install pinned pnpm in /usr/local/lib/corepack' \
  'install pinned CLI packages with npm lifecycle scripts disabled' \
  'create unprivileged agent user and validate its CLI versions' \
  'lock root login and mask SSH server units' \
  'enable guest systemd-networkd' \
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
  local targets target
  if ! targets=$(findmnt --raw --noheadings --output TARGET); then
    printf 'Cannot inspect mounts; preserve image %s\n' "$stage" >&2
    return 1
  fi
  while IFS= read -r target; do
    case "$target" in
      "$stage"|"$stage"/*) printf 'Preserve mounted image %s; unmount it before removal\n' "$stage" >&2; return 1;;
    esac
  done <<< "$targets"
}
cleanup() {
  if [[ -n ${stage:-} && -d $stage ]]; then
    unmounted || return 1
    printf 'remove incomplete image %s\n' "$stage"; rm -rf -- "$stage"; fi
}
trap cleanup EXIT
pacstrap -K -M "$stage" base git nodejs npm corepack openssh ca-certificates curl
printf 'configure image and pinned tools\n'
arch-chroot "$stage" /usr/bin/env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/bin HOME=/root HTTP_PROXY="$HTTP_PROXY" HTTPS_PROXY="$HTTPS_PROXY" http_proxy="$http_proxy" https_proxy="$https_proxy" bash -s -- "$claude_version" "$codex_version" "$pnpm_version" <<'GUEST'
set -euo pipefail
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 19)) process.exit(1)'
export COREPACK_HOME=/usr/local/lib/corepack
corepack enable
corepack install --global "pnpm@$3"
npm install --global --ignore-scripts --no-audit --no-fund "@anthropic-ai/claude-code@$1" "@openai/codex@$2"
useradd --create-home --shell /bin/bash agent
[[ $(runuser -u agent -- claude --version | awk 'NR == 1 {print $1}') == "$1" ]]
[[ $(runuser -u agent -- codex --version | awk 'NR == 1 {print $NF}') == "$2" ]]
[[ $(pnpm --version) == "$3" ]]
chmod -R a+rX "$COREPACK_HOME"
[[ $(runuser -u agent -- env COREPACK_HOME=/usr/local/lib/corepack pnpm --version) == "$3" ]]
passwd --lock root
systemctl disable sshd.service sshd.socket || true
systemctl mask sshd.service sshd.socket
systemctl enable systemd-networkd.service
install -d /etc/systemd/system.conf.d
printf '[Manager]\nDefaultEnvironment="COREPACK_HOME=/usr/local/lib/corepack" "HTTP_PROXY=http://10.203.0.1:7890" "HTTPS_PROXY=http://10.203.0.1:7890" "http_proxy=http://10.203.0.1:7890" "https_proxy=http://10.203.0.1:7890" "NO_PROXY=localhost,127.0.0.1,::1" "no_proxy=localhost,127.0.0.1,::1"\n' > /etc/systemd/system.conf.d/20-cairn-orb-proxy.conf
printf 'COREPACK_HOME=/usr/local/lib/corepack\nHTTP_PROXY=http://10.203.0.1:7890\nHTTPS_PROXY=http://10.203.0.1:7890\nhttp_proxy=http://10.203.0.1:7890\nhttps_proxy=http://10.203.0.1:7890\nNO_PROXY=localhost,127.0.0.1,::1\nno_proxy=localhost,127.0.0.1,::1\n' > /etc/environment
printf 'export COREPACK_HOME=/usr/local/lib/corepack HTTP_PROXY=http://10.203.0.1:7890 HTTPS_PROXY=http://10.203.0.1:7890 http_proxy=http://10.203.0.1:7890 https_proxy=http://10.203.0.1:7890 NO_PROXY=localhost,127.0.0.1,::1 no_proxy=localhost,127.0.0.1,::1\n' > /etc/profile.d/cairn-orb-proxy.sh
rm -rf /root/.npm /root/.cache /etc/ssh/ssh_host_*
: > /etc/machine-id
GUEST
printf '%s\n' "$expected" > "$stage/etc/cairn-orb-image"
unmounted
[[ ! -e $image ]] || { printf 'Another image appeared; preserve the existing base\n' >&2; exit 1; }
printf 'register %s\n' "$image"
mv -T -- "$stage" "$image"
stage=
machinectl list-images --no-legend --no-pager | awk '$1 == "cairn-orb-base" {found=1} END {exit !found}'
printf '1 changes\n'
