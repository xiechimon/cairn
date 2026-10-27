def summarize(items: list[dict], model) -> list[str]:
    prompt = "用中文给每条写一句要点：\n" + "\n".join(i["title"] for i in items)
    return model.complete(prompt).splitlines()
