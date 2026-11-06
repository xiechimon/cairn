#!/bin/bash
set -u
repo="${CAIRN_REPO:-xiechimon/cairn}"
limit="${CI_SPEED_RUNS:-60}"
line=""
for event in pull_request push; do
  stats=$(gh run list --repo "$repo" --workflow ci.yml --event "$event" --status completed --limit "$limit" --json startedAt,updatedAt --jq '.[] | ((.updatedAt|fromdateiso8601) - (.startedAt|fromdateiso8601))' |
    sort -n | awk '{a[NR]=$1} END {if (NR==0) {print "none"; exit} m=a[int((NR+1)/2)]; p=a[int(NR*0.9+0.999999)]; printf "median %dm%02ds p90 %dm%02ds max %dm%02ds (%d runs)", m/60, m%60, p/60, p%60, a[NR]/60, a[NR]%60, NR}')
  line="$line${line:+; }$event $stats"
done
echo "CI wall time: $line"
