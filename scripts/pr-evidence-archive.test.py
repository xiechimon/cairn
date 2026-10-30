import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('gate', Path(__file__).with_name('pr-evidence-gate.py'))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

SHA = '3cca15fbe0e427154b134db0b433fc5e965119b2'


class ArchiveTests(unittest.TestCase):
    def run_gate(self, content, messages=('Closes #1983',), repository='xiechimon/cairn'):
        with tempfile.TemporaryDirectory() as directory:
            body = Path(directory, 'body.md')
            body.write_text('## Upstream\nIndependent.\n## Verified\n' + content)
            context = Path(directory, 'context.json')
            context.write_text(json.dumps({'repository': repository, 'commits': [
                {'commit': {'message': message}} for message in messages]}))
            output = io.StringIO()
            with patch.object(sys, 'argv', ['gate', str(body), str(context)]), patch.object(
                gate, 'http_code', return_value='200'
            ), contextlib.redirect_stdout(output), patch.dict(os.environ, {}, clear=True):
                result = gate.main()
            return result, output.getvalue()

    def test_fixture_query_still_fails_in_valid_archive(self):
        result, output = self.run_gate(f'<img src="https://raw.githubusercontent.com/xiechimon/cairn/{SHA}/docs/verify/1983/proof?theme=dark&amp;scenario=board">')
        self.assertEqual(result, 1, output)
        self.assertIn('FAIL fixture:', output)

    def test_full_url_commit_association(self):
        result, output = self.run_gate(
            f'![proof](https://raw.githubusercontent.com/xiechimon/cairn/{SHA}/docs/verify/1983/proof)',
            ('Closes https://github.com/xiechimon/cairn/issues/1983',))
        self.assertEqual(result, 0, output)

    def test_reachable_embedded_images_do_not_require_an_archive(self):
        for url in [
            'https://user-images.githubusercontent.com/123/proof.png',
            'https://github.com/user-attachments/assets/123',
            'https://example.org/proof.png',
            f'https://raw.githubusercontent.com/xiechimon/cairn/{SHA}/proof.png',
            f'https://raw.githubusercontent.com/other/repo/{SHA}/docs/verify/1983/proof.png',
            f'https://raw.githubusercontent.com/xiechimon/cairn/{SHA}/docs/verify/999/proof.png',
            f'https://raw.githubusercontent.com/xiechimon/cairn/{SHA}/docs/verify/1983/../999/proof.png',
            'https://raw.githubusercontent.com/xiechimon/cairn/../docs/verify/1983/proof.png',
            f'https://raw.githubusercontent.com/xiechimon/cairn/{SHA}/docs/verify/1983/%2e%2e/999/proof.png',
            'https://img.shields.io/anything/proof.png',
            'https://cursor.com/assets/images/proof.png',
            'https://cursor.com/assets/images/open-in-web-dark.png/extra.png',
        ]:
            with self.subTest(url=url):
                result, output = self.run_gate(f'![proof]({url})')
                self.assertEqual(result, 0, output)
                self.assertNotIn('FAIL unreachable', output)

    def test_commit_only_association_and_multiple_issues(self):
        for issue in [1983, 1810]:
            for suffix in ['proof.png', 'proof']:
                url = f'https://raw.githubusercontent.com/xiechimon/cairn/{SHA}/docs/verify/{issue}/{suffix}'
                for image in [f'![proof]({url})', f'<img src="{url}">', f'<source srcset="{url} 2x">']:
                    result, output = self.run_gate(image,
                        ('Implement provenance\n\nCloses #1983, fixes xiechimon/cairn#1810',))
                    self.assertEqual(result, 0, output)

    def test_images_do_not_require_issue_association(self):
        for messages in [(), ('Refs #1983',), ('Closes other/repo#1983',)]:
            result, output = self.run_gate(
                f'![proof](https://raw.githubusercontent.com/xiechimon/cairn/{SHA}/docs/verify/1983/proof.png)', messages)
            self.assertEqual(result, 0, output)

    def test_images_do_not_require_repository_context(self):
        result, output = self.run_gate(
            f'![proof](https://raw.githubusercontent.com/xiechimon/cairn/{SHA}/docs/verify/1983/proof.png)', repository='')
        self.assertEqual(result, 0, output)

    def test_references_and_supported_badges_pass_without_issue_context(self):
        result, output = self.run_gate('''[issue](https://github.com/xiechimon/cairn/issues/1810)
[document](https://raw.githubusercontent.com/xiechimon/cairn/{SHA}/docs/verify/999/README.md)
[JSON](https://raw.githubusercontent.com/xiechimon/cairn/{SHA}/docs/verify/999/result.json)
[log](https://example.org/test.log)
<picture><source srcset="https://img.shields.io/badge/dark.svg 2x, https://img.shields.io/badge/light.svg 1x"><img src="https://img.shields.io/badge/pass.svg"></picture>''', ())
        self.assertEqual(result, 0, output)
        self.assertIn('scanned 3 image link(s)', output)

    def test_cursor_badges_pass_without_issue_context(self):
        for destination in ['web', 'cursor']:
            for theme in ['dark', 'light']:
                result, output = self.run_gate(
                    f'<img src="https://cursor.com/assets/images/open-in-{destination}-{theme}.png">', ())
                self.assertEqual(result, 0, output)

    def test_screenshots_do_not_require_a_context_argument(self):
        with patch.object(sys, 'argv', ['gate']), patch.dict(os.environ, {
            'PR_BODY': f'## Upstream\nIndependent.\n## Verified\n![proof](https://raw.githubusercontent.com/xiechimon/cairn/{SHA}/docs/verify/1983/proof.png)'
        }, clear=True), patch.object(gate, 'http_code', return_value='200'), contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(gate.main(), 0)

    def test_html_extensionless_image_is_checked_without_an_archive(self):
        result, output = self.run_gate('<img src="https://example.org/proof">')
        self.assertEqual(result, 0, output)

    def test_reachable_images_do_not_require_commit_pinning(self):
        for ref in ['main', 'dev', 'v1.0.0', 'abc1234', 'release/v1', 'refs/heads/main']:
            with self.subTest(ref=ref):
                result, output = self.run_gate(
                    f'![proof](https://raw.githubusercontent.com/xiechimon/cairn/{ref}/docs/verify/1983/proof.png)')
                self.assertEqual(result, 0, output)
        for ref in [SHA, 'a' * 64]:
            with self.subTest(ref=ref):
                result, output = self.run_gate(
                    f'![proof](https://raw.githubusercontent.com/xiechimon/cairn/{ref}/docs/verify/1983/proof.png)')
                self.assertEqual(result, 0, output)


