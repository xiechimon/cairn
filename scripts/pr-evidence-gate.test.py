import contextlib
import importlib.util
import io
import json
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
            inline = url.startswith('https://github.com/user-attachments/')
            for body in [f'see {url} here' if inline else url, f'[proof]({url})']:
                result, output, _ = self.verdict(body)
                self.assertEqual(result, 1, output)
                self.assertIn('FAIL not-embedded:', output)
            result, output, probe = self.verdict(f'![proof]({url})', '404')
            self.assertEqual(result, 1, output)
            self.assertIn('FAIL unreachable (HTTP 404):', output)
            probe.assert_called_once_with(url)

    def test_an_attachment_alone_on_its_line_is_embedded_media(self):
        url = 'https://github.com/user-attachments/assets/abe9e1f4-e0e1-4774-a315-68e1c073152f'
        for body in [url, f'Recording:\n\n{url}\n\nFrames below.', f'  {url}  ']:
            with self.subTest(body=body):
                links = gate.find_links(body)
                self.assertEqual([(link['form'], link['embedded'], link['url']) for link in links], [('media', True, url)])
                result, output, probe = self.verdict(body)
                self.assertEqual(result, 0, output)
                probe.assert_called_once_with(url)

    def test_an_unpublished_attachment_alone_on_its_line_is_unreachable(self):
        url = 'https://github.com/user-attachments/assets/abe9e1f4-e0e1-4774-a315-68e1c073152f'
        result, output, _ = self.verdict(url, '404')
        self.assertEqual(result, 1, output)
        self.assertIn('FAIL unreachable (HTTP 404):', output)
        self.assertNotIn('FAIL not-embedded:', output)

    def test_other_bare_media_alone_on_a_line_still_fails(self):
        for url in ['https://example.org/proof.png', 'https://user-images.githubusercontent.com/123/asset']:
            with self.subTest(url=url):
                result, output, _ = self.verdict(url)
                self.assertEqual(result, 1, output)
                self.assertIn('FAIL not-embedded:', output)

    def test_reachability_follows_redirects_to_the_final_answer(self):
        completed = subprocess.CompletedProcess([], 0, stdout='200', stderr='')
        with patch.object(gate.subprocess, 'run', return_value=completed) as run:
            self.assertEqual(gate.http_code('https://github.com/user-attachments/assets/a'), '200')
        self.assertIn('-L', run.call_args.args[0])


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


class SchemaGlanceTests(unittest.TestCase):
    table = ('### Schema changes\n\n| table | change | detail |\n|---|---|---|\n'
             '| `tasks` | + due_at | integer |\n| `tasks` | - legacy | text |\n')
    base = '## Proof\nOld run failed; new run passed.\n## What\nAdd a column.\n## Review\nReviewed.\n## Risk\nReversible.\n'

    def verdict(self, body, expected=None):
        output = io.StringIO()
        with tempfile.TemporaryDirectory() as directory:
            argv = ['pr-evidence-gate.py']
            if expected is not None:
                path = Path(directory, 'schema-glance.md')
                path.write_text(expected)
                argv += ['--schema-glance', str(path)]
            with patch.object(sys, 'argv', argv), patch.dict(gate.os.environ, {'PR_BODY': body}), contextlib.redirect_stdout(output):
                result = gate.main()
        return result, output.getvalue()

    def test_drizzle_body_without_the_table_is_red(self):
        result, output = self.verdict(self.base, self.table)
        self.assertEqual(result, 1, output)
        self.assertIn('FAIL schema-changes: missing', output)

    def test_stale_table_is_red(self):
        stale = self.table.replace('+ due_at | integer', '+ due_at | text')
        result, output = self.verdict(self.base + stale, self.table)
        self.assertEqual(result, 1, output)
        self.assertIn('FAIL schema-changes: stale', output)

    def test_current_table_is_green(self):
        result, output = self.verdict(self.base + self.table, self.table)
        self.assertEqual(result, 0, output)
        self.assertIn('schema-changes: matches', output)

    def test_table_inside_details_counts(self):
        body = self.base + '<details><summary>Schema</summary>\n\n' + self.table + '\n</details>\n'
        result, output = self.verdict(body, self.table)
        self.assertEqual(result, 0, output)

    def test_extra_or_reordered_rows_are_red(self):
        rows = self.table.splitlines()
        reordered = '\n'.join(rows[:4] + [rows[5], rows[4]]) + '\n'
        for body_table in (reordered, self.table + '| `tasks` | + extra | text |\n'):
            result, output = self.verdict(self.base + body_table, self.table)
            self.assertEqual(result, 1, output)
            self.assertIn('FAIL schema-changes: stale', output)

    def test_no_schema_changes_output_requires_the_heading_and_text(self):
        expected = '### Schema changes\n\nNo schema changes\n'
        result, output = self.verdict(self.base + expected, expected)
        self.assertEqual(result, 0, output)
        result, output = self.verdict(self.base, expected)
        self.assertEqual(result, 1, output)

    def test_trailing_prose_and_table_after_the_schema_table_are_ignored(self):
        trailing = '\nVerified against the live stack:\n\n| step | result |\n|---|---|\n| migrate | ok |\n'
        result, output = self.verdict(self.base + self.table + trailing, self.table)
        self.assertEqual(result, 0, output)
        self.assertIn('schema-changes: matches', output)

    def test_only_the_first_table_block_counts(self):
        second = '\n| table | change | detail |\n|---|---|---|\n| `x` | + y | text |\n'
        result, output = self.verdict(self.base + self.table + second, self.table)
        self.assertEqual(result, 0, output)

    def test_no_schema_changes_line_ignores_a_following_table(self):
        expected = '### Schema changes\n\nNo schema changes\n'
        body = self.base + expected + '\nChecked:\n\n| a | b |\n|---|---|\n| 1 | 2 |\n'
        result, output = self.verdict(body, expected)
        self.assertEqual(result, 0, output)

    def test_stale_and_missing_messages_name_the_sync_helper(self):
        stale = self.table.replace('+ due_at | integer', '+ due_at | text')
        for body in (self.base + stale, self.base):
            result, output = self.verdict(body, self.table)
            self.assertEqual(result, 1, output)
            self.assertIn('scripts/pr-schema-sync.mjs <pr-number>', output)

    def test_non_drizzle_body_is_unaffected(self):
        result, output = self.verdict(self.base)
        self.assertEqual(result, 0, output)
        self.assertNotIn('schema-changes', output)
        result, output = self.verdict(self.base + self.table)
        self.assertEqual(result, 0, output)

    def test_workflow_passes_the_base_copy_output(self):
        workflow = Path('.github/workflows/pr-evidence.yml').read_text()
        self.assertIn('git show "$BASE_SHA:scripts/schema-glance.mjs"', workflow)
        self.assertIn('--schema-glance', workflow)


