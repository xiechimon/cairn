#!/usr/bin/env python3
"""PR evidence gate (#750; widened by #939/#940; sections collapsed by #1079).

Section checks (#939; section names collapsed by #1079): the PR body
must answer two template sections, "Upstream" and "Verified". The gate
checks that
an answer exists, not that the answer is good: a missing heading, or a
heading whose text is empty after stripping HTML comments, fails and
names the section. Headings inside fenced code blocks do not count (a
quoted template is not an answer), and the template ships its guidance
as HTML comments so an untouched template fails. What the Verified
answer must contain (the red-then-green output pair) is a reviewer
judgment, not a gate judgment.

Link checks (#750): image links in the PR body must be embedded
(`![label](url)`) and must answer HTTP 200 (catches bad SHAs).

Explicit Markdown and HTML image embeds are scanned even without extensions.
Other URLs are image links under two parallel rules (#940):

1. Extension: any https URL ending in png|gif|jpe?g|webp|svg, on any
   host.
2. Media host: any https URL on a host that serves nothing but uploaded
   media (user-images.githubusercontent.com, github.com/user-attachments)
   whose last path segment carries no file extension -- the shape
   drag-and-drop uploads produce.

A URL counts as embedded under any of three forms (#1335):

1. Markdown image: the target of `![label](url)`.
2. HTML image: the value of an `<img src="...">` attribute (the
   fallback an HTML `<picture>` falls back to).
3. HTML source: any comma-separated URL in a `<source srcset="...">`
   attribute (the variants a `<picture>` picks between). Whitespace
   around each comma is allowed and a width/height descriptor after
   each URL (`2x`, `100w`) is stripped -- neither is part of the URL.

URLs inside an HTML comment (`<!-- ... -->`) are not embedded and are
not scanned at all: GitHub does not render them, so the comment text
is treated as not present for the link check. Section checks
(`section_verdicts`) have always stripped comments from section
content and are unaffected.

Form 2 and form 3 cover the Cursor badge footer the agent injects
after `<!-- CURSOR_AGENT_PR_BODY_END -->` when it opens a PR: a
`<picture>` with two `<source>` variants and an `<img>` fallback per
link. Without them the gate red-flags every badge URL as a bare
external image link, even though GitHub renders the badge. Stripping
the footer at the lane that opens the PR is out of bounds (#1335),
so the gate has to recognize the form. Bare URLs that are not wrapped
in any of the three forms still fail.

Outside explicit image embeds, raw.githubusercontent.com is judged by rule 1 alone: it serves every
committed file type, so an extensionless raw path (LICENSE, a directory
permalink) is a reference, and non-image evidence files (.json, .md,
.txt) cannot be embedded as images -- they are read as references, not
evidence (#750 scope). Measured on the 25 most recently merged bodies
at the time of the change, extending rule 2 to raw flagged 79 reference
links, every one a false positive (docs/verify/939/).

Fenced code blocks do not exempt image links: agents list evidence in
code fences, and an image link in a fence renders nowhere (#940 keeps
this a non-goal).

Usage:
  PR_BODY='<pr body>' python3 scripts/pr-evidence-gate.py   # CI entry point
  python3 scripts/pr-evidence-gate.py path/to/body.md        # local testing

Exit 0 when the body passes, 1 otherwise. Findings name the section or
the URL (with its line for bare URLs).
"""
import os
from html import unescape
from urllib.parse import parse_qs, urlsplit
import re
import subprocess
import sys
import concurrent.futures as cf

MD_LINK = re.compile(r'(?P<bang>!?)\[(?P<label>[^\]]*)\]\((?P<url>[^)\s]+)\)')
IMG_EXT = re.compile(r'\.(?:png|gif|jpe?g|webp|svg)$', re.IGNORECASE)
URL = re.compile(r"https://[^\s)\]>\"'`<]+")
TAIL_EXT = re.compile(r'\.[A-Za-z0-9]+$')
HTML_EMBED = re.compile(
    r"<(?:img\b[^>]*?\ssrc|source\b[^>]*?\ssrcset)"
    r"\s*=\s*(?P<quote>[\"'])(?P<value>.*?)(?P=quote)",
    re.IGNORECASE | re.DOTALL)


