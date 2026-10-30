#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = --dry-run ] && [ $# = 1 ]; then
  printf '%s\n' 'Ensure system user cairn-runner with private home and no sudo/docker/wheel groups' 'Ensure cairn-broker group shared by ian and cairn-runner' 'chmod 700 /home/ian' 'chown ian and chmod 750 /mnt/fast/cairn/server' 'chown ian and chmod 640 /mnt/fast/cairn/server/server.db*' 'Move stale secretbox.key into a 700 quarantine directory without overwriting' 'Validate paths before account or file changes'
  exit 0
fi
[ $# = 0 ] || exit 2
[ "$(uname -s)" = Linux ] && [ "$(id -u)" = 0 ] || { echo 'Run with sudo on Linux' >&2; exit 2; }
owner_group=$(id -gn ian)
[[ "$owner_group" =~ ^[a-zA-Z0-9_-]+$ ]] || exit 2
validate_path() {
  local path="$1" cursor="$1"
  [[ "$path" = /* ]] || exit 2
  while [ "$cursor" != / ]; do
    [ ! -L "$cursor" ] || { echo "Refusing symlink: $cursor" >&2; exit 1; }
    cursor=$(dirname "$cursor")
    [ ! -e "$cursor" ] || [ -d "$cursor" ] || { echo "Refusing non-directory ancestor: $cursor" >&2; exit 1; }
  done
}
for path in /home/ian /home/cairn-runner /mnt/fast/cairn/server /home/ian/.cairn/server.hdd-old/secretbox.key /home/ian/.cairn/secret-quarantine; do
  validate_path "$path"
done
[ -d /home/ian ] && [ -d /mnt/fast/cairn/server ] || exit 1
[ ! -e /home/cairn-runner ] || [ -d /home/cairn-runner ] || exit 1
[ ! -e /home/ian/.cairn/secret-quarantine ] || [ -d /home/ian/.cairn/secret-quarantine ] || exit 1
for path in /home/ian/.cairn/server.hdd-old/secretbox.key; do
  [ ! -e "$path" ] || [ -f "$path" ] || exit 1
done
[ -f /mnt/fast/cairn/server/server.db ] || exit 1
for path in /mnt/fast/cairn/server/server.db*; do
  validate_path "$path"
  [ -f "$path" ] || { echo 'Refusing non-regular database path' >&2; exit 1; }
done
getent group cairn-broker >/dev/null || { groupadd --system cairn-broker; echo 'Created cairn-broker group'; }
getent group cairn-runner >/dev/null || { groupadd --system cairn-runner; echo 'Created cairn-runner group'; }
if ! id cairn-runner >/dev/null 2>&1; then
  useradd --system --gid cairn-runner --create-home --home-dir /home/cairn-runner --shell /bin/bash cairn-runner
  echo 'Created cairn-runner'
fi
usermod -g cairn-runner -G cairn-broker cairn-runner
usermod -a -G cairn-broker ian
passwd -l cairn-runner >/dev/null
chmod 700 /home/cairn-runner /home/ian
chown "ian:$owner_group" /mnt/fast/cairn/server
chmod 750 /mnt/fast/cairn/server
for path in /mnt/fast/cairn/server/server.db*; do
  [ -e "$path" ] || continue
  [ -f "$path" ] && [ ! -L "$path" ] || { echo 'Refusing non-regular database path' >&2; exit 1; }
  chown "ian:$owner_group" "$path"
  chmod 640 "$path"
  echo "Set ian ownership and 640: $path"
done
stale=/home/ian/.cairn/server.hdd-old/secretbox.key
if [ -e "$stale" ]; then
  quarantine=/home/ian/.cairn/secret-quarantine
  [ ! -L "$quarantine" ] || exit 1
  install -d -m 700 -o ian "$quarantine"
  destination=$(mktemp -d "$quarantine/stale.XXXXXX")
  chown ian "$destination"
  mv "$stale" "$destination/secretbox.key"
  chmod 600 "$destination/secretbox.key"
  chown ian "$destination/secretbox.key"
  echo "Quarantined stale key: $destination/secretbox.key"
fi
echo 'Applied runner group isolation, locked password, private homes and server directory mode 750'
