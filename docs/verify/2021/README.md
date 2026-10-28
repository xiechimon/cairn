# Verify #2021 — lane worker exit gate

Negative controls taken from the issue body and comments (banned model route and short rc-0 wrap-ups). Commands run from the repository root.

## Banned model (lanes #1517 / #1792)

```sh
printf '%s\n' 'ai-route: implement -> pi:domestic-proxy/deepseek-v4-flash' > /tmp/cairn-2021-banned.log
node scripts/lane-worker-exit-gate.mjs --log /tmp/cairn-2021-banned.log --rc 0 --duration-s 55
# expect exit 1, code banned-model
```

## No-op wrap-ups (#2005 / #1775)

```sh
printf '%s\n' '重叠的 open PR：#1992 涉及 workflow、structure baseline、prepush；#1787 涉及 workflow。本轮未改动其内容，也未启动服务器。' > /tmp/cairn-2021-noop.log
node scripts/lane-worker-exit-gate.mjs --log /tmp/cairn-2021-noop.log --rc 0 --duration-s 57
# expect exit 1, code noop-exit

printf '%s\n' '未提交、未推送，未启动服务器。请补充具体自检失败项；产品实施仍需先决定执行隔离、响应泄密边界及旧秘密迁移策略。' > /tmp/cairn-2021-noop2.log
node scripts/lane-worker-exit-gate.mjs --log /tmp/cairn-2021-noop2.log --rc 0 --duration-s 55
# expect exit 1, code noop-exit
```

## Allowed long run stays green

```sh
printf '%s\n' 'ai-route: implement -> pi:domestic-proxy/deepseek-v4.1-flash' 'opened https://github.com/xiechimon/cairn/pull/1' > /tmp/cairn-2021-ok.log
node scripts/lane-worker-exit-gate.mjs --log /tmp/cairn-2021-ok.log --rc 0 --duration-s 900
# expect exit 0
```

Automated copies of these fixtures live in `scripts/lane-worker-exit-gate.test.mjs` and `scripts/lane-model-policy.test.mjs`.
