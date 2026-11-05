#!/bin/bash
label=$1; shift
DEFAULT="CHOWN DAC_OVERRIDE FOWNER FSETID KILL NET_BIND_SERVICE SETFCAP SETGID SETPCAP SETUID SYS_CHROOT"
drops=()
for c in $DEFAULT; do keep=0; for k in "$@"; do [ "$k" = "$c" ] && keep=1; done; [ $keep = 0 ] && drops+=("--cap-drop=$c"); done
out=$(podman run --rm --userns=keep-id:uid=1000,gid=1000 "${drops[@]}" d69spike-arch:1 bash -c '
touch ~/f; sleep 300 & p=$!
echo -n "kill-user-proc-as-root:"; sudo kill -0 $p >/dev/null 2>&1; echo -n "$? "
echo -n " chmod-user-file-as-root:"; sudo chmod 600 ~/f >/dev/null 2>&1; echo -n "$? "
echo -n " pacman-iputils(file-caps):"; sudo pacman -Sy --noconfirm iputils >/tmp/pm.log 2>&1; echo -n "$? "
getcap /usr/bin/ping 2>&1 | head -1
sudo grep -iE "error|warning" /tmp/pm.log | head -3
echo -n "pacman-git+nodejs:"; sudo pacman -S --noconfirm git nodejs >/tmp/pm2.log 2>&1; echo -n "$? "; sudo grep -iE "error|warning" /tmp/pm2.log | head -3
' 2>&1)
echo "[$label] keep={$*}: $(echo "$out" | tr '\n' '|')"
