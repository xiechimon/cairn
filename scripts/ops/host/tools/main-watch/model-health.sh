#!/bin/bash
# Opens an `infra-models` issue when implement or review has no usable model for 3 runs in a row; closes it when both have one again.
set -uo pipefail
R=xiechimon/cairn ST=~/.local/state/main-watch; mkdir -p $ST
i=$(timeout 120 ai-route pick implement 2>/dev/null | grep -c .); r=$(timeout 120 ai-route pick review 2>/dev/null | grep -c .)
bad=0; { [ "$i" = 0 ] || [ "$r" = 0 ]; } && bad=1
echo "$(date -u +%FT%H:%MZ) implement=$i review=$r bad=$bad" >> $ST/model-health.log
open=$(gh issue list -R $R --label infra-models --state open --json number --jq '.[0].number // empty' 2>/dev/null)
if [ "$(tail -3 $ST/model-health.log | grep -c 'bad=1')" = 3 ] && [ -z "$open" ]; then
  gh issue create -R $R -t "infra: no usable model for implement or review on omarchy" -l infra-models -l batch:now -l by:cairn -a xiechimon \
    -b "$(printf 'ai-route found no usable model three runs in a row:\n\n```\n%s\n```\n\nCheck pi channel balances, codex/grok quota (`ai-route status --refresh`). Closed automatically when both roles have a model again.' "$(tail -3 $ST/model-health.log)")" >/dev/null 2>&1 && echo "$(date -u +%H:%M) opened infra-models issue"
elif [ $bad = 0 ] && [ -n "$open" ]; then
  gh issue close $open -R $R -c "Models available again: $(tail -1 $ST/model-health.log)" >/dev/null 2>&1
fi
exit 0
