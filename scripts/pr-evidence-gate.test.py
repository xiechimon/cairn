import contextlib
import importlib.util
import io
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('evidence_gate', Path(__file__).with_name('pr-evidence-gate.py'))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class EvidenceGateTests(unittest.TestCase):
    def verdict(self, body, status='200'):
        output = io.StringIO()
        with patch.object(sys, 'argv', ['pr-evidence-gate.py']), patch.dict(gate.os.environ, {'PR_BODY': '## Upstream\nIndependent.\n## Verified\nRegression checks.\n' + body}), patch.object(gate, 'http_code', return_value=status) as probe, contextlib.redirect_stdout(output):
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
                self.assertIn(f'FAIL not-embedded: {expected} (bare URL, line 5)', output)
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


if __name__ == '__main__':
    unittest.main()