def is_media_host_image(url):
    parsed = urlsplit(url)
    media_host = parsed.hostname == 'user-images.githubusercontent.com' or (
        parsed.hostname == 'github.com' and parsed.path.startswith('/user-attachments/'))
    last = parsed.path.rsplit('/', 1)[-1]
    return media_host and bool(last) and not TAIL_EXT.search(last)


REQUIRED_SECTIONS = ('Upstream', 'Verified')
# The full body contract a lane must satisfy (#1110). The gate only
# *requires* the two sections above; the rest are named here so a failing
# lane is pointed at the canonical template instead of guessing a shape --
# the global show-me /pr skill ships a different three-section template and
# fails this gate (four lanes in one day hand-rewrote the body).
TEMPLATE_PATH = '.github/PULL_REQUEST_TEMPLATE.md'
TEMPLATE_SECTIONS = ('What', 'Verified', 'Upstream', 'Risk', 'Acceptance',
                     'Issues')
H2 = re.compile(r'^##[ \t]+(.+?)[ \t]*$', re.M)
HTML_COMMENT = re.compile(r'<!--.*?-->', re.S)
FENCE = re.compile(r'^ {0,3}(?:```|~~~)')


def without_fences(body):
    """Blank out fenced code blocks, keeping the line count."""
    out = []
    inside = False
    for line in body.split('\n'):
        if FENCE.match(line):
            inside = not inside
            out.append('')
            continue
        out.append('' if inside else line)
    return '\n'.join(out)


def without_html_comments(body):
    """Blank out `<!-- ... -->` spans with same-length whitespace.

    Newlines are preserved so the line numbers reported by the gate
    still match the source body. URLs inside HTML comments are not
    rendered by GitHub, so they are not links (#1335). Section checks
    `section_verdicts` already strip comments from section content and
    are unaffected -- this helper runs only on the link path.
    """
    return HTML_COMMENT.sub(
        lambda m: re.sub(r'[^\n]', ' ', m.group(0)),
        body)


def section_verdicts(body):
    """Per required section: 'answered', 'empty', or 'missing'.

    HTML comments never count as an answer, so the template's own
    guidance (shipped as comments) cannot pass the gate untouched.
    """
    text = without_fences(body)
    headers = [(m.start(), m.end(), m.group(1).strip())
               for m in H2.finditer(text)]
    verdicts = {}
    for name in REQUIRED_SECTIONS:
        content = None
        for i, (_, hend, heading) in enumerate(headers):
            if heading.lower() == name.lower():
                nxt = headers[i + 1][0] if i + 1 < len(headers) else len(text)
                content = text[hend:nxt]
                break
        if content is None:
            verdicts[name] = 'missing'
        elif HTML_COMMENT.sub('', content).strip():
            verdicts[name] = 'answered'
        else:
            verdicts[name] = 'empty'
    return verdicts


def http_code(url):
    r = subprocess.run(
        ['curl', '-s', '-o', '/dev/null', '-w', '%{http_code}', '-m', '25', url],
        capture_output=True, text=True)
    return r.stdout.strip()


