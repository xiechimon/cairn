#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = --dry-run ] && [ $# = 1 ]; then
  printf '%s\n' 'Ensure system user cairn-runner with private home and no sudo/docker/wheel groups' 'Ensure cairn-broker group shared by ian and cairn-runner' 'chmod 700 /home/ian' 'chown ian and chmod 750 /mnt/fast/cairn/server' 'chown ian and chmod 640 /mnt/fast/cairn/server/server.db*' 'Move stale secretbox.key into a 700 quarantine directory without overwriting' 'Validate paths first; persist nftables or iptables loopback owner firewall in /etc/cairn-runner-firewall/apply.sh'
  exit 0
fi
[ $# = 0 ] || exit 2
[ "$(uname -s)" = Linux ] && [ "$(id -u)" = 0 ] || { echo 'Run with sudo on Linux' >&2; exit 2; }
server_port=${CAIRN_SERVER_PORT:-8787}
[[ "$server_port" =~ ^[0-9]+$ ]] && [ "$server_port" -ge 1 ] && [ "$server_port" -le 65535 ] || exit 2
owner_uid=$(id -u ian)
owner_group=$(id -gn ian)
[[ "$owner_uid" =~ ^[0-9]+$ ]] && [[ "$owner_group" =~ ^[a-zA-Z0-9_-]+$ ]] || exit 2
validate_path() {
  local path="$1" cursor="$1"
  [[ "$path" = /* ]] || exit 2
  while [ "$cursor" != / ]; do
    [ ! -L "$cursor" ] || { echo "Refusing symlink: $cursor" >&2; exit 1; }
    cursor=$(dirname "$cursor")
    [ ! -e "$cursor" ] || [ -d "$cursor" ] || { echo "Refusing non-directory ancestor: $cursor" >&2; exit 1; }
  done
}
for path in /home/ian /home/cairn-runner /mnt/fast/cairn/server /home/ian/.cairn/server.hdd-old/secretbox.key /home/ian/.cairn/secret-quarantine /etc/cairn-runner-firewall /etc/cairn-runner-firewall/apply.sh /etc/systemd/system/cairn-runner-firewall.service; do
  validate_path "$path"
done
[ -d /etc/systemd/system ] && [ -d /home/ian ] && [ -d /mnt/fast/cairn/server ] || exit 1
[ ! -e /home/cairn-runner ] || [ -d /home/cairn-runner ] || exit 1
[ ! -e /home/ian/.cairn/secret-quarantine ] || [ -d /home/ian/.cairn/secret-quarantine ] || exit 1
[ ! -e /etc/cairn-runner-firewall ] || [ -d /etc/cairn-runner-firewall ] || exit 1
for path in /etc/cairn-runner-firewall/apply.sh /etc/systemd/system/cairn-runner-firewall.service /home/ian/.cairn/server.hdd-old/secretbox.key; do
  [ ! -e "$path" ] || [ -f "$path" ] || exit 1
done
[ -f /mnt/fast/cairn/server/server.db ] || exit 1
for path in /mnt/fast/cairn/server/server.db*; do
  validate_path "$path"
  [ -f "$path" ] || { echo 'Refusing non-regular database path' >&2; exit 1; }
done
if command -v nft >/dev/null && nft --version >/dev/null 2>&1; then
  backend=nft
elif command -v iptables >/dev/null && command -v ip6tables >/dev/null; then
  backend=iptables
else
  echo 'Need nftables or both iptables and ip6tables' >&2
  exit 1
fi
command -v systemctl >/dev/null || exit 1
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
install -d -m 700 -o root /etc/cairn-runner-firewall
if [ "$backend" = nft ]; then
  cat > /etc/cairn-runner-firewall/apply.sh <<EOF_NFT
#!/usr/bin/env bash
set -euo pipefail
if [ "\${1:-start}" = stop ]; then
  nft delete table inet cairn_runner 2>/dev/null || true
  exit 0
fi
nft list table inet cairn_runner >/dev/null 2>&1 || nft add table inet cairn_runner
nft -f - <<'RULES'
delete table inet cairn_runner
add table inet cairn_runner
add chain inet cairn_runner output { type filter hook output priority -10; policy accept; }
add rule inet cairn_runner output oifname "lo" tcp dport $server_port meta skuid != { 0, $owner_uid } reject
RULES
EOF_NFT
else
  cat > /etc/cairn-runner-firewall/apply.sh <<EOF_IPTABLES
#!/usr/bin/env bash
set -euo pipefail
for tool in iptables ip6tables; do
  if [ "\${1:-start}" = stop ]; then
    \$tool -w -D OUTPUT -o lo -p tcp --dport $server_port -j CAIRN_RUNNER 2>/dev/null || true
    \$tool -w -F CAIRN_RUNNER 2>/dev/null || true
    \$tool -w -X CAIRN_RUNNER 2>/dev/null || true
  else
    \$tool -w -N CAIRN_RUNNER 2>/dev/null || true
    \$tool -w -F CAIRN_RUNNER
    \$tool -w -A CAIRN_RUNNER -m owner --uid-owner 0 -j RETURN
    \$tool -w -A CAIRN_RUNNER -m owner --uid-owner $owner_uid -j RETURN
    \$tool -w -A CAIRN_RUNNER -j REJECT
    \$tool -w -C OUTPUT -o lo -p tcp --dport $server_port -j CAIRN_RUNNER 2>/dev/null || \$tool -w -I OUTPUT 1 -o lo -p tcp --dport $server_port -j CAIRN_RUNNER
  fi
done
EOF_IPTABLES
fi
chmod 700 /etc/cairn-runner-firewall/apply.sh
chown root:root /etc/cairn-runner-firewall/apply.sh
cat > /etc/systemd/system/cairn-runner-firewall.service <<'EOF_SERVICE'
[Unit]
Description=Cairn runner loopback isolation
After=network-pre.target
Before=network.target
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/etc/cairn-runner-firewall/apply.sh start
ExecStop=/etc/cairn-runner-firewall/apply.sh stop
[Install]
WantedBy=multi-user.target
EOF_SERVICE
chmod 644 /etc/systemd/system/cairn-runner-firewall.service
chown root:root /etc/systemd/system/cairn-runner-firewall.service
/etc/cairn-runner-firewall/apply.sh start
systemctl daemon-reload
systemctl enable --now cairn-runner-firewall.service
echo 'Persisted loopback owner firewall in /etc/cairn-runner-firewall/apply.sh'
