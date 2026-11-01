#!/bin/bash
# Leaked test temp dirs (cairn-*, vitest-*) exhausted /tmp inodes twice; remove ones older than 2h and log inode use.
find /tmp -mindepth 1 -maxdepth 1 \( -name 'cairn-*' -o -name 'vitest-*' -o -name 'playwright-*' \) -mmin +120 -exec rm -r {} + 2>/dev/null
find /mnt/fast/tmp -mindepth 1 -maxdepth 2 \( -name 'cairn-*' -o -name 'vitest-*' \) -mmin +120 -exec rm -r {} + 2>/dev/null
echo "$(date -u +%FT%H:%MZ) tmp inodes $(df -i /tmp | awk 'NR==2{print $5}')" >> ~/.local/state/main-watch/tmp.log
exit 0
