#!/usr/bin/env bash
set -u
cd "$(git rev-parse --show-toplevel)"
unset CI
D=$(mktemp -d)
export KILLED_AT=$D/killed-at
export CAIRN_HEAVY_SLOTS=2 CAIRN_HEAVY_SLOTS_DIR=$D/locks
stand_in='const fs=require("fs");const log=(k)=>fs.appendFileSync(process.argv[1],k+" slot="+process.env.CAIRN_HEAVY_SLOT+" "+Date.now()+"\n");log("start");setTimeout(()=>{log("end")},2000)'

echo "== A: slots=2, 4 stand-in jobs launched at once"
pids=()
for j in 1 2 3 4; do
  node scripts/heavy-slots.mjs run -- node -e "$stand_in" "$D/events" 2>"$D/err-$j" &
  pids+=($!)
done
fail=0
for pid in "${pids[@]}"; do wait "$pid" || fail=1; done
echo "exit codes all zero: $([ $fail = 0 ] && echo yes || echo no)"
echo "queued messages:"; cat "$D"/err-* | grep -E "排队中|拿到名额" | sort | uniq -c
node -e '
const lines=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(l=>l.split(" "));
let active=0,peak=0;
for(const [k] of lines.sort((a,b)=>a[2]-b[2]||(a[0]==="end"?-1:1))){active+=k==="start"?1:-1;peak=Math.max(peak,active);}
console.log("jobs started:",lines.filter(l=>l[0]==="start").length,"peak concurrent:",peak);
' "$D/events"

echo "== B: kill -9 the holder, queued job takes the slot"
export CAIRN_HEAVY_SLOTS=1 CAIRN_HEAVY_SLOTS_DIR=$D/locks-b
node scripts/heavy-slots.mjs run -- sleep 60 2>"$D/b-holder" &
holder=$!
sleep 1
node -e '
require("child_process").spawn(process.execPath,["scripts/heavy-slots.mjs","run","--",process.execPath,"-e","console.log(\"waiter ran \"+(Date.now()-Number(require(\"fs\").readFileSync(process.env.KILLED_AT,\"utf8\")))+\" ms after kill -9\")"],{stdio:"inherit"});
' &
sleep 1
holder_child=$(pgrep -P "$holder" sleep | head -1)
node -e 'require("fs").writeFileSync(process.env.KILLED_AT,String(Date.now()))'
kill -9 "$holder"
kill "$holder_child" 2>/dev/null
wait 2>/dev/null
rm -rf "$D"