class EvidenceCardTests(unittest.TestCase):
    sections = '## What\nAdd an endpoint.\n## Review\nReviewed.\n## Risk\nReversible.\n'
    lines = '```text\nLive: isolated verify stack on the PR head.\nMocked: none.\nNot covered: two real browsers.\n```\n'
    internal = ('### Requirement\n\n[#3104](https://github.com/xiechimon/cairn/issues/3104)\n\n'
                '> must survive closing the app and reopening it on any device\n\n')
    third_party = ('### Requirement\n\nThird-party: [E2B sandbox API](https://e2b.dev/docs/sandbox)\n\n')
    doc_shot = '![Official doc](https://example.org/doc.png)\n\n'
    requests = ('### Requests\n\n![Swagger request and response](https://example.org/call.png)\n\n'
                '| Clause | Request | Response | Rows | OK |\n|---|---|---|---|---|\n'
                '| Before | `GET /drafts/x` | `404` | table absent | - |\n'
                '| survives close | `PUT /drafts/x` | `200 {"content":"a"}` | 0 to 1 | yes |\n\n')

    def verdict(self, proof, changed=('apps/server/src/routes-drafts.ts',)):
        output = io.StringIO()
        with tempfile.TemporaryDirectory() as directory:
            argv = ['pr-evidence-gate.py']
            if changed is not None:
                path = Path(directory, 'changed.txt')
                path.write_text('\n'.join(changed) + '\n')
                argv += ['--changed-files', str(path)]
            body = '## Proof\n' + proof + '\n' + self.sections
            with patch.object(sys, 'argv', argv), patch.dict(gate.os.environ, {'PR_BODY': body}), patch.object(gate, 'http_code', return_value='200'), contextlib.redirect_stdout(output):
                result = gate.main()
        return result, output.getvalue()

    def card(self, requirement=None, requests=None, lines=None):
        return ((self.internal if requirement is None else requirement)
                + (self.requests if requests is None else requests)
                + (self.lines if lines is None else lines))

    def test_routes_change_without_a_card_fails(self):
        result, output = self.verdict('Old run failed; new run passed.\n' + self.lines)
        self.assertEqual(result, 1, output)
        self.assertIn("FAIL api-card: missing '### Requirement' section", output)
        self.assertIn("FAIL api-card: missing '### Requests' section", output)

    def test_routes_change_with_a_card_passes(self):
        result, output = self.verdict(self.card())
        self.assertEqual(result, 0, output)
        self.assertIn('pr-evidence: api-card: complete', output)

    def test_every_routes_file_triggers_the_card(self):
        for path in ['apps/server/src/routes.ts', 'apps/server/src/routes-core.ts']:
            with self.subTest(path=path):
                result, output = self.verdict('Checks passed.\n' + self.lines, changed=[path])
                self.assertEqual(result, 1, output)
                self.assertIn('FAIL api-card:', output)

    def test_other_server_files_do_not_trigger_the_card(self):
        for path in ['apps/server/src/services/drafts.ts', 'apps/server/src/routes/x.ts', 'apps/web/src/routes-core.ts']:
            with self.subTest(path=path):
                result, output = self.verdict('Checks passed.\n' + self.lines, changed=[path])
                self.assertEqual(result, 0, output)
                self.assertNotIn('api-card', output)

    def test_card_hidden_in_a_fence_or_comment_does_not_count(self):
        for hidden in ['```\n' + self.card() + '```\n', '<!--\n' + self.card() + '-->\n']:
            with self.subTest(hidden=hidden[:6]):
                result, output = self.verdict(hidden + self.lines)
                self.assertEqual(result, 1, output)
                self.assertIn('FAIL api-card:', output)

    def test_card_needs_a_before_row(self):
        requests = self.requests.replace('| Before | `GET /drafts/x` | `404` | table absent | - |\n', '')
        result, output = self.verdict(self.card(requests=requests))
        self.assertEqual(result, 1, output)
        self.assertIn('FAIL api-card: Requests table has no Before row', output)

    def test_card_needs_a_row_with_an_http_status(self):
        requests = self.requests.replace('`404`', 'not found').replace('`200 {"content":"a"}`', 'ok')
        result, output = self.verdict(self.card(requests=requests))
        self.assertEqual(result, 1, output)
        self.assertIn('FAIL api-card: Requests table has no row with an HTTP status code', output)

    def test_card_needs_a_screenshot_of_the_call(self):
        requests = self.requests.replace('![Swagger request and response](https://example.org/call.png)\n\n', '')
        result, output = self.verdict(self.card(requests=requests))
        self.assertEqual(result, 1, output)
        self.assertIn('FAIL api-card: Requests section has no embedded screenshot', output)

    def test_internal_requirement_needs_a_link_and_a_quote(self):
        for requirement in ['### Requirement\n\n[#3104](https://github.com/xiechimon/cairn/issues/3104)\n\n',
                            '### Requirement\n\n> must survive closing the app and reopening it on any device\n\n']:
            with self.subTest(requirement=requirement):
                result, output = self.verdict(self.card(requirement=requirement))
                self.assertEqual(result, 1, output)
                self.assertIn('FAIL api-card: Requirement has no', output)

    def test_plan_decision_with_a_quote_is_an_internal_requirement(self):
        requirement = '### Requirement\n\nD110, plan 30\n\n> composer drafts survive close and sync across devices\n\n'
        result, output = self.verdict(self.card(requirement=requirement))
        self.assertEqual(result, 0, output)

    def test_third_party_requirement_without_a_doc_screenshot_fails(self):
        result, output = self.verdict(self.card(requirement=self.third_party))
        self.assertEqual(result, 1, output)
        self.assertIn('FAIL api-card: third-party Requirement needs an embedded screenshot of the official doc', output)

    def test_third_party_requirement_with_a_doc_screenshot_passes(self):
        result, output = self.verdict(self.card(requirement=self.third_party + self.doc_shot))
        self.assertEqual(result, 0, output)

    def test_an_external_link_makes_the_requirement_third_party_without_the_marker(self):
        requirement = ('### Requirement\n\n[#3104](https://github.com/xiechimon/cairn/issues/3104) '
                       '[docs](https://docs.github.com/en/rest)\n\n> must survive closing the app and reopening it on any device\n\n')
        result, output = self.verdict(self.card(requirement=requirement))
        self.assertEqual(result, 1, output)
        self.assertIn('third-party Requirement needs an embedded screenshot', output)

    def test_code_pr_needs_the_three_coverage_lines(self):
        for missing in ['Live', 'Mocked', 'Not covered']:
            with self.subTest(missing=missing):
                lines = ''.join(line + '\n' for line in self.lines.splitlines() if not line.startswith(missing + ':'))
                result, output = self.verdict('Checks passed.\n' + lines, changed=['apps/server/src/services/drafts.ts'])
                self.assertEqual(result, 1, output)
                self.assertIn(f'FAIL coverage-lines: missing {missing}:', output)

    def test_empty_coverage_line_fails(self):
        result, output = self.verdict('Checks passed.\n```text\nLive:\nMocked: none.\nNot covered: none.\n```\n', changed=['scripts/x.mjs'])
        self.assertEqual(result, 1, output)
        self.assertIn('FAIL coverage-lines: missing Live:', output)

    def test_not_verified_alone_is_renamed_not_accepted(self):
        proof = 'Checks passed.\n```text\nLive: a.\nMocked: none.\nNot verified: b.\n```\n'
        result, output = self.verdict(proof, changed=['scripts/x.mjs'])
        self.assertEqual(result, 1, output)
        self.assertIn('FAIL coverage-lines: missing Not covered:', output)
        self.assertIn('Not verified: was merged into Not covered:', output)

    def test_coverage_lines_in_plain_prose_also_count(self):
        proof = 'Checks passed.\n\nLive: a.\n\n**Mocked:** none.\n\n- Not covered: b.\n'
        result, output = self.verdict(proof, changed=['scripts/x.mjs'])
        self.assertEqual(result, 0, output)

    def test_docs_only_pr_needs_no_coverage_lines(self):
        result, output = self.verdict('Docs read back.', changed=['docs/research/x.md', 'README.md'])
        self.assertEqual(result, 0, output)
        self.assertNotIn('coverage-lines', output)

    def test_without_a_changed_file_list_nothing_extra_is_enforced(self):
        result, output = self.verdict('Checks passed.', changed=None)
        self.assertEqual(result, 0, output)

    def test_formatting_around_an_empty_label_does_not_count_as_content(self):
        for empty in ['**Live:**', '__Live:__', '- **Live:**', '`Live:`', '**Live:** **', 'Live: *', 'Live: ``']:
            with self.subTest(empty=empty):
                lines = f'```text\n{empty}\nMocked: none.\nNot covered: x.\n```\n'
                result, output = self.verdict('Checks passed.\n' + lines, changed=['scripts/x.mjs'])
                self.assertEqual(result, 1, output)
                self.assertIn('FAIL coverage-lines: missing Live:', output)

    def test_formatted_labels_with_content_pass(self):
        proof = 'Checks passed.\n\n**Live:** the stack.\n\n__Mocked:__ none.\n\n- **Not covered:** `x`.\n'
        result, output = self.verdict(proof, changed=['scripts/x.mjs'])
        self.assertEqual(result, 0, output)

    def test_short_and_wrapped_quotes_count(self):
        link = '[#3104](https://github.com/xiechimon/cairn/issues/3104)\n\n'
        for quote in ['> Return 404.\n', '> must survive closing the app\n> and reopening it on any device\n', '>Done\n']:
            with self.subTest(quote=quote):
                result, output = self.verdict(self.card(requirement='### Requirement\n\n' + link + quote + '\n'))
                self.assertEqual(result, 0, output)

    def test_empty_quote_is_not_a_quote_and_the_message_says_which_part_is_missing(self):
        link = '[#3104](https://github.com/xiechimon/cairn/issues/3104)\n\n'
        for quote in ['>\n', '> **\n> \n', '> `` *\n']:
            with self.subTest(quote=quote):
                result, output = self.verdict(self.card(requirement='### Requirement\n\n' + link + quote + '\n'))
                self.assertEqual(result, 1, output)
                self.assertIn('FAIL api-card: Requirement has no quoted excerpt', output)
                self.assertNotIn('has no internal link', output)
        result, output = self.verdict(self.card(requirement='### Requirement\n\n> Return 404.\n\n'))
        self.assertEqual(result, 1, output)
        self.assertIn('FAIL api-card: Requirement has no internal link', output)
        self.assertNotIn('no quoted excerpt', output)

    def test_http_status_must_be_in_the_response_column(self):
        requests = self.requests.replace('`404`', 'not found').replace('`200 {"content":"a"}`', 'ok').replace('/drafts/x', '/drafts/404')
        result, output = self.verdict(self.card(requests=requests))
        self.assertEqual(result, 1, output)
        self.assertIn('FAIL api-card: Requests table has no row with an HTTP status code in the Response column', output)

    DRIVER_CASES = [
        {'clause': 'Before (old | code)', 'method': 'GET', 'path': '/drafts/a|b', 'status': 404, 'responseText': '{"error":"Not | found"}', 'rows': 'table absent', 'ok': 'yes'},
        {'clause': 'pipe in request json', 'method': 'PUT', 'path': '/drafts/x', 'body': '{"content":"a|b"}', 'status': 200, 'responseText': '{"content":"a|b","updatedAt":1}', 'rows': '0 to 1 ({"scope":"x","content":"a|b|c"})', 'ok': 'yes'},
        {'clause': 'escaped backslash-pipe', 'method': 'PUT', 'path': '/drafts/x', 'body': '{"content":"a\\\\|b"}', 'status': 200, 'responseText': '{"content":"a\\\\|b"}', 'rows': '1 to 1', 'ok': 'yes'},
        {'clause': 'long response', 'method': 'GET', 'path': '/drafts/x', 'status': 400, 'responseText': '{"error":"' + 'p|' * 80 + '"}', 'rows': 'n/a', 'ok': 'NO'},
        {'clause': 'empty response', 'method': 'DELETE', 'path': '/drafts/x', 'status': 204, 'responseText': '', 'rows': '1 to 0', 'ok': 'yes'},
        {'clause': 'newline in rows', 'method': 'GET', 'path': '/x', 'status': 200, 'responseText': '{"a":"line1\nline2"}', 'rows': '1 to 1 ({"content":"l1\nl2"})', 'ok': '-'},
    ]

    def driver_table(self):
        script = (
            "import { requestsRow, requestsTable } from './.claude/skills/verify-cairn/scripts/api-card-table.mjs';"
            "const cases = JSON.parse(process.argv[1]);"
            "process.stdout.write(requestsTable(cases.map(requestsRow)));"
        )
        result = subprocess.run(['node', '--input-type=module', '-e', script, json.dumps(self.DRIVER_CASES)], capture_output=True, text=True, check=True)
        return result.stdout

    def test_the_drivers_table_passes_the_gate_for_every_cell_type(self):
        requests = '### Requests\n\n![Swagger request and response](https://example.org/call.png)\n\n' + self.driver_table() + '\n\n'
        result, output = self.verdict(self.card(requests=requests))
        self.assertEqual(result, 0, output)

    def test_the_drivers_cells_round_trip_through_the_gate_parser(self):
        header, rows = gate.table_rows('### Requests\n\n' + self.driver_table() + '\n')
        self.assertEqual(header, ['Clause', 'Request', 'Response', 'Rows before to after', 'ok'])
        self.assertEqual(len(rows), len(self.DRIVER_CASES))
        for row, case in zip(rows, self.DRIVER_CASES):
            with self.subTest(clause=case['clause']):
                self.assertEqual(len(row), 5)
                self.assertEqual(row[0], case['clause'])
                self.assertIn(case['path'], row[1])
                self.assertTrue(row[2].startswith(f"`{case['status']}`"), row[2])
                self.assertEqual(row[3], case['rows'].replace('\n', ' '))
                self.assertEqual(row[4], case['ok'])
                if 'body' in case:
                    self.assertIn(case['body'], row[1])

    def test_an_escaped_pipe_does_not_shift_the_response_column(self):
        requests = ('### Requests\n\n![call](https://example.org/call.png)\n\n'
                    '| Clause | Request | Response | Rows | OK |\n|---|---|---|---|---|\n'
                    '| Before | `GET /x` | `404` | table absent | - |\n'
                    '| pipe | `PUT /x` `{"content":"a\\|b"}` | `200` `{"content":"a\\|b"}` | 0 to 1 | yes |\n\n')
        result, output = self.verdict(self.card(requests=requests))
        self.assertEqual(result, 0, output)
        _, rows = gate.table_rows(requests)
        self.assertEqual(rows[1][1], '`PUT /x` `{"content":"a|b"}`')

    def test_status_in_an_earlier_escaped_cell_does_not_count_as_the_response(self):
        requests = ('### Requests\n\n![call](https://example.org/call.png)\n\n'
                    '| Clause | Request | Response | Rows | OK |\n|---|---|---|---|---|\n'
                    '| Before | `GET /x` | not found | table absent | - |\n'
                    '| pipe | `PUT /x` `{"id":"200\\|x"}` | ok | 0 to 1 | yes |\n\n')
        result, output = self.verdict(self.card(requests=requests))
        self.assertEqual(result, 1, output)
        self.assertIn('no row with an HTTP status code in the Response column', output)

    def test_an_optional_rollback_line_changes_nothing(self):
        for rollback in ['Rollback: revert the PR; the table is created empty.', '**Rollback:** drop the column.', '']:
            with self.subTest(rollback=rollback):
                lines = self.lines.replace('```\n', rollback + '\n```\n') if rollback and self.lines.endswith('```\n') else self.lines
                result, output = self.verdict(self.card(lines=lines))
                self.assertEqual(result, 0, output)

    def test_skill_says_where_the_before_row_comes_from(self):
        skill = Path('.claude/skills/pr-cairn/SKILL.md').read_text()
        self.assertIn('base branch or production', skill)
        self.assertIn('never a reverted copy', skill)

    def test_workflow_passes_the_changed_files_to_the_gate(self):
        workflow = Path('.github/workflows/pr-evidence.yml').read_text()
        self.assertIn('--changed-files', workflow)

    def test_template_and_skill_name_the_card(self):
        for path in ['.github/PULL_REQUEST_TEMPLATE.md', '.claude/skills/pr-cairn/SKILL.md']:
            text = Path(path).read_text()
            for needle in ['### Requirement', '### Requests', 'Live:', 'Mocked:', 'Not covered:', 'Rollback:', 'base branch']:
                with self.subTest(path=path, needle=needle):
                    self.assertIn(needle, text)
            self.assertNotIn('one line naming the test that fails on main', text)


