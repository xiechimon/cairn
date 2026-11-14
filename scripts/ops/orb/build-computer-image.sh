#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
dry_run=false
if [[ $# == 1 && $1 == --dry-run ]]; then dry_run=true; elif [[ $# != 0 ]]; then printf 'Usage: build-computer-image.sh [--dry-run]\n' >&2; exit 2; fi
if ! $dry_run && [[ $(id -u) != 0 ]]; then printf 'Run build-computer-image.sh as root\n' >&2; exit 1; fi
host_root=${CAIRN_ORB_ROOT:-}
[[ -z $host_root || $host_root == /* ]] || { printf 'CAIRN_ORB_ROOT must be absolute\n' >&2; exit 2; }
machines_dir=$host_root/var/lib/machines
base=$machines_dir/cairn-orb-base
image=$machines_dir/cairn-orb-computer
published_marker=$host_root/var/lib/cairn-orb/computer-image
daemon_entry=/opt/cairn/daemon/cli.mjs
packages=(xorg-server-xvfb x11vnc fluxbox xdotool chromium imagemagick npm wqy-microhei)
agent_browser_version=${CAIRN_AGENT_BROWSER_VERSION:-0.41.2}
if [[ ! -f $base/etc/cairn-orb-image ]]; then
  if $dry_run; then
    printf 'snapshot cairn-orb-base after cairn-orb-base is built, then install: %s\n1 planned changes\n' "${packages[*]}"
    exit 0
  fi
  printf 'Build cairn-orb-base first: %s has no completion marker\n' "$base" >&2
  exit 1
fi
base_marker=$(cat "$base/etc/cairn-orb-image")
node_major=$(sed -n 's/^node_major=\([1-9][0-9]*\)$/\1/p' <<< "$base_marker")
[[ $node_major =~ ^[1-9][0-9]*$ ]] || { printf 'cairn-orb-base marker has no Node major; rebuild the base\n' >&2; exit 1; }
recipe=$(cat "$script_dir/build-computer-image.sh" | sha256sum | awk '{print $1}')
expected=$(printf 'recipe=%s\npackages=%s\nagent-browser=%s\n%s' "$recipe" "${packages[*]}" "$agent_browser_version" "$(sed 's/^/base./' <<< "$base_marker")")
filesystem_path=$machines_dir
while [[ ! -d $filesystem_path ]]; do filesystem_path=$(dirname -- "$filesystem_path"); done
filesystem=$(stat -f -c %T -- "$filesystem_path")
image_type() {
  if [[ $filesystem == btrfs && $(stat -c %i -- "$1") == 256 ]]; then printf 'subvolume'; else printf 'directory'; fi
}
publish_marker() {
  local directory
  directory=$(dirname -- "$published_marker")
  [[ -d $directory ]] || install -d -m 755 -- "$directory"
  local staged
  staged=$(mktemp "$published_marker.XXXXXX")
  cat -- "$image/etc/cairn-orb-computer-image" > "$staged"
  chmod 644 "$staged"
  mv -f -T -- "$staged" "$published_marker"
}
remove_image() {
  if [[ $(image_type "$1") == subvolume ]]; then btrfs subvolume delete -R "$1"; else rm -rf -- "$1"; fi
}
if ! $dry_run; then
  lock_dir=$host_root/run/lock/cairn-orb
  [[ -d $lock_dir ]] || install -d -m 700 "$lock_dir"
  exec 9>>"$lock_dir/build.lock"
  flock -n 9 || { printf 'Another image build holds the lock\n' >&2; exit 1; }
fi
previous_marker=
if [[ -d $image ]]; then
  if [[ -f $image/etc/cairn-orb-computer-image && $(cat "$image/etc/cairn-orb-computer-image") == "$expected" ]]; then
    publish_marker
    printf '0 changes\n'
    exit 0
  fi
  if [[ ! -f $image/etc/cairn-orb-computer-image || ! $(cat "$image/etc/cairn-orb-computer-image") =~ ^recipe=[a-zA-Z0-9-]+$'\n'packages=[a-z0-9\ -]+$'\n'(agent-browser=[0-9.]+$'\n')?base\. ]]; then
    printf 'Unrecognized existing computer image; preserve it and resolve explicitly\n' >&2
    exit 1
  fi
  previous_marker=$(cat "$image/etc/cairn-orb-computer-image")
  printf 'rebuild cairn-orb-computer: recipe, packages or cairn-orb-base changed\n'
fi
printf '%s\n' \
  'snapshot cairn-orb-base into a locked staging image under /var/lib/machines' \
  "install with systemd-nspawn and the host mirrorlist read-only: pacman -Syu ${packages[*]}" \
  "refuse a guest Node major other than $node_major" \
  "install agent-browser@${agent_browser_version} without install scripts, mark its native binary executable, and run it as agent" \
  'install the Chromium managed policy and the cairn-computer-desktop service for agent' \
  'install the cairn-computer-agent service for agent after network-online, enable systemd-networkd-wait-online waiting for a routable IPv4 address, and disable the inherited cairn-orb-worker service' \
  'remove package caches; clear /etc/machine-id' \
  'write /etc/cairn-orb-computer-image completion marker' \
  'publish a world-readable copy of the marker at /var/lib/cairn-orb/computer-image for the daemon user' \
  'register cairn-orb-computer only after mounts are gone'
if $dry_run; then printf '1 planned changes\n'; exit 0; fi
stage=$(mktemp -d "$machines_dir/.cairn-orb-computer-build.XXXXXX")
stage=$(cd -- "$stage" && pwd -P)
[[ $stage =~ ^/[a-zA-Z0-9/._-]+$ ]] || { printf 'Preserve image at unsupported path: %s\n' "$stage" >&2; exit 1; }
unmounted() {
  local targets target tree=${1:-$stage}
  targets=$(findmnt --raw --noheadings --output TARGET) || { printf 'Cannot inspect mounts; preserve image %s\n' "$tree" >&2; return 1; }
  while IFS= read -r target; do
    case "$target" in
      "$tree"|"$tree"/*) printf 'Preserve mounted image %s; unmount it before removal\n' "$tree" >&2; return 1;;
    esac
  done <<< "$targets"
}
cleanup() {
  if [[ -n ${stage:-} && -d $stage ]]; then
    unmounted || return 1
    printf 'remove incomplete image %s\n' "$stage"; remove_image "$stage"; fi
}
trap cleanup EXIT
if [[ $filesystem == btrfs && $(image_type "$base") == subvolume ]]; then
  rmdir -- "$stage"
  btrfs subvolume snapshot "$base" "$stage"
else
  cp -a --reflink=auto -- "$base/." "$stage/"
fi
rm -f -- "$stage/etc/cairn-orb-image"
write_file() {
  install -d -m 755 "$(dirname -- "$2")"
  cat > "$2"
  chmod "$1" "$2"
}
guest() { systemd-nspawn --quiet --register=no --directory="$stage" --bind-ro="$host_root/etc/pacman.d/mirrorlist:/etc/pacman.d/mirrorlist" "$@"; }
guest pacman -Syu --noconfirm --needed "${packages[@]}"
guest_major=$(guest /usr/bin/node -p 'process.versions.node.split(".")[0]' | tr -d '[:space:]')
[[ $guest_major == "$node_major" ]] || { printf 'Guest Node major %s differs from cairn-orb-base %s; rebuild the base first\n' "$guest_major" "$node_major" >&2; exit 1; }
for binary in Xvfb x11vnc fluxbox xdotool chromium import; do
  guest runuser -u agent -- sh -c "command -v $binary" > /dev/null || { printf '%s is not runnable by agent\n' "$binary" >&2; exit 1; }
done
guest npm install -g --ignore-scripts --no-audit --no-fund "agent-browser@${agent_browser_version}"
guest sh -c 'chmod 755 "$(npm root -g)"/agent-browser/bin/agent-browser-linux-*'
guest runuser -u agent -- agent-browser --version > /dev/null || {
  printf 'agent-browser is not runnable by agent\n' >&2
  exit 1
}
write_file 644 "$stage/etc/chromium/policies/managed/cairn.json" <<'POLICY'
{
  "PasswordManagerEnabled": false,
  "AutofillAddressEnabled": false,
  "AutofillCreditCardEnabled": false,
  "SyncDisabled": true,
  "BrowserSignin": 0,
  "MetricsReportingEnabled": false,
  "DefaultBrowserSettingEnabled": false,
  "BackgroundModeEnabled": false
}
POLICY
write_file 755 "$stage/usr/local/lib/cairn-computer/desktop.sh" <<'DESKTOP'
#!/usr/bin/env bash
set -euo pipefail
export DISPLAY=:1
Xvfb :1 -screen 0 1280x800x24 -nolisten tcp &
for _ in $(seq 50); do [[ -S /tmp/.X11-unix/X1 ]] && break; sleep 0.1; done
fluxbox &
x11vnc -display :1 -rfbport 0 -unixsock /run/cairn-computer/vnc.sock -nopw -forever -shared -quiet &
x11vnc -display :1 -rfbport 0 -unixsock /run/cairn-computer/view.sock -viewonly -nopw -forever -shared -quiet &
wait -n
exit 1
DESKTOP
write_file 644 "$stage/etc/systemd/system/cairn-computer-desktop.service" <<'UNIT'
[Unit]
Description=Cairn computer desktop (Xvfb, fluxbox, x11vnc)
After=local-fs.target

[Service]
User=agent
UMask=0077
Restart=on-failure
RestartSec=2
ExecStartPre=/bin/sh -c 'while [ ! -d /run/cairn-computer ]; do sleep 1; done'
TimeoutStartSec=infinity
ExecStart=/usr/local/lib/cairn-computer/desktop.sh
LimitCORE=0

[Install]
WantedBy=multi-user.target
UNIT
write_file 644 "$stage/etc/systemd/system/cairn-computer-agent.service" <<UNIT
[Unit]
Description=Cairn computer agent
After=local-fs.target network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
User=agent
Environment=CAIRN_ORB=1
Environment=DISPLAY=:1
Environment=AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
Environment=AGENT_BROWSER_NO_VERSION_CHECK=1
Restart=always
RestartSec=1
ExecStartPre=/bin/sh -c 'while [ ! -S /run/cairn/computer.sock ]; do sleep 1; done'
TimeoutStartSec=infinity
ExecStart=/usr/bin/node $daemon_entry orb-computer --socket /run/cairn/computer.sock
UMask=0077
LimitCORE=0

[Install]
WantedBy=multi-user.target
UNIT
guest systemctl enable cairn-computer-desktop.service cairn-computer-agent.service
write_file 644 "$stage/etc/systemd/system/systemd-networkd-wait-online.service.d/ipv4.conf" <<'WAIT'
[Service]
ExecStart=
ExecStart=/usr/lib/systemd/systemd-networkd-wait-online --ipv4 --operational-state=routable --timeout=60
WAIT
guest systemctl enable systemd-networkd-wait-online.service
guest systemctl disable cairn-orb-worker.service
guest pacman -Scc --noconfirm
: > "$stage/etc/machine-id"
printf '%s\n' "$expected" > "$stage/etc/cairn-orb-computer-image"
unmounted
backup=
if [[ -e $image ]]; then
  if [[ -z $previous_marker || $(cat "$image/etc/cairn-orb-computer-image" 2>/dev/null) != "$previous_marker" ]]; then
    printf 'Another computer image appeared or changed; preserve it\n' >&2
    exit 1
  fi
  unmounted "$image"
  backup=$(mktemp -d "$machines_dir/.cairn-orb-computer-previous.XXXXXX")
  rmdir -- "$backup"
  printf 'preserve previous computer image at %s until replacement is registered\n' "$backup"
  mv -T -- "$image" "$backup"
fi
printf 'register %s\n' "$image"
if ! mv -T -- "$stage" "$image"; then
  if [[ -n $backup ]]; then printf 'restore previous computer image\n'; mv -T -- "$backup" "$image"; fi
  exit 1
fi
stage=
if [[ -n $backup ]]; then
  unmounted "$backup"
  printf 'remove previous computer image %s\n' "$backup"
  remove_image "$backup"
fi
machinectl list-images --no-legend --no-pager | awk '$1 == "cairn-orb-computer" {found=1} END {exit !found}'
publish_marker
printf 'publish %s\n' "$published_marker"
printf '1 changes\n'