def find_links(body):
    """Every image URL in the body, tagged with its rendering form.

    A URL is embedded as the target of `![label](url)`, as the value
    of an `<img src="...">` attribute, or as a URL inside a
    `<source srcset="...">` attribute (#1335). As the target of
    `[label](url)` it renders as a link, and standing on its own it
    renders as an autolink or as text; none of those show the image.

    A URL inside an `<!-- ... -->` comment is not rendered and is not
    scanned: the comment text is replaced by same-length whitespace
    before matching, so line numbers in `FAIL not-embedded` still
    point at the source line.
    """
    clean = without_html_comments(body)

    links = []
    occupied = []
    for m in HTML_EMBED.finditer(clean):
        value = m.group('value')
        parts = value.split(',') if m.group(0).lower().startswith('<source') else [value]
        for part in parts:
            tokens = part.split()
            if not tokens or not tokens[0].startswith('https://'):
                continue
            links.append({'form': 'html', 'embedded': True, 'label': None,
                          'url': unescape(tokens[0]),
                          'line': clean.count('\n', 0, m.start()) + 1})
        occupied.append(m.span())

    for m in MD_LINK.finditer(clean):
        if any(start <= m.start() < end for start, end in occupied):
            continue
        url = unescape(m.group('url'))
        embedded = m.group('bang') == '!'
        if url.startswith('https://') and (
                embedded or IMG_EXT.search(urlsplit(url).path) or is_media_host_image(url)):
            links.append({'form': 'image' if embedded else 'link',
                          'embedded': embedded, 'label': m.group('label'), 'url': url,
                          'line': clean.count('\n', 0, m.start()) + 1})
        occupied.append(m.span())

    for m in URL.finditer(clean):
        if any(start <= m.start() < end for start, end in occupied):
            continue
        url = unescape(m.group(0)).rstrip(',;.!:')
        parsed = urlsplit(url)
        path = re.sub(r'(\.(?:png|gif|jpe?g|webp|svg))[,;!:].*$',
                      r'\1', parsed.path, flags=re.IGNORECASE)
        url = parsed._replace(path=path).geturl()
        if IMG_EXT.search(urlsplit(url).path) or is_media_host_image(url):
            links.append({'form': 'bare', 'embedded': False, 'label': None, 'url': url,
                          'line': clean.count('\n', 0, m.start()) + 1})
    return links


def describe(link):
    if link['form'] == 'bare':
        return f"{link['url']} (bare URL, line {link['line']})"
    if link['form'] == 'html':
        return f"{link['url']} (HTML <img>/<source>, line {link['line']})"
    return f"[{link['label']}]({link['url']})"


def main():
    if len(sys.argv) > 1:
        with open(sys.argv[1], encoding='utf-8') as f:
            body = f.read()
    else:
        body = os.environ.get('PR_BODY', '')
    if body is None:
        body = ''

    failures = []

    verdicts = section_verdicts(body)
    answered = sum(1 for v in verdicts.values() if v == 'answered')
    print(f"pr-evidence: sections: {answered}/{len(REQUIRED_SECTIONS)} answered")
    section_failed = False
    for name in REQUIRED_SECTIONS:
        if verdicts[name] == 'missing':
            failures.append(name)
            section_failed = True
            print(f"FAIL missing-section: {name}")
        elif verdicts[name] == 'empty':
            failures.append(name)
            section_failed = True
            print(f"FAIL empty-section: {name}")
    if section_failed:
        print(f"pr-evidence: the body contract is {TEMPLATE_PATH} "
              f"({' / '.join(TEMPLATE_SECTIONS)}).")
        print("pr-evidence: the global show-me /pr template "
              "(Summary/Evidence/Merge Danger) does not satisfy this gate; "
              "use the repo skill .claude/skills/pr-cairn/SKILL.md.")

    links = find_links(body)

    print(f"pr-evidence: scanned {len(links)} image link(s)")
    for link in links:
        if 'scenario' in parse_qs(urlsplit(link['url']).query, keep_blank_values=True):
            failures.append(link)
            print(f"FAIL fixture: {describe(link)}")
        if not link['embedded']:
            failures.append(link)
            print(f"FAIL not-embedded: {describe(link)}")

    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        codes = list(ex.map(lambda link: (link, http_code(link['url'])), links))
    for link, code in codes:
        if code != '200':
            failures.append(link)
            print(f"FAIL unreachable (HTTP {code}): {describe(link)}")

    if failures:
        print(f"pr-evidence: RED ({len(failures)} problem(s))")
        return 1
    print("pr-evidence: GREEN")
    return 0


if __name__ == '__main__':
    sys.exit(main())
