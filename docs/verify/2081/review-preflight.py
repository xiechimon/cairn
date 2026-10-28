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


def github_patch_digest(files):
    if not isinstance(files, list) or not files or len(files) >= 300:
        raise ValueError('GitHub file list is empty or truncated')
    tuples = []
    seen = set()
    for item in files:
        if not isinstance(item, dict) or 'patchSha' in item or 'previousFilename' in item:
            raise ValueError('Expected raw GitHub files, not local CompareFile records')
        filename = item.get('filename')
        status = item.get('status')
        previous = item.get('previous_filename')
        sha = item.get('sha')
        if (
            not isinstance(filename, str) or not filename or filename in seen
            or status not in ('added', 'removed', 'modified', 'renamed', 'copied', 'changed', 'unchanged')
            or any(type(item.get(key)) is not int or item[key] < 0 for key in ('additions', 'deletions', 'changes'))
            or (sha is not None and not isinstance(sha, str))
            or (previous is not None and (not isinstance(previous, str) or not previous))
            or (status in ('renamed', 'copied') and previous is None)
            or ('sha' not in item)
        ):
            raise ValueError('Invalid or duplicate raw GitHub file record')
        seen.add(filename)
        if filename.startswith('docs/verify/') and (previous is None or previous.startswith('docs/verify/')):
            continue
        if sha is None and status != 'removed':
            raise ValueError('GitHub source file has no blob SHA')
        patch = item.get('patch')
        patch_sha = hashlib.sha256(patch.encode()).hexdigest() if isinstance(patch, str) and patch else None
        tuples.append(json.dumps([status, filename, previous, sha, patch_sha], ensure_ascii=False, separators=(',', ':')))
    if not tuples:
        raise ValueError('GitHub patch has no files outside evidence')
    tuples.sort(key=lambda value: value.encode('utf-16-be'))
    return 'pd2:' + hashlib.sha256('\n'.join(tuples).encode()).hexdigest()


def github_facts_errors(pr, files, head, base, root):
    errors = []
    if not isinstance(pr, dict):
        return ['Expected raw GitHub PR JSON'], None
    if pr.get('head', {}).get('sha') != head or pr.get('base', {}).get('sha') != base:
        errors.append('GitHub PR head or base differs from the review binding')
    if pr.get('state') != 'open' or pr.get('merged') is True:
        errors.append('GitHub capture must describe an open unmerged PR')
    if not isinstance(files, list) or type(pr.get('changed_files')) is not int or pr['changed_files'] != len(files):
        errors.append('GitHub file count differs from the captured PR')
    try:
        digest = github_patch_digest(files)
    except ValueError as error:
        return errors + [str(error)], None
    try:
        paths = subprocess.check_output(
            ['git', 'diff', '--name-only', '--no-renames', '-z', f'{base}...{head}'], cwd=root,
        ).decode().split('\0')
        expected = set(filter(None, paths))
        captured = {item['filename'] for item in files}
        captured.update(item['previous_filename'] for item in files if item['status'] == 'renamed')
        if captured != expected:
            errors.append('GitHub file paths differ from the local base-to-head comparison')
        for item in files:
            ref = base if item['status'] == 'removed' else head
            blob = subprocess.check_output(['git', 'rev-parse', f"{ref}:{item['filename']}"], cwd=root).decode().strip()
            if blob != item['sha']:
                errors.append(f"GitHub blob differs from local Git: {item['filename']}")
    except (subprocess.CalledProcessError, UnicodeDecodeError) as error:
        errors.append(f'Cannot verify captured GitHub files against local Git: {error}')
    return errors, digest


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
    parser.add_argument('--github-pr', required=True, type=Path)
    parser.add_argument('--github-files', required=True, type=Path)
    parser.add_argument('--bundle', required=True, type=Path)
    parser.add_argument('--source-root', required=True, type=Path)
    args = parser.parse_args()
    record = json.loads(args.record.read_text())
    failures, digest = github_facts_errors(
        json.loads(args.github_pr.read_text()), json.loads(args.github_files.read_text()),
        args.head, record.get('binding', {}).get('baseSha'), args.source_root,
    )
    if digest is not None:
        if args.digest != digest:
            failures.append('Supplied digest differs from captured GitHub patch')
        failures.extend(review_errors(record, args.head, digest, args.writer_family))
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
