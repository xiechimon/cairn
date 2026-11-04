#!/bin/bash
img=$1; sent=$2
m=$(podman image mount "$img")
echo "mounted at $m"
echo -n "files in image root: "; find "$m" -xdev -type f 2>/dev/null | wc -l
echo -n "sentinel hits (grep -rl): "; grep -rlaF "$sent" "$m" 2>/dev/null | wc -l
echo -n "control LAYERMARK hits: "; grep -rlaF "LAYERMARK-control" "$m" 2>/dev/null | sed "s#$m##" | tr '\n' ' '; echo
echo -n "relay.sock.token exists in image: "; ls "$m/run/cairn/" 2>&1 | head -2 | tr '\n' ' '; echo
echo -n "vol.token / /mnt/vol content: "; ls -la "$m/mnt/vol" 2>&1 | tail -n +2 | wc -l
podman image unmount "$img" >/dev/null
