import contextlib
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('tasks_gate', Path(__file__).with_name('pr-tasks-gate.py'))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class TasksGateTests(unittest.TestCase):
    def verdict(self, body):
        output = io.StringIO()
        with patch.object(sys, 'argv', ['pr-tasks-gate.py']), patch.dict(os.environ, {'PR_BODY': body}), contextlib.redirect_stdout(output):
            result = gate.main()
        return result, output.getvalue()

    def test_no_sections_or_tasks_are_required(self):
        for body in ('', 'No tasks.', '## Risk\nReversible change.', '## Acceptance\nProse only.'):
            with self.subTest(body=body):
                result, output = self.verdict(body)
                self.assertEqual(result, 0, output)
                self.assertIn('pr-tasks: GREEN', output)

    def test_checked_tasks_pass_anywhere(self):
        result, output = self.verdict('- [x] First.\n## Risk\n* [X] Second.\n  1. [x] Nested.')
        self.assertEqual(result, 0, output)

    def test_unchecked_tasks_fail_anywhere_with_source_lines(self):
        body = '- [ ] Before sections.\n## What\n* [ ] Change.\n## Proof\n+ [ ] Evidence.\n## Review\n  1. [ ] Review.\n## Risk\n2) [ ] Risk.\n## Extra\n- [ ]\n'
        result, output = self.verdict(body)
        self.assertEqual(result, 1, output)
        for line, text in [(1, 'Before sections.'), (3, 'Change.'), (5, 'Evidence.'), (7, 'Review.'), (9, 'Risk.'), (11, '(empty text)')]:
            self.assertIn(f'FAIL unchecked-task: line {line}: {text}', output)
        self.assertIn('pr-tasks: RED (6 problem(s))', output)

    def test_fenced_and_commented_tasks_are_ignored_without_shifting_lines(self):
        body = '<!--\n- [ ] Hidden.\n```\n-->\n```markdown\n- [ ] Example.\n~~~\n```\n~~~markdown\n- [ ] Another example.\n~~~\n<!-- Inline. -->\n- [ ] Live.\n'
        result, output = self.verdict(body)
        self.assertEqual(result, 1, output)
        self.assertIn('FAIL unchecked-task: line 13: Live.', output)
        self.assertIn('pr-tasks: RED (1 problem(s))', output)
        self.assertNotIn('Hidden.', output)
        self.assertNotIn('Example.', output)

    def test_only_examples_pass(self):
        for body in ('```\n- [ ] Example.\n```', '<!--\n- [ ] Hidden.\n-->', '~~~~\n- [ ] Example.\n~~~\n- [ ] Still fenced.\n~~~~'):
            result, output = self.verdict(body)
            self.assertEqual(result, 0, output)

    def test_comment_delimiters_inside_fences_do_not_hide_live_tasks(self):
        body = '```html\n<!--\n```\n- [ ] Live.\n<!-- Other comment. -->\n'
        result, output = self.verdict(body)
        self.assertEqual(result, 1, output)
        self.assertIn('FAIL unchecked-task: line 4: Live.', output)

    def test_unclosed_html_comment_is_not_a_live_task(self):
        for indent in ('', ' ', '   '):
            result, output = self.verdict(indent + '<!--\n- [ ] Hidden.')
            self.assertEqual(result, 0, output)

    def test_inline_code_comment_opener_does_not_hide_pending_task(self):
        body = '## What\nThe gate skips `<!--` comments.\n- [ ] pending\n'
        result, output = self.verdict(body)
        self.assertEqual(result, 1, output)
        self.assertIn('FAIL unchecked-task: line 3: pending', output)

    def test_only_line_start_or_closed_inline_comments_hide_tasks(self):
        for prefix in ('Text <!--', '    <!--', '`<!--`', '``<!--``', '`<!-- -->`'):
            with self.subTest(prefix=prefix):
                result, output = self.verdict(prefix + '\n- [ ] pending\n')
                self.assertEqual(result, 1, output)
                self.assertIn('FAIL unchecked-task: line 2: pending', output)
        result, output = self.verdict('- [ ] <!-- pending --> still pending\n')
        self.assertEqual(result, 1, output)
        self.assertIn('still pending', output)

    def test_empty_line_start_comment_closes_on_its_own_line(self):
        for comment in ('<!-->', '<!--->', '  <!--->'):
            with self.subTest(comment=comment):
                result, output = self.verdict(comment + '\n- [ ] pending\n')
                self.assertEqual(result, 1, output)
                self.assertIn('FAIL unchecked-task: line 2: pending', output)

    def test_blockquoted_tasks_fail_with_source_lines(self):
        for prefix in ('> ', '>', '> > ', '>>', '  >\t> '):
            with self.subTest(prefix=prefix):
                result, output = self.verdict('## What\n' + prefix + '- [ ] item\n')
                self.assertEqual(result, 1, output)
                self.assertIn('FAIL unchecked-task: line 2: item', output)
                result, output = self.verdict(prefix + '- [x] item\n')
                self.assertEqual(result, 0, output)

    def test_file_and_environment_entry_points_agree(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, 'body.md')
            for body, expected in [('No tasks.', 0), ('- [ ] Pending.', 1)]:
                path.write_text(body)
                result = subprocess.run([sys.executable, str(Path(gate.__file__)), str(path)], text=True, capture_output=True)
                self.assertEqual(result.returncode, expected, result.stdout)
                self.assertEqual((result.returncode, result.stdout), self.verdict(body))


class WorkflowTaskGuardTests(unittest.TestCase):
    def test_only_existing_decision_labels_disarm_auto_merge(self):
        workflow = Path('.github/workflows/pr-evidence.yml').read_text()
        script = workflow.split('- name: Mark the decision pending and disarm auto-merge\n', 1)[1].split('        run: |\n', 1)[1]
        script = '\n'.join(line[10:] for line in script.splitlines())
        for task_log, pending, expected_label, expected_disarm in [
            ('FAIL unchecked-task: line 3: Pending.', False, False, False),
            ('FAIL unchecked-task: line 3: Pending.', True, False, True),
            ('pr-tasks: GREEN', False, False, False),
            ('pr-tasks: GREEN', True, False, True),
            ('pr-tasks: RED (1 problem(s))', False, False, False),
        ]:
            with self.subTest(task_log=task_log, pending=pending), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                root.joinpath('pr-tasks.log').write_text(task_log)
                if pending:
                    root.joinpath('needs-decision.flag').touch()
                gh = root.joinpath('gh')
                gh.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$GH_CALLS"\n')
                gh.chmod(0o755)
                calls = root.joinpath('calls')
                env = {**os.environ, 'PATH': directory + os.pathsep + os.environ['PATH'], 'GH_CALLS': str(calls), 'GITHUB_REPOSITORY': 'xiechimon/cairn', 'PR_NUMBER': '2196'}
                result = subprocess.run(['bash', '-e', '-c', script], cwd=directory, env=env, text=True, capture_output=True)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                commands = calls.read_text() if calls.exists() else ''
                self.assertEqual('--add-label needs-decision' in commands, expected_label, commands)
                self.assertEqual('--disable-auto' in commands, expected_disarm, commands)


if __name__ == '__main__':
    unittest.main()