class SchemaGlanceWorkflowTests(unittest.TestCase):
    body = ('## Proof\nOld run failed; new run passed.\n```text\nLive: temp repo.\nMocked: none.\nNot covered: real CI.\n```\n'
            '## What\nAdd a column.\n## Review\nReviewed.\n## Risk\nReversible.\n')

    @staticmethod
    def step_script():
        lines = Path('.github/workflows/pr-evidence.yml').read_text().splitlines()
        at = next(i for i, line in enumerate(lines) if line.strip().startswith('- name: Check PR body evidence'))
        run_at = next(i for i in range(at, len(lines)) if lines[i].strip() == 'run: |')
        indent = len(lines[run_at]) - len(lines[run_at].lstrip()) + 2
        block = []
        for line in lines[run_at + 1:]:
            if line.strip() and len(line) - len(line.lstrip()) < indent:
                break
            block.append(line[indent:])
        return '\n'.join(block) + '\n'

    @staticmethod
    def snapshot(*tables):
        return json.dumps({'version': '6', 'dialect': 'sqlite', 'tables': {
            name: {'name': name, 'columns': {column: {'name': column, 'type': 'text'} for column in columns},
                   'indexes': {}, 'foreignKeys': {}}
            for name, columns in tables}})

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name).resolve()
        self.repo = root / 'repo'
        self.temp = root / 'runner'
        self.temp.mkdir()
        (self.repo / 'scripts').mkdir(parents=True)
        (self.repo / 'apps/server/drizzle/meta').mkdir(parents=True)
        for name in ('pr-evidence-gate.py', 'pr_body.py', 'schema-glance.mjs'):
            (self.repo / 'scripts' / name).write_text(Path('scripts', name).read_text())
        (self.repo / 'packages/shared').mkdir(parents=True)
        (self.repo / 'packages/shared/merge-gate-paths.json').write_text(Path('packages/shared/merge-gate-paths.json').read_text())
        self.git('init', '-q', '-b', 'main')
        self.git('config', 'user.email', 't@example.com')
        self.git('config', 'user.name', 't')
        self.git('config', 'commit.gpgsign', 'false')
        self.git('add', 'scripts')
        self.commit('apps/server/drizzle/meta/0001_snapshot.json', self.snapshot(('task', ['id'])), 'base')
        self.git('branch', 'feature')
        self.commit('apps/server/drizzle/meta/0002_snapshot.json', self.snapshot(('task', ['id']), ('note', ['id'])), 'main migration')
        self.git('checkout', '-q', 'feature')

    def git(self, *args):
        return subprocess.run(['git', '-C', str(self.repo), *args], check=True, capture_output=True, text=True).stdout.strip()

    def commit(self, path, content, message):
        (self.repo / path).write_text(content)
        self.git('add', path)
        self.git('commit', '-q', '-m', message)

    def run_step(self, body):
        (self.temp / 'pr.json').write_text(json.dumps({'base': {'sha': self.git('rev-parse', 'main')}, 'head': {'sha': self.git('rev-parse', 'feature')}}))
        (self.temp / 'pr-body.md').write_text(body)
        return subprocess.run(['bash', '--noprofile', '--norc', '-eo', 'pipefail', '-c', self.step_script()], cwd=self.repo,
                              env={**os.environ, 'RUNNER_TEMP': str(self.temp)}, capture_output=True, text=True)

    def test_non_drizzle_pr_behind_a_main_migration_needs_no_table(self):
        self.commit('README.md', 'docs\n', 'docs only')
        result = self.run_step(self.body)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn('schema-changes', result.stdout)
        self.assertFalse((self.temp / 'schema-glance.md').exists())

    def test_drizzle_pr_behind_a_main_migration_diffs_from_the_merge_base(self):
        self.commit('apps/server/drizzle/meta/0002_snapshot.json', self.snapshot(('task', ['id', 'due'])), 'feature migration')
        result = self.run_step(self.body)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn('FAIL schema-changes: missing', result.stdout)
        table = (self.temp / 'schema-glance.md').read_text()
        self.assertEqual(table, '### Schema changes\n\n| table | change | detail |\n|---|---|---|\n| `task` | + due | text |\n')
        result = self.run_step(self.body + table)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('schema-changes: matches', result.stdout)


