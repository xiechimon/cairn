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

spec = importlib.util.spec_from_file_location('evidence_gate', Path(__file__).with_name('pr-evidence-gate.py'))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class EvidenceGateTests(unittest.TestCase):
    def verdict(self, body, status='200'):
        output = io.StringIO()
        with patch.object(sys, 'argv', ['pr-evidence-gate.py']), patch.dict(gate.os.environ, {'PR_BODY': '## What\nUpdate evidence checks.\n## Review\nFresh review passed.\n## Risk\nReversible gate change.\n## Proof\nRegression checks.\n' + body}), patch.object(gate, 'http_code', return_value=status) as probe, contextlib.redirect_stdout(output):
            result = gate.main()
        return result, output.getvalue(), probe

    def test_body_without_links_passes(self):
        result, output, probe = self.verdict('Checks passed locally.')
        self.assertEqual(result, 0, output)
        self.assertIn('scanned 0 image link(s)', output)
        probe.assert_not_called()

    def test_reachable_embedded_external_image_passes(self):
        result, output, probe = self.verdict('![proof](https://example.org/proof.png)')
        self.assertEqual(result, 0, output)
        probe.assert_called_once_with('https://example.org/proof.png')

    def test_fixture_embeds_fail_for_the_fixture_reason(self):
        for path in ['view.png', 'view']:
            for query in ['scenario=board', 'scenario=', 'theme=dark&scenario=board', 'theme=dark&amp;scenario=board', 'theme=dark&#38;scenario=board']:
                url = f'https://example.org/{path}?{query}'
                for body in [f'![proof]({url})', f'<img src="{url}">', f'<source srcset="https://example.org/clean 1x, {url} 2x">']:
                    with self.subTest(body=body):
                        result, output, _ = self.verdict(body)
                        self.assertEqual(result, 1, output)
                        self.assertIn('FAIL fixture:', output)
                        self.assertNotIn('FAIL not-embedded:', output)
                        self.assertNotIn('FAIL unreachable', output)

    def test_extensionless_embeds_keep_their_form_and_full_url(self):
        url = 'https://raw.githubusercontent.com/xiechimon/cairn/3cca15fbe0e427154b134db0b433fc5e965119b2/docs/verify/1983/view?theme=dark&size=2#proof'
        for body, form in [(f'![proof]({url})', 'image'), (f'<img src="{url.replace("&", "&amp;")}">', 'html'), (f'<source srcset="{url} 2x">', 'html')]:
            with self.subTest(body=body):
                links = gate.find_links(body)
                self.assertEqual(len(links), 1)
                self.assertEqual(links[0]['url'], url)
                self.assertEqual(links[0]['form'], form)
                self.assertTrue(links[0]['embedded'])
                result, output, probe = self.verdict(body)
                self.assertEqual(result, 0, output)
                self.assertNotIn('FAIL not-embedded:', output)
                probe.assert_called_once_with(url)

    def test_bare_images_with_punctuation_or_adjacent_markup_fail(self):
        url = 'https://example.org/proof.png'
        for suffix in [', rendered inline', '. rendered inline', ';then', "'caption", '<br>', '!', '?theme=dark&size=2,']:
            with self.subTest(suffix=suffix):
                expected = url + '?theme=dark&size=2' if suffix.startswith('?') else url
                result, output, probe = self.verdict(f'see {url}{suffix}')
                self.assertEqual(result, 1, output)
                self.assertIn(f'FAIL not-embedded: {expected} (bare URL, line 9)', output)
                self.assertNotIn('FAIL fixture:', output)
                self.assertNotIn('FAIL unreachable', output)
                probe.assert_called_once_with(expected)

    def test_references_are_not_images(self):
        for url in ['https://github.com/xiechimon/cairn/issues/1810', 'https://raw.githubusercontent.com/xiechimon/cairn/3cca15fbe0e427154b134db0b433fc5e965119b2/docs/verify/1810/proof', 'https://example.org/file.png.txt']:
            result, output, probe = self.verdict(f'[issue]({url})')
            self.assertEqual(result, 0, output)
            self.assertEqual(gate.find_links(f'[issue]({url})'), [])
            probe.assert_not_called()

    def test_comments_embedding_media_hosts_and_http_failures(self):
        result, output, probe = self.verdict('<!-- <img src="https://example.org/view?scenario="> -->')
        self.assertEqual(result, 0, output)
        probe.assert_not_called()
        for url in ['https://example.org/proof.png?theme=dark#proof', 'https://user-images.githubusercontent.com/123/asset', 'https://github.com/user-attachments/assets/asset']:
            for body in [url, f'[proof]({url})']:
                result, output, _ = self.verdict(body)
                self.assertEqual(result, 1, output)
                self.assertIn('FAIL not-embedded:', output)
            result, output, probe = self.verdict(f'![proof]({url})', '404')
            self.assertEqual(result, 1, output)
            self.assertIn('FAIL unreachable (HTTP 404):', output)
            probe.assert_called_once_with(url)


