#!/bin/bash
label=$1; shift
DEFAULT="CHOWN DAC_OVERRIDE FOWNER FSETID KILL NET_BIND_SERVICE SETFCAP SETGID SETPCAP SETUID SYS_CHROOT"
drops=()
for c in $DEFAULT; do
  keep=0; for k in "$@"; do [ "$k" = "$c" ] && keep=1; done
  [ $keep = 0 ] && drops+=("--cap-drop=$c")
done
out=$(podman run --rm --userns=keep-id:uid=1000,gid=1000 "${drops[@]}" --cpus 4 --memory 4g --memory-swap 4g --pids-limit 4096 --ulimit core=0 d69spike-arch:1 bash -c '
r(){ "$@" >/dev/null 2>/tmp/err.$$; echo -n "$? "; }
echo -n "sudo:"; r sudo -n true
echo -n " chown:"; sudo sh -c "touch /etc/x && chown 1000:1000 /etc/x" >/dev/null 2>&1; echo -n "$? "
echo -n " pacman-install:"; sudo pacman -Sy --noconfirm tree >/tmp/pm.log 2>&1; echo -n "$? "
echo -n " tree-runs:"; tree --version >/dev/null 2>&1; echo -n "$? "
echo -n " bwrap:"; bwrap --ro-bind / / true >/dev/null 2>&1; echo -n "$? "
echo; sudo grep -iE "error|warning" /tmp/pm.log | head -3
sudo true 2>&1 | head -2
' 2>&1)
echo "[$label] keep={$*}: $(echo "$out" | tr '\n' '|')"