class BaselineEvidenceTests(unittest.TestCase):
    sections = '## What\nUpdate a specimen.\n## Review\nReviewed.\n## Risk\nReversible.\n'
    dark = 'apps/web/e2e/gallery-snapshots.spec.ts-snapshots/pr-card-dark-linux.png'
    light = 'apps/web/e2e/gallery-snapshots.spec.ts-snapshots/pr-card-light-linux.png'
    old = '![old](https://example.org/old.png)'
    new = '![new](https://example.org/new.png)'

    def verdict(self, proof, baselines=(dark,)):
        output = io.StringIO()
        with tempfile.TemporaryDirectory() as directory:
            argv = ['pr-evidence-gate.py']
            if baselines is not None:
                path = Path(directory, 'changed-baselines.txt')
                path.write_text('\n'.join(baselines) + '\n')
                argv += ['--changed-baselines', str(path)]
            body = '## Proof\n' + proof + '\n' + self.sections
            with patch.object(sys, 'argv', argv), patch.dict(gate.os.environ, {'PR_BODY': body}), patch.object(gate, 'http_code', return_value='200'), contextlib.redirect_stdout(output):
                result = gate.main()
        return result, output.getvalue()

    def pair_table(self, *names):
        rows = ''.join(f'| `{name}` | {self.old} | {self.new} |\n' for name in names)
        return '| Baseline | Old baseline | New render |\n|---|---|---|\n' + rows

    def test_changed_baseline_without_evidence_fails_and_names_it(self):
        result, output = self.verdict('Checks passed.\n')
        self.assertEqual(result, 1, output)
        self.assertIn(f'FAIL baseline-evidence: {self.dark}', output)

    def test_old_and_new_image_pair_passes(self):
        result, output = self.verdict(self.pair_table('pr-card-dark-linux.png'))
        self.assertEqual(result, 0, output)
        self.assertIn('baseline-evidence: 1 changed baseline(s) shown', output)

    def test_full_path_in_the_pair_row_passes(self):
        result, output = self.verdict(self.pair_table(self.dark))
        self.assertEqual(result, 0, output)

    def test_verdict_line_passes_in_prose_lists_and_text_fences(self):
        for proof in ['pr-card-dark-linux.png: badge moved 2px left, intended.\n',
                      '- `pr-card-dark-linux.png`: unchanged layout, new badge color.\n',
                      'Baselines read.\n```text\npr-card-dark-linux: read, only the chip text changed.\n```\n',
                      '<details><summary>Baselines</summary>\n\npr-card-dark-linux.png: read; spacing intended.\n\n</details>\n']:
            with self.subTest(proof=proof):
                result, output = self.verdict(proof)
                self.assertEqual(result, 0, output)

    def test_a_row_with_one_image_is_not_a_pair(self):
        proof = f'| Baseline | New render |\n|---|---|\n| `pr-card-dark-linux.png` | {self.new} |\n'
        result, output = self.verdict(proof)
        self.assertEqual(result, 1, output)
        self.assertIn(f'FAIL baseline-evidence: {self.dark}', output)

    def test_empty_or_hidden_verdicts_do_not_count(self):
        for proof in ['pr-card-dark-linux.png:\n', 'pr-card-dark-linux.png: **  **\n',
                      '<!-- pr-card-dark-linux.png: looked fine -->\n',
                      'Updated pr-card-dark-linux.png after the change.\n']:
            with self.subTest(proof=proof):
                result, output = self.verdict(proof)
                self.assertEqual(result, 1, output)
                self.assertIn('FAIL baseline-evidence:', output)

    def test_a_pair_inside_a_fence_does_not_count(self):
        result, output = self.verdict('```\n' + self.pair_table('pr-card-dark-linux.png') + '```\n')
        self.assertEqual(result, 1, output)
        self.assertIn(f'FAIL baseline-evidence: {self.dark}', output)

    def test_evidence_must_name_the_exact_baseline(self):
        other = 'apps/web/e2e/gallery-snapshots.spec.ts-snapshots/card-dark-linux.png'
        result, output = self.verdict(self.pair_table('pr-card-dark-linux.png'), baselines=(other,))
        self.assertEqual(result, 1, output)
        self.assertIn(f'FAIL baseline-evidence: {other}', output)

    def test_only_the_missing_baselines_are_named(self):
        result, output = self.verdict(self.pair_table('pr-card-dark-linux.png'), baselines=(self.dark, self.light))
        self.assertEqual(result, 1, output)
        self.assertIn(f'FAIL baseline-evidence: {self.light}', output)
        self.assertNotIn(f'FAIL baseline-evidence: {self.dark}', output)

    def test_without_a_baseline_list_nothing_is_enforced(self):
        result, output = self.verdict('Checks passed.\n', baselines=None)
        self.assertEqual(result, 0, output)
        self.assertNotIn('baseline-evidence', output)

    def test_skill_names_the_rule(self):
        skill = Path('.claude/skills/pr-cairn/SKILL.md').read_text()
        self.assertIn('baseline-evidence', skill)
        self.assertIn('--changed-baselines', skill)