class SectionContractTests(unittest.TestCase):
    body = '## What\nUpdate the contract.\n## Proof\nOld run failed; new run passed.\n## Review\nFresh review passed.\n## Risk\nReversible gate change.\n'

    def verdict(self, body):
        output = io.StringIO()
        with patch.object(sys, 'argv', ['pr-evidence-gate.py']), patch.dict(gate.os.environ, {'PR_BODY': body}), contextlib.redirect_stdout(output):
            result = gate.main()
        return result, output.getvalue()

    def test_untouched_new_template_fails_all_four_sections(self):
        body = '\n'.join(f'## {name}\n<!-- Guidance. -->\n' for name in ('What', 'Proof', 'Review', 'Risk'))
        result, output = self.verdict(body)
        self.assertEqual(result, 1, output)
        for name in ('What', 'Proof', 'Review', 'Risk'):
            self.assertIn(f'FAIL empty-section: {name}', output)
        self.assertIn('Proof / What / Review / Risk', output)

    def test_repository_template_is_unanswered(self):
        body = Path('.github/PULL_REQUEST_TEMPLATE.md').read_text()
        result, output = self.verdict(body)
        self.assertEqual(result, 1, output)
        self.assertEqual(gate.section_verdicts(body), dict.fromkeys(('What', 'Proof', 'Review', 'Risk'), 'empty'))

    def test_folded_review_and_risk_headings_are_found(self):
        body = '## Proof\nOld run failed; new run passed.\n## What\nUpdate the contract.\n<details><summary>Review and risk</summary>\n\n## Review\nFresh review passed.\n## Risk\nReversible gate change.\n</details>\n'
        result, output = self.verdict(body)
        self.assertEqual(result, 0, output)
        self.assertEqual(gate.section_verdicts(body), dict.fromkeys(('What', 'Proof', 'Review', 'Risk'), 'answered'))

    def test_fold_markup_does_not_answer_empty_sections(self):
        body = '## Proof\nEvidence.\n## What\n<!-- Guidance. -->\n<details><summary>Review and risk</summary>\n\n## Review\n<!-- Guidance. -->\n## Risk\n<!-- Guidance. -->\n</details>\n'
        result, output = self.verdict(body)
        self.assertEqual(result, 1, output)
        for name in ('What', 'Review', 'Risk'):
            self.assertIn(f'FAIL empty-section: {name}', output)

    def test_filled_four_section_body_passes_without_upstream_or_tasks(self):
        result, output = self.verdict(self.body)
        self.assertEqual(result, 0, output)
        self.assertIn('4/4 answered', output)

    def test_each_missing_section_fails_and_names_it(self):
        for name in ('What', 'Proof', 'Review', 'Risk'):
            with self.subTest(name=name):
                body = ''.join('## ' + section for section in self.body.split('## ') if section and not section.startswith(name + '\n'))
                result, output = self.verdict(body)
                self.assertEqual(result, 1, output)
                self.assertIn(f'FAIL missing-section: {name}', output)

    def test_verified_is_a_case_insensitive_proof_alias(self):
        result, output = self.verdict(self.body.replace('## Proof', '## vErIfIeD'))
        self.assertEqual(result, 0, output)
        self.assertIn('4/4 answered', output)

    def test_fenced_or_commented_answers_do_not_satisfy_sections(self):
        for content in ('<!-- Not an answer. -->', '```text\nAn example.\n```'):
            result, output = self.verdict(self.body.replace('Fresh review passed.', content))
            self.assertEqual(result, 1, output)
            self.assertIn('FAIL empty-section: Review', output)

    def test_complete_legacy_six_section_body_passes_without_review(self):
        body = '## What\nUpdate the gate.\n## Verified\nOld run failed; new run passed.\n## Upstream\nNo new mechanism.\n## Risk\nReversible change.\n## Acceptance\n- [x] Checks passed.\n## Issues\nRelated to #2196.\n'
        result, output = self.verdict(body)
        self.assertEqual(result, 0, output)
        self.assertEqual(gate.section_verdicts(body)['Proof'], 'answered')
        self.assertIn('legacy', output)
        for name in ('What', 'Verified', 'Upstream', 'Risk', 'Acceptance', 'Issues'):
            with self.subTest(missing=name):
                incomplete = ''.join('## ' + section for section in body.split('## ') if section and not section.startswith(name + '\n'))
                result, output = self.verdict(incomplete)
                self.assertEqual(result, 1, output)
                self.assertIn('FAIL missing-section: Review', output)
        result, output = self.verdict(body + '## Review\n<!-- Pending. -->')
        self.assertEqual(result, 1, output)
        self.assertIn('FAIL empty-section: Review', output)
        result, output = self.verdict(body.replace('## Verified', '## Proof'))
        self.assertEqual(result, 1, output)
        self.assertIn('FAIL missing-section: Review', output)

    def test_commented_legacy_headings_cannot_waive_review(self):
        body = self.body.replace('## Review\nFresh review passed.\n', '').replace('## Proof', '## Verified')
        body += '<!--\n## Upstream\nExample.\n## Acceptance\nExample.\n## Issues\nExample.\n-->'
        result, output = self.verdict(body)
        self.assertEqual(result, 1, output)
        self.assertIn('FAIL missing-section: Review', output)

    def test_optional_upstream_does_not_need_an_answer(self):
        result, output = self.verdict(self.body + '## Upstream\n<!-- Optional. -->\n')
        self.assertEqual(result, 0, output)

    def test_empty_legacy_sections_cannot_waive_review(self):
        body = '## What\nx\n## Verified\ny\n## Upstream\n\n## Risk\nz\n## Acceptance\n\n## Issues\n'
        result, output = self.verdict(body)
        self.assertEqual(result, 1, output)
        self.assertIn('FAIL missing-section: Review', output)
        for upstream, acceptance in [
            ('', '- [x] Done.'),
            ('<!-- Guidance. -->', '- [x] Done.'),
            ('```\nExample.\n```', '- [x] Done.'),
            ('No mechanism.', ''),
            ('No mechanism.', 'Prose only.'),
            ('No mechanism.', '<!--\n- [x] Hidden.\n-->'),
            ('No mechanism.', '```\n- [x] Example.\n```'),
        ]:
            with self.subTest(upstream=upstream, acceptance=acceptance):
                body = f'## What\nx\n## Verified\ny\n## Upstream\n{upstream}\n## Risk\nz\n## Acceptance\n{acceptance}\n## Issues\n'
                result, output = self.verdict(body)
                self.assertEqual(result, 1, output)
                self.assertIn('FAIL missing-section: Review', output)

    def test_inline_code_comment_opener_does_not_hide_sections(self):
        body = '## What\nThe gate skips `<!--` comments.\n## Proof\ny\n## Review\nr\n## Risk\n<!-- note --> z\n'
        result, output = self.verdict(body)
        self.assertEqual(result, 0, output)
        self.assertIn('4/4 answered', output)

    def test_fenced_comment_opener_does_not_hide_sections(self):
        body = self.body.replace('Update the contract.', 'Update the contract.\n```html\n<!--\n```')
        result, output = self.verdict(body)
        self.assertEqual(result, 0, output)

    def test_only_real_comments_hide_section_answers(self):
        for content in ('`<!-- note -->`', '``<!-- note -->``', 'Prose <!-- without a close'):
            with self.subTest(content=content):
                result, output = self.verdict(self.body.replace('Update the contract.', content))
                self.assertEqual(result, 0, output)
        result, output = self.verdict(self.body.replace('Fresh review passed.', '<!-- Unclosed.'))
        self.assertEqual(result, 1, output)
        self.assertIn('FAIL empty-section: Review', output)
        self.assertIn('FAIL missing-section: Risk', output)


