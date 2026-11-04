#!/usr/bin/env python3
"""#940 measure-then-change: run three link criteria over real PR bodies.

Criteria:

- old     : scripts/pr-evidence-gate.py pinned at the pre-change main tip
            (git show <PIN>:...), i.e. raw.githubusercontent image
            extensions only.
- literal : the ticket's first reading -- rule 1 (image extension, any
            host) OR rule 2 (any URL on raw.githubusercontent.com /
            user-images.githubusercontent.com /
            github.com/user-attachments).
- final   : the shipped gate (imported from the repo working tree):
            rule 1, plus rule 2 restricted to media-only hosts and
            extensionless last segments.

Corpus: the 25 most recently merged PR bodies plus every open PR body,
fetched live through gh. For each body the script reports scanned links
and not-embedded verdicts per criterion, classifies every link the
literal criterion adds, and probes reachability for links the final
criterion adds (none on the recorded run).

Reachability caveat: probes run from the invoking machine. The recording
machine's egress to GitHub flapped intermittently (curl 000 = could not
reach at all); classification of false positives is form-driven (a
reference link is a false positive regardless of its HTTP code), so the
flake does not affect the counts that matter. CI probes from GitHub
runners.

Usage: python3 docs/verify/939/measure-host-rules.py [--json out.json]
"""
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
import datetime
import concurrent.futures as cf

PIN = 'da84ed9c9da81ea1ff716416b2562d4b342d22b8'  # main tip before #939/#940
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = subprocess.run(['git', 'rev-parse', '--show-toplevel'],
                      capture_output=True, text=True, cwd=HERE,
                      check=True).stdout.strip()


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


gate = load_module('gate', os.path.join(ROOT, 'scripts', 'pr-evidence-gate.py'))

old_src = subprocess.run(['git', '-C', ROOT, 'show',
                          f'{PIN}:scripts/pr-evidence-gate.py'],
                         capture_output=True, text=True, check=True).stdout
with tempfile.NamedTemporaryFile('w', suffix='.py', delete=False) as f:
    f.write(old_src)
    old_path = f.name
old_gate = load_module('old_gate', old_path)
os.unlink(old_path)

MD_LINK = gate.MD_LINK
LIT_RULE1 = re.compile(r'https://[^\s)\]>]+\.(?:png|gif|jpe?g|webp|svg)')
LIT_RULE2 = re.compile(
    r'https://(?:raw\.githubusercontent\.com|user-images\.githubusercontent\.com'
    r'|github\.com/user-attachments)/[^\s)\]>]*')


def pair(body, matches):
    """Same pairing logic as the gate, over a prepared match list."""
    targets = {}
    for m in MD_LINK.finditer(body):
        targets[m.span('url')] = m

    def markdown_target(start, end):
        for (s, e), m in targets.items():
            if s <= start and end <= e:
                return m
        return None

    links, seen = [], set()
    for m in sorted(matches, key=lambda m: m.start()):
        md = markdown_target(m.start(), m.end())
        if md is None:
            links.append({'form': 'bare', 'embedded': False, 'label': None,
                          'url': m.group(0),
                          'line': body.count('\n', 0, m.start()) + 1})
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


def scan(body, variant):
    if variant == 'old':
        return old_gate.find_links(body)
    if variant == 'final':
        return gate.find_links(body)
    if variant == 'literal':
        matches = list(LIT_RULE1.finditer(body))
        matches += list(LIT_RULE2.finditer(body))
        # dedupe identical spans produced by both rules
        uniq, spans = [], set()
        for m in matches:
            if m.span() in spans:
                continue
            spans.add(m.span())
            uniq.append(m)
        return pair(body, uniq)
    raise ValueError(variant)


