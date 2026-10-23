#!/usr/bin/env python3
"""PR tasks gate (#1240): the PR body's Acceptance section must carry at
least one task-list item, and no task may be unchecked at merge time.

What happened: PRs merged with unchecked `- [ ]` boxes (#1234, #1235) and
with prose-only Acceptance bullets that carry no machine-judgeable
completion signal (#1229, #1233). The user's ruling: 「有些 pr tasks 你都
没做完你就 merge 了，以后不要出现了」.

The gate judges only the `## Acceptance` section, extracted with the same
parsing as pr-evidence-gate.py: fence-stripped text (a checklist quoted in
a fenced code block is not live), literal case-insensitive H2 match on the
template's section name (first match wins), content running to the next H2
or EOF, HTML comments stripped before scanning (the template ships its
guidance as comments, so an untouched template fails via its live seed
task, not via its comments).

Rules:

1. Missing Acceptance heading -> RED no-tasks.
2. Section present but zero task items after stripping comments and
   fences -> RED no-tasks. Prose bullets do not satisfy existence; this
   is the intended behavior change vs #1229/#1233-style bodies.
3. Any unchecked task -> RED unchecked-task, one line per offender, with
   its absolute line number in the whole body.
4. At least one task, all checked -> GREEN.

A task line is any GitHub task-list item: a `-`, `*`, `+` or ordered-list
marker followed by `[x]` or `[ ]`, at any indentation depth. `[x]` and
`[X]` are checked. A checkbox with
empty text counts as a task. The exemption form `- [x] no task surface:
<reason>` is just a checked task; it satisfies existence by construction
and its truthfulness is a reviewer judgment, not a gate judgment.

The gate binds open PRs only: the `pull_request` trigger never fires on
merged PRs (same fact pr-evidence inherited from #939), so post-merge
body edits are never re-judged.

The parsing regexes are shared with scripts/pr-evidence-gate.py -- keep
identical. No cross-file import; scripts/ is not a package.

Usage:
  PR_BODY='<pr body>' python3 scripts/pr-tasks-gate.py   # CI entry point
  python3 scripts/pr-tasks-gate.py path/to/body.md        # local testing

Exit 0 when the body passes, 1 otherwise. Output lines carry the
`pr-tasks:` prefix so they are distinguishable from pr-evidence lines in
the same job log.
"""
import os
import re
import sys

# Shared with scripts/pr-evidence-gate.py -- keep identical.
H2 = re.compile(r'^##[ \t]+(.+?)[ \t]*$', re.M)
HTML_COMMENT = re.compile(r'<!--.*?-->', re.S)
FENCE = re.compile(r'^ {0,3}(?:```|~~~)')

SECTION_NAME = 'Acceptance'
TEMPLATE_PATH = '.github/PULL_REQUEST_TEMPLATE.md'
TEMPLATE_SECTIONS = ('What', 'Verified', 'Upstream', 'Risk', 'Acceptance',
                     'Issues')
TASK = re.compile(
    r'^[ \t]*(?:[-*+]|\d+\.)[ \t]+\[([ xX])\][ \t]*(.*)$')


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


def acceptance_section(body):
    """The Acceptance section's content, fence-stripped, or None.

    First case-insensitive literal H2 match wins; content runs to the
    next H2 or EOF. Same extraction as pr-evidence-gate.py.
    """
    text = without_fences(body)
    headers = [(m.start(), m.end(), m.group(1).strip())
               for m in H2.finditer(text)]
    for i, (_, hend, heading) in enumerate(headers):
        if heading.lower() == SECTION_NAME.lower():
            nxt = headers[i + 1][0] if i + 1 < len(headers) else len(text)
            return text[hend:nxt]
    return None


def section_line_offset(body):
    """Line number (1-based) where the Acceptance section content starts.

    Computed on the fence-stripped text so reported line numbers match
    the original body's line count (without_fences preserves it).
    """
    text = without_fences(body)
    for m in H2.finditer(text):
        if m.group(1).strip().lower() == SECTION_NAME.lower():
            return text.count('\n', 0, m.end()) + 1
    return 1


def tasks(section, section_first_line):
    """Task items in a section: (checked, text, absolute_line)."""
    out = []
    stripped = HTML_COMMENT.sub('', section)
    offset = section.count('\n') - stripped.count('\n')  # never positive here
    # HTML_COMMENT.sub can merge lines (comments spanning lines); line
    # numbers are computed per surviving line by re-splitting.
    for i, line in enumerate(stripped.split('\n')):
        m = TASK.match(line)
        if m:
            out.append((m.group(1) != ' ', m.group(2).strip(),
                        section_first_line + i))
    return out


def main():
    if len(sys.argv) > 1:
        with open(sys.argv[1], encoding='utf-8') as f:
            body = f.read()
    else:
        body = os.environ.get('PR_BODY', '')
    if body is None:
        body = ''

    failures = 0

    section = acceptance_section(body)
    if section is None:
        failures += 1
        print("FAIL no-tasks: Acceptance section is missing")
        print(f"pr-tasks: the body contract is {TEMPLATE_PATH} "
              f"({' / '.join(TEMPLATE_SECTIONS)}); its Acceptance section "
              "must carry at least one task-list item, all checked.")
        print("pr-tasks: see .claude/skills/pr-cairn/SKILL.md.")
    else:
        items = tasks(section, section_line_offset(body))
        if not items:
            failures += 1
            print("FAIL no-tasks: Acceptance section carries no task-list "
                  "item (prose bullets do not count; quote the ticket's "
                  "acceptance checklist as `- [x]` items, or write "
                  "`- [x] no task surface: <reason>` when there is none)")
        for checked, text, line in items:
            if not checked:
                failures += 1
                snippet = text[:60] if text else '(empty text)'
                print(f"FAIL unchecked-task: line {line}: {snippet}")

    if failures:
        print(f"pr-tasks: RED ({failures} problem(s))")
        return 1
    print("pr-tasks: GREEN")
    return 0


if __name__ == '__main__':
    sys.exit(main())