class BaselineWorkflowTests(unittest.TestCase):
    body = ('## Proof\nChecks passed.\n```text\nLive: temp repo.\nMocked: none.\nNot covered: real CI.\n```\n'
            '## What\nUpdate a specimen.\n## Review\nReviewed.\n## Risk\nReversible.\n')
    snapshots = 'apps/web/e2e/gallery-snapshots.spec.ts-snapshots'

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name).resolve()
        self.repo = root / 'repo'
        self.temp = root / 'runner'
        self.temp.mkdir()
        (self.repo / 'scripts').mkdir(parents=True)
        (self.repo / self.snapshots).mkdir(parents=True)
        (self.repo / 'docs').mkdir()
        for name in ('pr-evidence-gate.py', 'pr_body.py', 'schema-glance.mjs'):
            (self.repo / 'scripts' / name).write_text(Path('scripts', name).read_text())
        self.git('init', '-q', '-b', 'main')
        self.git('config', 'user.email', 't@example.com')
        self.git('config', 'user.name', 't')
        self.git('config', 'commit.gpgsign', 'false')
        self.git('add', 'scripts')
        self.commit(f'{self.snapshots}/pr-card-dark-linux.png', 'old', 'base')
        self.commit(f'{self.snapshots}/gone-dark-linux.png', 'old', 'base two')
        self.commit('docs/diagram.png', 'old', 'base three')
        self.git('checkout', '-q', '-b', 'feature')

    def git(self, *args):
        return subprocess.run(['git', '-C', str(self.repo), *args], check=True, capture_output=True, text=True).stdout.strip()

    def commit(self, path, content, message):
        (self.repo / path).write_text(content)
        self.git('add', path)
        self.git('commit', '-q', '-m', message)

    def run_step(self, body):
        (self.temp / 'pr.json').write_text(json.dumps({'base': {'sha': self.git('rev-parse', 'main')}, 'head': {'sha': self.git('rev-parse', 'feature')}}))
        (self.temp / 'pr-body.md').write_text(body)
        return subprocess.run(['bash', '--noprofile', '--norc', '-eo', 'pipefail', '-c', SchemaGlanceWorkflowTests.step_script()], cwd=self.repo,
                              env={**os.environ, 'RUNNER_TEMP': str(self.temp)}, capture_output=True, text=True)

    def test_changed_baseline_needs_evidence_in_the_body(self):
        self.commit(f'{self.snapshots}/pr-card-dark-linux.png', 'new', 'accept baseline')
        result = self.run_step(self.body)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn(f'FAIL baseline-evidence: {self.snapshots}/pr-card-dark-linux.png', result.stdout)
        result = self.run_step(self.body.replace('Checks passed.', 'pr-card-dark-linux.png: read it; the badge is darker on purpose.'))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_added_baseline_needs_evidence_and_deleted_one_does_not(self):
        self.commit(f'{self.snapshots}/fresh-dark-linux.png', 'new', 'add baseline')
        self.git('rm', '-q', f'{self.snapshots}/gone-dark-linux.png')
        self.git('commit', '-q', '-m', 'drop baseline')
        result = self.run_step(self.body)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn(f'FAIL baseline-evidence: {self.snapshots}/fresh-dark-linux.png', result.stdout)
        self.assertNotIn('gone-dark-linux.png', result.stdout)

    def test_other_images_do_not_trigger_the_rule(self):
        self.commit('docs/diagram.png', 'new', 'docs image')
        result = self.run_step(self.body)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn('baseline-evidence', result.stdout)
        self.assertFalse((self.temp / 'changed-baselines.txt').exists() and (self.temp / 'changed-baselines.txt').read_text().strip())


def load_tests(loader, tests, pattern):
    task_spec = importlib.util.spec_from_file_location('task_tests', Path(__file__).with_name('pr-tasks-gate.test.py'))
    task_tests = importlib.util.module_from_spec(task_spec)
    task_spec.loader.exec_module(task_tests)
    tests.addTests(loader.loadTestsFromModule(task_tests))
    return tests


if __name__ == '__main__':
    unittest.main()
