#!/bin/bash
set -euo pipefail
gateway=$(awk '/^nameserver/ { print $2; exit }' /etc/resolv.conf)
[[ $gateway =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 1
nft -f /etc/cairn/guard.nft
nft add element inet cairn_guard gateway "{ $gateway }"
nft list set inet cairn_guard gateway | grep -qF "$gateway" || exit 1
if [[ $(stat -c %u /home/agent) != 1000 ]]; then
  cp -an /etc/skel/. /home/agent/
  chown -R 1000:1000 /home/agent
fi
exec setpriv --reuid=1000 --regid=1000 --init-groups --inh-caps=-all --bounding-set=-all --no-new-privs \
  env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/home/agent USER=agent LANG=C.UTF-8 /usr/local/bin/cairn-desktop
