import copy
import importlib.util
import json
from pathlib import Path
import unittest

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


if __name__ == '__main__':
    unittest.main()
