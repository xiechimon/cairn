#!/usr/bin/env bash
set -euo pipefail
BASE=http://127.0.0.1:8791
cd "$(mktemp -d)"

echo '== 1. GET /api/auth/session =='
curl -s $BASE/api/auth/session; echo

echo '== 2. GET /api/teams (always one seeded row) =='
TEAM=$(curl -s $BASE/api/teams | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const t=JSON.parse(d)[0];console.error(JSON.stringify(t));console.log(t.id)})")

echo '== 3. SSE team stream background listener (6s window) =='
curl -sN --max-time 6 $BASE/api/teams/$TEAM/stream > sse-capture.txt &
SSE_PID=$!
sleep 1

echo '== 4. POST /api/projects (create project) =='
PROJ=$(curl -s -X POST $BASE/api/projects -H 'content-type: application/json' -d '{"name":"r3-lifecycle"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{console.error(d);console.log(JSON.parse(d).id)})")

echo '== 5. create: POST /api/projects/{id}/todos {title,spec} =='
TODO=$(curl -s -X POST $BASE/api/projects/$PROJ/todos -H 'content-type: application/json' -d '{"title":"编写 CONTRIBUTING.md 贡献指南","spec":"> 帮 r3-lifecycle 写一份贡献指南\n\n要求：放到项目根目录"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const t=JSON.parse(d);console.error(JSON.stringify({id:t.id,seqNum:t.seqNum,phase:t.phase,v:t.v}));console.log(t.id)})")

echo '== 6. read: GET /api/todos/{id} =='
curl -s $BASE/api/todos/$TODO | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const t=JSON.parse(d);console.log(JSON.stringify({id:t.id,title:t.title,phase:t.phase,seqNum:t.seqNum,v:t.v},null,1))})"

echo '== 7. update: PATCH /api/todos/{id} (v increments) =='
curl -s -X PATCH $BASE/api/todos/$TODO -H 'content-type: application/json' -d '{"title":"编写 CONTRIBUTING.md 贡献指南 v2"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const t=JSON.parse(d);console.log(JSON.stringify({title:t.title,v:t.v}))})"

echo '== 8. start: POST /api/projects/{id}/builds {todoIds,assignment,withPlan} =='
curl -s -X POST $BASE/api/projects/$PROJ/builds -H 'content-type: application/json' -d "{\"todoIds\":[\"$TODO\"],\"assignment\":{\"plan\":null,\"build\":null},\"withPlan\":true}" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const b=JSON.parse(d).builds[0];console.log(JSON.stringify({buildId:b.id,prevPhase:b.prevPhase,triggerSource:b.triggerSource},null,1))})"
echo '--- todo should be queued; plan step enqueued:'
curl -s $BASE/api/todos/$TODO | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log('phase:',JSON.parse(d).phase))"
BUILD=$(curl -s $BASE/api/projects/$PROJ/builds | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d)[0].id))")
curl -s $BASE/api/builds/$BUILD/steps | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log('steps:',JSON.stringify(JSON.parse(d))))"

echo '== 9. delete: DELETE /api/todos/{id} =='
T2=$(curl -s -X POST $BASE/api/projects/$PROJ/todos -H 'content-type: application/json' -d '{"title":"待删","spec":""}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).id))")
curl -s -o /dev/null -w 'DELETE status=%{http_code}\n' -X DELETE $BASE/api/todos/$T2
curl -s -o /dev/null -w 'GET after delete status=%{http_code}\n' $BASE/api/todos/$T2

echo '== 10. error shapes (404/409/400 all {error}) =='
curl -s $BASE/api/todos/nope; echo
curl -s -X POST $BASE/api/builds/$BUILD/merge; echo
curl -s -X POST $BASE/api/projects/$PROJ/todos -H 'content-type: application/json' -d '{"title":123}'; echo

wait $SSE_PID || true
echo '== 11. SSE capture (ping + todo/build doc events, shape = r5 §7.2) =='
cat sse-capture.txt

echo '== 12. provider surface: POST with apiKey → GET read-only masked face =='
curl -s -X POST $BASE/api/teams/$TEAM/providers -H 'content-type: application/json' -d '{"providerId":"my-relay","label":"r3-gw","baseUrl":"https://api.example.com/v1","api":"anthropic-messages","apiKey":"sk-demo-secret"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const p=JSON.parse(d);console.log(JSON.stringify({id:p.id,providerId:p.providerId,hasApiKeyField:'apiKey' in p}))})"
curl -s $BASE/api/teams/$TEAM/providers | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const e=JSON.parse(d);console.log('presets:',e.presets.length,'providers:',e.providers.length,'leaked:',d.includes('sk-demo-secret'))})"

echo '== 13. secret surface: write-only values (r2 §6.3) =='
curl -s -X POST $BASE/api/teams/$TEAM/secrets -H 'content-type: application/json' -d '{"name":"STRIPE_API_KEY","description":"演示","value":"sk_live_demo"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log('created keys:',Object.keys(JSON.parse(d)).join(',')))"
curl -s $BASE/api/teams/$TEAM/secrets | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log('list leaked value:',d.includes('sk_live_demo')))"

echo '== 14. apiKey surface: plaintext once + row mask (r3 §6) =='
curl -s -X POST $BASE/api/teams/$TEAM/api-keys -H 'content-type: application/json' -d '{"gitAccess":true,"mcpAccess":false,"toolGrants":{"read":["Todos"],"write":[]}}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const k=JSON.parse(d);console.log(JSON.stringify({masked:k.masked,plaintextShape:/^cairn_[0-9a-f]{48}$/.test(k.plaintext)}))})"
curl -s $BASE/api/teams/$TEAM/api-keys | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log('list row:',JSON.stringify(JSON.parse(d)[0])))"

echo '== 15. search: GET /api/search?q= (02 §6.3) =='
curl -s "$BASE/api/search?q=$(node -e 'console.log(encodeURIComponent("贡献"))')" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.stringify(JSON.parse(d))))"