class ProseCapTests(unittest.TestCase):
    def body(self, size=600, extra=''):
        return ('## Proof\n' + 'x' * (size - len('ProofWhatChange.')) + '\n' + extra
                + '\n## What\nChange.\n<details><summary>Review and risk</summary>\n\n'
                + '## Review\nReviewed.\n## Risk\nReversible.\n</details>\n')

    def verdict(self, body):
        output = io.StringIO()
        with patch.object(sys, 'argv', ['pr-evidence-gate.py']), patch.dict(gate.os.environ, {'PR_BODY': body}), patch.object(gate, 'http_code', return_value='200'), contextlib.redirect_stdout(output):
            result = gate.main()
        return result, output.getvalue()

    def test_601_visible_characters_fail_with_the_count(self):
        result, output = self.verdict(self.body(601))
        self.assertEqual(result, 1, output)
        self.assertIn('FAIL too-long: 601 characters of prose outside tables, images, code and details (limit 600)', output)

    def test_600_visible_characters_pass(self):
        result, output = self.verdict(self.body())
        self.assertEqual(result, 0, output)

    def test_long_markdown_tables_do_not_count(self):
        for table in ('| Before | After |\n| :--- | ---: |\n| ' + 'x' * 2000 + ' | y |',
                      'Before | After\n--- | ---\n' + 'x' * 2000 + ' | y',
                      '| Before |\n| --- |\n| ' + 'x' * 2000 + ' |'):
            with self.subTest(table=table[:30]):
                result, output = self.verdict(self.body(extra=table))
                self.assertEqual(result, 0, output)

    def test_pipe_in_prose_does_not_exempt_it(self):
        result, output = self.verdict(self.body(extra='x | ' + 'y' * 601))
        self.assertEqual(result, 1, output)
        self.assertIn('FAIL too-long:', output)

    def test_long_code_comments_details_and_images_do_not_count(self):
        for extra in (
            '```text\n' + 'x' * 2000 + '\n```',
            '~~~text\n' + 'x' * 2000 + '\n~~~',
            '`' + 'x' * 2000 + '`',
            '``' + 'x' * 1000 + '`' + 'x' * 1000 + '``',
            '<!-- ' + 'x' * 2000 + ' -->',
            '<details open><summary>More</summary>\n' + 'x' * 2000 + '\n</details>',
            '<DETAILS><summary>More</summary><details>' + 'x' * 1000 + '</details>' + 'x' * 1000 + '</DETAILS>',
            '\n'.join('![long image label](https://example.org/view.png)' for _ in range(100)),
            '\n'.join('<img alt="long image label" src="https://example.org/view.png">' for _ in range(100)),
        ):
            with self.subTest(extra=extra[:30]):
                result, output = self.verdict(self.body(extra=extra))
                self.assertEqual(result, 0, output)

    def test_code_cannot_open_a_details_exemption(self):
        result, output = self.verdict(self.body(601, '`<details>`'))
        self.assertEqual(result, 1, output)
        self.assertIn('FAIL too-long: 601 ', output)

    def test_text_after_details_still_counts(self):
        result, output = self.verdict(self.body(extra='<details><summary>More</summary>Hidden.</details>y'))
        self.assertEqual(result, 1, output)
        self.assertIn('FAIL too-long: 601 ', output)

    def test_links_and_formatting_count_only_visible_characters(self):
        result, output = self.verdict(self.body(595, '[**value**](https://example.org/' + 'x' * 1000 + ')'))
        self.assertEqual(result, 0, output)
        result, output = self.verdict(self.body(596, '[**value**](https://example.org/)'))
        self.assertEqual(result, 1, output)
        self.assertIn('FAIL too-long: 601 ', output)

    def test_long_legacy_six_section_body_is_exempt(self):
        body = ('## What\n' + 'x' * 2000 + '\n## Verified\nChecks passed.\n'
                + '## Upstream\nNo new mechanism.\n## Risk\nReversible.\n'
                + '## Acceptance\n- [x] Done.\n## Issues\nRelated to #2206.\n')
        for extra in ('', '## Review\nReviewed.\n'):
            with self.subTest(extra=extra):
                result, output = self.verdict(body + extra)
                self.assertEqual(result, 0, output)
        result, output = self.verdict(body.replace('## Verified', '## Proof') + '## Review\nReviewed.\n')
        self.assertEqual(result, 1, output)
        self.assertIn('FAIL too-long:', output)


def load_tests(loader, tests, pattern):
    task_spec = importlib.util.spec_from_file_location('task_tests', Path(__file__).with_name('pr-tasks-gate.test.py'))
    task_tests = importlib.util.module_from_spec(task_spec)
    task_spec.loader.exec_module(task_tests)
    tests.addTests(loader.loadTestsFromModule(task_tests))
    return tests


if __name__ == '__main__':
    unittest.main()
