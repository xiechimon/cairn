import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).parent


class ExactGradingTest(unittest.TestCase):
    def test_exact_bytes(self):
        for task, answer in [('hello-file', 'hello.txt'), ('hidden-answer', 'answer.txt')]:
            tests = ROOT / 'tasks' / task / 'tests'
            expected = (tests / 'expected.txt').read_bytes()
            for label, content, reward in [
                ('exact', expected, '1\n'),
                ('missing newline', expected.rstrip(b'\n'), '0\n'),
                ('extra newlines', expected + b'\n\n', '0\n'),
                ('missing file', None, '0\n'),
                ('incorrect contents', b'forged\n', '0\n'),
            ]:
                with self.subTest(task=task, case=label), tempfile.TemporaryDirectory() as tmp:
                    directory = Path(tmp)
                    if content is not None:
                        (directory / answer).write_bytes(content)
                    revision = os.environ.get('HARBOR_GRADER_REV')
                    script = subprocess.check_output(
                        ['git', 'show', f'{revision}:integration/eval/harbor/tasks/{task}/tests/test.sh'],
                        text=True,
                    ) if revision else (tests / 'test.sh').read_text()
                    script = script.replace('/app/', tmp + '/').replace('/tests/', str(tests.resolve()) + '/')
                    script = script.replace('/logs/verifier', tmp + '/verifier')
                    subprocess.run(['sh', '-c', script], check=True, capture_output=True)
                    self.assertEqual((directory / 'verifier/reward.txt').read_text(), reward)


if __name__ == '__main__':
    unittest.main()
