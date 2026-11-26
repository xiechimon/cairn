#!/usr/bin/env bash
for attempt in 1 2 3 4; do
  timeout 60 "$@" && exit 0
  status=$?
  [ "$attempt" = 4 ] && exit "$status"
  sleep $((attempt * 5))
done
