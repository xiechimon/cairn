#!/bin/bash
done_list=""
for f in ~/lanes/logs/rr-*.log; do tail -1 "$f" | grep -q '^ai-route: implement ->' || done_list="$done_list $(basename $f .log)"; done
echo "$done_list"
