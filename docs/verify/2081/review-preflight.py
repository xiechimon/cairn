import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import subprocess

APPROVED_REVIEW_MODELS = {'glm-5.3', 'glm-5.3-flash', 'deepseek-v4.1-flash'}


def review_errors(record, head, digest, writer_family):
    errors = []
    review = record.get('review', {})
    binding = record.get('binding', {})
    completion = record.get('completion', {})
    execution = record.get('execution', {})
    if record.get('timing') != 'pre_merge' or binding.get('timing') != 'pre_merge':
        errors.append('Review must finish before merge')
    if not re.fullmatch(r'pd2:[0-9a-f]{64}', str(review.get('patchDigest', ''))):
        errors.append('Review must use the canonical pd2 digest')
    if review.get('headSha') != head or binding.get('headSha') != head:
        errors.append('Review head differs from the current PR head')
    if review.get('patchDigest') != digest or binding.get('patchDigest') != digest:
        errors.append('Review digest differs from the current patch')
    model = review.get('reviewerModel')
    if (
        writer_family != 'GPT'
        or binding.get('writerModelFamily') != writer_family
        or model not in APPROVED_REVIEW_MODELS
        or completion.get('model') != model
    ):
        errors.append('Reviewer must use an approved different model family')
    if completion.get('stopReason') != 'stop' or completion.get('usage', {}).get('totalTokens', 0) <= 0:
        errors.append('Review must complete normally with nonzero usage')
    if execution.get('rc') != 0 or execution.get('configuredContextWindow', 0) < 1_000_000:
        errors.append('Review requires a successful process and at least 1000000 context tokens')
    if review.get('verdict') != 'pass':
        errors.append('Independent verdict must be pass')
    if any(review.get(key, {}).get('answer') != 'no' for key in ('gateWeakening', 'evalRulerChange')):
        errors.append('Required gate and eval-ruler answers must both be no')
    return errors


def bundle_errors(bundle, sources):
    return [
        f'Source bytes differ or are missing: {path}'
        for path, content in sources.items()
        if f'FULL FILE {path}\n{content}' not in bundle
    ]


def source_files(root, base, head):
    paths = subprocess.check_output(
        ['git', 'diff', '--name-only', '--diff-filter=ACMRT', f'{base}...{head}'],
        cwd=root, text=True,
    ).splitlines()
    sources = {}
    for path in paths:
        data = subprocess.check_output(['git', 'show', f'{head}:{path}'], cwd=root)
        try:
            sources[path] = data.decode('utf-8')
        except UnicodeDecodeError:
            continue
    return sources


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('record', type=Path)
    parser.add_argument('--head', required=True)
    parser.add_argument('--digest', required=True)
    parser.add_argument('--writer-family', required=True, choices=['GPT'])
    parser.add_argument('--bundle', required=True, type=Path)
    parser.add_argument('--source-root', required=True, type=Path)
    args = parser.parse_args()
    record = json.loads(args.record.read_text())
    failures = review_errors(record, args.head, args.digest, args.writer_family)
    if not failures:
        content = args.bundle.read_text()
        if hashlib.sha256(content.encode()).hexdigest() != record['binding'].get('bundleSha256'):
            failures.append('Review bundle hash differs from the reviewed input')
        sources = source_files(args.source_root, record['binding']['baseSha'], args.head)
        failures.extend(bundle_errors(content, sources))
    for failure in failures:
        print(f'BLOCK: {failure}', file=sys.stderr)
    if failures:
        raise SystemExit(1)
    print('PASS: completed different-model pre-merge review matches the current head and canonical digest')
