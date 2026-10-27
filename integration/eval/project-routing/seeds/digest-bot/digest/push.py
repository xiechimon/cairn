import json

import httpx

WEBHOOK = "https://open.feishu.cn/open-apis/bot/v2/hook/REPLACE_ME"


def push(points: list[str]) -> None:
    body = {"msg_type": "text", "content": {"text": "\n".join(points)}}
    httpx.post(WEBHOOK, content=json.dumps(body), headers={"Content-Type": "application/json"})