def bodies(state, limit=None):
    cmd = ['gh', 'pr', 'list', '-R', 'xiechimon/pacman', '--state', state,
           '--json', 'number,title,body']
    if limit:
        cmd += ['--limit', str(limit)]
    out = subprocess.run(cmd, capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def classify(url):
    tail = url.split('?', 1)[0].split('#', 1)[0].rsplit('/', 1)[-1]
    if not tail:
        return 'directory-permalink'
    m = re.search(r'\.([A-Za-z0-9]+)$', tail)
    return f'.{m.group(1)}-reference' if m else 'extensionless'


def main():
    merged = bodies('merged', 25)
    opened = bodies('open')
    fetched = datetime.datetime.now(datetime.timezone.utc).strftime(
        '%Y-%m-%dT%H:%M:%SZ')

    report = {'fetched': fetched, 'pin': PIN,
              'merged': [p['number'] for p in merged],
              'open': [p['number'] for p in opened],
              'per_pr': [], 'literal_new': [], 'final_new': []}

    print(f"# #940 measurement -- {fetched}")
    print(f"corpus: 25 most recently merged PRs + {len(opened)} open PRs; "
          f"old gate pinned at {PIN[:8]}\n")

    for pr in merged + opened:
        body = pr['body'] or ''
        n = pr['number']
        state = 'merged' if pr in merged else 'open'
        counts = {}
        for variant in ('old', 'literal', 'final'):
            links = scan(body, variant)
            counts[variant] = {
                'scanned': len(links),
                'not_embedded': sum(1 for l in links if not l['embedded'])}
        old_keys = {(l['url'], l['line']) for l in scan(body, 'old')}
        for variant in ('literal', 'final'):
            for l in scan(body, variant):
                if (l['url'], l['line']) not in old_keys:
                    entry = {'variant': variant, 'pr': n, 'state': state,
                             'form': l['form'], 'line': l['line'],
                             'url': l['url'], 'class': classify(l['url'])}
                    report[f'{variant}_new'].append(entry)
        sections = gate.section_verdicts(body)
        counts['sections_answered'] = sum(
            1 for v in sections.values() if v == 'answered')
        report['per_pr'].append({'pr': n, 'state': state, **counts})

    print(f"{'PR':>6} {'st':>6} | {'old':>4} {'lit':>4} {'fin':>4} scanned |"
          f" {'old':>4} {'lit':>4} {'fin':>4} not-embedded | {'sec':>3}")
    for r in report['per_pr']:
        print(f"{r['pr']:>6} {r['state']:>6} | "
              f"{r['old']['scanned']:>4} {r['literal']['scanned']:>4} "
              f"{r['final']['scanned']:>4} |"
              f" {r['old']['not_embedded']:>4} {r['literal']['not_embedded']:>4} "
              f"{r['final']['not_embedded']:>4} | "
              f"{r['sections_answered']:>3}")

    def summarize(variant):
        new = report[f'{variant}_new']
        classes = {}
        for e in new:
            classes[e['class']] = classes.get(e['class'], 0) + 1
        print(f"\n{variant}: {len(new)} newly scanned link(s); classes: "
              + (', '.join(f"{k} x{v}" for k, v in sorted(classes.items()))
                 or 'none'))
        for e in new:
            print(f"  #{e['pr']} ({e['state']}) {e['form']:>5} line {e['line']:>3}"
                  f" [{e['class']}] {e['url']}")

    summarize('literal')
    summarize('final')

    final_new = report['final_new']
    if final_new:
        print("\nreachability of links only the final criteria scan:")
        with cf.ThreadPoolExecutor(max_workers=8) as ex:
            codes = list(ex.map(
                lambda e: (e, gate.http_code(e['url'])), final_new))
        for e, code in codes:
            e['http'] = code
            print(f"  HTTP {code} #{e['pr']} {e['url']}")

    answered = [r['pr'] for r in report['per_pr']
                if r['sections_answered'] == len(gate.REQUIRED_SECTIONS)]
    print(f"\nbodies answering both #939 sections: {len(answered)} "
          f"({', '.join(map(str, answered)) or 'none'})")

    if '--json' in sys.argv:
        path = sys.argv[sys.argv.index('--json') + 1]
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(report, f, indent=1)
        print(f"json written: {path}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
