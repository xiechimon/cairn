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

A URL is an image link under two parallel rules (#940):

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
   attribute (the variants a `<picture>` picks between).

Form 2 and form 3 cover the Cursor badge footer the agent injects
after `<!-- CURSOR_AGENT_PR_BODY_END -->` when it opens a PR: a
`<picture>` with two `<source>` variants and an `<img>` fallback per
link. Without them the gate red-flags every badge URL as a bare
external image link, even though GitHub renders the badge. Stripping
the footer at the lane that opens the PR is out of bounds (#1335),
so the gate has to recognize the form. Bare URLs that are not wrapped
in any of the three forms still fail.

raw.githubusercontent.com is judged by rule 1 alone: it serves every
committed file type, so an extensionless raw path (LICENSE, a directory
permalink) is a reference, and non-image evidence files (.json, .md,
.txt) cannot be embedded as images -- they are read as references, not
evidence (#750 scope). Measured on the 25 most recently merged bodies
at the time of the change, extending rule 2 to raw flagged 79 reference
links, every one a false positive (docs/verify/939/).

Fenced code blocks do not exempt image links: agents list evidence in
code fences, and an image link in a fence renders nowhere (#940 keeps
this a non-goal).

The link criteria are shared with the coordinator's reference
implementation `scratch/pr-evidence-check.py` (outside this repo): same
MD_LINK, IMG_EXT, IMG_URL, MEDIA_HOST_URL, TAIL_EXT,
is_media_host_image, same curl probe, same verdicts. Change one, change
the other. The section check lives only in this gate -- the reference
scanner sweeps PRs that predate the template.

Usage:
  PR_BODY='<pr body>' python3 scripts/pr-evidence-gate.py   # CI entry point
  python3 scripts/pr-evidence-gate.py path/to/body.md        # local testing

Exit 0 when the body passes, 1 otherwise. Findings name the section or
the URL (with its line for bare URLs).
"""
import os
import re
import subprocess
import sys
import concurrent.futures as cf

# Shared with scratch/pr-evidence-check.py -- keep byte-identical.
MD_LINK = re.compile(r'(?P<bang>!?)\[(?P<label>[^\]]*)\]\((?P<url>[^)\s]+)\)')
IMG_EXT = r'(?:png|gif|jpe?g|webp|svg)'
IMG_URL = re.compile(r'https://[^\s)\]>"`]+\.' + IMG_EXT)
MEDIA_HOST_URL = re.compile(
    r'https://(?:user-images\.githubusercontent\.com'
    r'|github\.com/user-attachments)/[^\s)\]>"`]*')
TAIL_EXT = re.compile(r'\.[A-Za-z0-9]+$')


def is_media_host_image(url):
    """True when a media-host URL is extensionless: an uploaded asset.

    A media-host URL that does carry an extension is judged by rule 1
    instead (an image extension) or ignored (anything else), so the two
    rules never double-count one URL.
    """
    path = url.split('?', 1)[0].split('#', 1)[0]
    last = path.rsplit('/', 1)[-1]
    return bool(last) and not TAIL_EXT.search(last)


# HTML embedding (#1335): `<img src="...">` and `<source srcset="...">`
# render the URL as an image, the same as markdown `![label](url)`. The
# Cursor badge footer the agent injects after `<!-- CURSOR_AGENT_PR_BODY_END -->`
# is a `<picture>` with two `<source>` variants and an `<img>` fallback per
# link. The opening `<picture>` and the closing `</picture>` are not
# matched here -- only the attribute values that actually carry the URL.
# Quotes must balance (single or double) so an attribute containing a stray
# quote cannot leak into the next attribute.
HTML_EMBED = re.compile(
    r'<(?P<tag>img|source)\b[^>]*?\s(?P<attr>src|srcset)'
    r'=(?P<quote>["\'])(?P<value>[^"\']*?)(?P=quote)',
    re.IGNORECASE | re.DOTALL)


def html_embed_spans(body):
    """Byte spans of URLs embedded via `<img src>` or `<source srcset>`.

    Returns a set of (start, end) offsets into `body`, one per URL
    fragment inside an attribute value. `srcset` may carry
    comma-separated URLs (descriptors are rare on badges but allowed
    by HTML); each one is its own span.
    """
    spans = set()
    for m in HTML_EMBED.finditer(body):
        cursor = m.start('value')
        for part in m.group('value').split(','):
            part = part.strip()
            spans.add((cursor, cursor + len(part)))
            cursor += len(part) + 1  # +1 for the comma separator
    return spans


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
    """
    targets = {}
    for m in MD_LINK.finditer(body):
        start, end = m.span('url')
        targets[(start, end)] = m

    def markdown_target(start, end):
        for (s, e), m in targets.items():
            if s <= start and end <= e:
                return m
        return None

    html_embed = html_embed_spans(body)

    matches = list(IMG_URL.finditer(body))
    matches += [m for m in MEDIA_HOST_URL.finditer(body)
                if is_media_host_image(m.group(0))]
    matches.sort(key=lambda m: m.start())

    links = []
    seen = set()
    for m in matches:
        ms, me = m.start(), m.end()
        if (ms, me) in html_embed:
            links.append({'form': 'html', 'embedded': True, 'label': None,
                          'url': m.group(0),
                          'line': body.count('\n', 0, ms) + 1})
            continue
        md = markdown_target(ms, me)
        if md is None:
            links.append({'form': 'bare', 'embedded': False, 'label': None,
                          'url': m.group(0),
                          'line': body.count('\n', 0, ms) + 1})
            continue
        span = md.span('url')
        if span in seen:
            continue
        seen.add(span)
        links.append({'form': 'image' if md.group('bang') == '!' else 'link',
                      'embedded': md.group('bang') == '!',
                      'label': md.group('label'),
                      'url': body[span[0]:span[1]],
                      'line': body.count('\n', 0, md.start()) + 1})
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
              "use the repo skill .claude/skills/pr-pacman/SKILL.md.")

    links = find_links(body)

    print(f"pr-evidence: scanned {len(links)} image link(s)")
    for link in links:
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
