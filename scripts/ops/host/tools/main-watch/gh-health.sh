#!/bin/bash
# 5 probes of the GitHub API per run; a run is bad when 2+ fail or the median exceeds 3s. Three bad runs in a row open a `infra-network` issue; the next good run closes it.
set -uo pipefail
ST=~/.local/state/main-watch; mkdir -p $ST; R=xiechimon/cairn
fails=0; times=()
for i in 1 2 3 4 5; do
  out=$(curl -s -o /dev/null -H "Authorization: Bearer $(gh auth token)" -w "%{http_code} %{time_total}" --max-time 10 https://api.github.com/zen) || true
  code=${out%% *}; t=${out##* }
  if [ "$code" = 200 ]; then times+=("$t"); else fails=$((fails+1)); fi
  sleep 1
done
median=$(printf '%s\n' "${times[@]:-99}" | sort -n | awk '{a[NR]=$1} END{print a[int((NR+1)/2)]}')
bad=0; { [ $fails -ge 2 ] || awk -v m="$median" 'BEGIN{exit !(m>3)}'; } && bad=1
echo "$(date -u +%FT%H:%MZ) fails=$fails median=${median}s bad=$bad route=$(curl -s -m 3 -H "Authorization: Bearer $(jq -r '.experimental.clash_api.secret' ~/.config/sing-box/config.json 2>/dev/null)" http://127.0.0.1:9090/proxies/auto 2>/dev/null | jq -r '.now // "?"' 2>/dev/null)" >> $ST/gh-health.log
streak=$(tail -3 $ST/gh-health.log | grep -c 'bad=1')
open=$(gh issue list -R $R --label infra-network --state open --json number --jq '.[0].number // empty' 2>/dev/null)
if [ "$streak" = 3 ] && [ -z "$open" ]; then
  gh issue create -R $R -t "infra: GitHub API from omarchy is failing or slow" -l infra-network -l batch:now -l by:cairn -a xiechimon -b "$(printf 'Three main-watch runs in a row saw 2+ failed of 5 GitHub API probes or a median above 3s.\n\n```\n%s\n```\n\nOpened by gh-health on omarchy; closed automatically on the next healthy run.' "$(tail -6 $ST/gh-health.log)")" >/dev/null 2>&1 && echo "$(date -u +%H:%M) opened infra-network issue"
elif [ $bad = 0 ] && [ -n "$open" ]; then
  gh issue close $open -R $R -c "GitHub API healthy again from omarchy: $(tail -1 $ST/gh-health.log)" >/dev/null 2>&1 && echo "$(date -u +%H:%M) closed #$open"
fi
exit 0
