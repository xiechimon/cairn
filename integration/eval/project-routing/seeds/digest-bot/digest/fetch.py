import feedparser

FEEDS = [
    "https://hnrss.org/frontpage",
    "https://simonwillison.net/atom/everything/",
]


def fetch_all() -> list[dict]:
    items = []
    for url in FEEDS:
        for entry in feedparser.parse(url).entries[:20]:
            items.append({"title": entry.title, "link": entry.link})
    return items
