import copy
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location('review_preflight', ROOT / 'review-preflight.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
POSITIVE = json.loads((ROOT / 'pre-merge-review-positive.json').read_text())
HEAD = POSITIVE['binding']['headSha']
DIGEST = POSITIVE['binding']['patchDigest']


class ReviewPreflightTests(unittest.TestCase):
    def test_actual_current_pre_merge_review_passes(self):
        self.assertEqual(MODULE.review_errors(POSITIVE, HEAD, DIGEST, 'GPT'), [])

    def test_actual_post_merge_audit_cannot_authorize_a_merge(self):
        record = json.loads((ROOT / 'post-merge-review-negative.json').read_text())
        errors = MODULE.review_errors(record, record['review']['headSha'], DIGEST, 'GPT')
        self.assertIn('Review must finish before merge', errors)
        self.assertIn('Review must use the canonical pd2 digest', errors)

    def test_same_model_family_does_not_count_as_independent(self):
        record = copy.deepcopy(POSITIVE)
        record['completion']['model'] = record['review']['reviewerModel'] = 'gpt-6.1-sol'
        self.assertIn('Reviewer must use an approved different model family', MODULE.review_errors(record, HEAD, DIGEST, 'GPT'))

    def test_stale_head_and_digest_are_both_rejected(self):
        errors = MODULE.review_errors(POSITIVE, '0' * 40, 'pd2:' + '0' * 64, 'GPT')
        self.assertIn('Review head differs from the current PR head', errors)
        self.assertIn('Review digest differs from the current patch', errors)

    def test_error_or_zero_usage_cannot_count_as_a_review(self):
        record = copy.deepcopy(POSITIVE)
        record['completion']['stopReason'] = 'error'
        record['completion']['usage']['totalTokens'] = 0
        errors = MODULE.review_errors(record, HEAD, DIGEST, 'GPT')
        self.assertIn('Review must complete normally with nonzero usage', errors)

    def test_block_or_missing_mandatory_answers_cannot_pass(self):
        record = copy.deepcopy(POSITIVE)
        record['review']['verdict'] = 'block'
        del record['review']['evalRulerChange']
        errors = MODULE.review_errors(record, HEAD, DIGEST, 'GPT')
        self.assertIn('Independent verdict must be pass', errors)
        self.assertIn('Required gate and eval-ruler answers must both be no', errors)

    def test_conflicting_binding_fields_are_rejected(self):
        record = copy.deepcopy(POSITIVE)
        record['binding']['headSha'] = '0' * 40
        self.assertIn('Review head differs from the current PR head', MODULE.review_errors(record, HEAD, DIGEST, 'GPT'))

    def test_actual_source_bytes_survive_model_selection(self):
        source = "const modelId = 'deepseek-v4.1-flash';\n"
        body = 'FULL FILE example.ts\n' + source
        self.assertEqual(MODULE.bundle_errors(body, {'example.ts': source}), [])
        corrupted = body.replace('deepseek-v4.1-flash', 'glm-5.3-flash')
        self.assertIn('Source bytes differ or are missing: example.ts', MODULE.bundle_errors(corrupted, {'example.ts': source}))

    def test_context_and_process_exit_are_verified(self):
        record = copy.deepcopy(POSITIVE)
        record['execution']['configuredContextWindow'] = 128000
        record['execution']['rc'] = 1
        self.assertIn('Review requires a successful process and at least 1000000 context tokens', MODULE.review_errors(record, HEAD, DIGEST, 'GPT'))


class GitHubFactsTests(unittest.TestCase):
    def setUp(self):
        self.files = json.loads((ROOT / 'github-files-extract.json').read_text())
        self.good = json.loads((ROOT / 'github-digest-review.json').read_text())
        self.local = json.loads((ROOT / 'local-digest-review.json').read_text())
        self.head = self.good['binding']['headSha']
        self.base = self.good['binding']['baseSha']
        self.pr = {'head': {'sha': self.head}, 'base': {'sha': self.base}, 'changed_files': len(self.files), 'state': 'open'}

    def git_output(self, command, **kwargs):
        if command[1] == 'diff':
            return '\0'.join(f['filename'] for f in self.files).encode() + b'\0'
        path = command[-1].split(':', 1)[1]
        return (next(f['sha'] for f in self.files if f['filename'] == path) + '\n').encode()

    def test_raw_github_fields_derive_digest_including_opaque_patch_and_evidence_exclusion(self):
        derived = MODULE.github_patch_digest(self.files)
        self.assertEqual(derived, 'pd2:5343fcf54bdaf7fb7286f04fc22c6dab5b38ca0c4a39f1efafe689c59e9c6454')
        evidence_changed = copy.deepcopy(self.files)
        evidence_changed[-1]['patch'] = 'different evidence bytes'
        self.assertEqual(MODULE.github_patch_digest(evidence_changed), derived)
        source_changed = copy.deepcopy(self.files)
        source_changed[0]['patch'] += '\n'
        self.assertNotEqual(MODULE.github_patch_digest(source_changed), derived)

    def test_local_compare_file_schema_is_rejected(self):
        local = [{'filename': f['filename'], 'status': f['status'], 'sha': f['sha'], 'additions': f['additions'], 'deletions': f['deletions'], 'previousFilename': None, 'patchSha': None} for f in self.files]
        with self.assertRaisesRegex(ValueError, 'raw GitHub'):
            MODULE.github_patch_digest(local)

    def test_complete_current_capture_matches_local_blobs(self):
        with patch.object(MODULE.subprocess, 'check_output', side_effect=self.git_output):
            errors, digest = MODULE.github_facts_errors(self.pr, self.files, self.head, self.base, ROOT)
        self.assertEqual(errors, [])
        self.assertEqual(digest, MODULE.github_patch_digest(self.files))

    def test_partial_and_duplicate_files_are_rejected(self):
        for files in [self.files[:-1], [self.files[0]] * len(self.files)]:
            with patch.object(MODULE.subprocess, 'check_output', side_effect=self.git_output):
                errors, _ = MODULE.github_facts_errors(self.pr, files, self.head, self.base, ROOT)
            self.assertTrue(errors)

    def test_stale_head_base_and_blob_mismatch_are_rejected(self):
        for field in ['head', 'base']:
            pr = copy.deepcopy(self.pr)
            pr[field]['sha'] = '0' * 40
            with patch.object(MODULE.subprocess, 'check_output', side_effect=self.git_output):
                self.assertTrue(MODULE.github_facts_errors(pr, self.files, self.head, self.base, ROOT)[0])
        with patch.object(MODULE.subprocess, 'check_output', return_value=b'0' * 40 + b'\n'):
            self.assertTrue(MODULE.github_facts_errors(self.pr, self.files, self.head, self.base, ROOT)[0])

    def test_same_head_local_digest_review_is_not_github_bound(self):
        self.assertEqual(self.local['review']['headSha'], self.good['review']['headSha'])
        digest = self.good['review']['patchDigest']
        self.assertIn('Review digest differs from the current patch', MODULE.review_errors(self.local, self.head, digest, 'GPT'))
        self.assertEqual(MODULE.review_errors(self.good, self.head, digest, 'GPT'), [])


if __name__ == '__main__':
    unittest.main()
