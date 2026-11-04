#!/usr/bin/env python3
"""PR tasks gate (#1240, #2196): no task anywhere in the body may be unchecked.

No section or task is required. Bodies with no tasks and bodies whose tasks
are all checked pass. Fenced code blocks and HTML comments are ignored;
findings retain the task's original 1-based line number in the whole body.

A task-list item has a -, *, + or ordered-list marker followed by [x], [X]
or [ ]. Nested items and tasks with empty text count too.

Usage:
  PR_BODY='<pr body>' python3 scripts/pr-tasks-gate.py
  python3 scripts/pr-tasks-gate.py path/to/body.md

Exit 0 when the body passes, 1 otherwise. The summary retains the pr-tasks:
prefix, and each unchecked item emits FAIL unchecked-task with its line.
"""
import os
import sys

from pr_body import TASK, visible_markdown


def tasks(body):
    out = []
    for line_number, line in enumerate(visible_markdown(body).split('\n'), 1):
        match = TASK.match(line)
        if match:
            out.append((match.group(1) != ' ', match.group(2).strip(), line_number))
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
    for checked, text, line in tasks(body):
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