class WorkflowTests(unittest.TestCase):
    def test_fresh_api_context_reaches_gate(self):
        workflow = Path('.github/workflows/pr-evidence.yml').read_text()
        step = workflow.split('- name: Read the PR as it is now\n', 1)[1]
        script = step.split('        run: |\n', 1)[1].split('        id: pr', 1)[0]
        script = '\n'.join(line[10:] for line in script.splitlines())
        with tempfile.TemporaryDirectory() as directory:
            gh = Path(directory, 'gh')
            gh.write_text('#!/usr/bin/env python3\nimport json, sys\n'
                          'if "--paginate" in sys.argv and "--slurp" in sys.argv:\n'
                          ' print(json.dumps([[{"commit":{"message":"Unrelated change"}}], [{"commit":{"message":"Closes #1983"}}]]))\n'
                          'else:\n'
                          ' print(json.dumps({"body":"fresh", "base":{"repo":{"full_name":"xiechimon/cairn"}}, "labels":[], "draft":False}))\n')
            gh.chmod(0o755)
            env = {**os.environ, 'PATH': directory + os.pathsep + os.environ['PATH'],
                   'RUNNER_TEMP': directory, 'GITHUB_OUTPUT': str(Path(directory, 'output')),
                   'GITHUB_REPOSITORY': 'xiechimon/cairn', 'PR_NUMBER': '1'}
            subprocess.run(['bash', '-e', '-c', script], env=env, check=True)
            context = json.loads(Path(directory, 'pr-evidence-context.json').read_text())
            self.assertEqual(context['repository'], 'xiechimon/cairn')
            self.assertEqual(context['commits'][1]['commit']['message'], 'Closes #1983')
        self.assertIn('scripts/pr-evidence-gate.py "$RUNNER_TEMP/pr-body.md" "$RUNNER_TEMP/pr-evidence-context.json"', workflow)

    def test_regressions_run_in_both_prepush_plans(self):
        result = subprocess.run(['node', '--input-type=module', '-e',
            "import { prepushPlan } from './scripts/prepush.mjs'; console.log(JSON.stringify(['local','ci'].map(mode => prepushPlan(['scripts/pr-evidence-gate.py'], mode))));"],
            text=True, capture_output=True, check=True)
        for plan in json.loads(result.stdout):
            self.assertIn(['python3', 'scripts/pr-evidence-archive.test.py'], plan)


if __name__ == '__main__':
    unittest.main()
