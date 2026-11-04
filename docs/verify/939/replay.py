#!/usr/bin/env python3
"""Replay every fixture through the PR evidence gate and compare with the
recorded outputs (`gate-*.txt` = stdout plus a trailing `exit=N` line).

  python3 docs/verify/939/replay.py            # compare, exit 1 on drift
  python3 docs/verify/939/replay.py --write    # re-record every output
  python3 docs/verify/939/replay.py --gate /tmp/gate-old.py   # another gate

Reachability lines depend on live network; a recorded `HTTP 000` means the
recording host could not reach the URL at all (curl failure), so --write
refuses to record a run containing one. Compare mode flags it as flaky.
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = subprocess.run(['git', 'rev-parse', '--show-toplevel'],
                      capture_output=True, text=True, cwd=HERE,
                      check=True).stdout.strip()

CASES = []  # (input path, recorded name)
for name in sorted(os.listdir(HERE)):
    if name.startswith('fixture-') and name.endswith('.md'):
        CASES.append((os.path.join(HERE, name),
                      'gate-' + name[len('fixture-'):-len('.md')] + '.txt'))
CASES.append((os.path.join(ROOT, '.github', 'PULL_REQUEST_TEMPLATE.md'),
              'gate-template-untouched.txt'))


def run_gate(gate, path):
    r = subprocess.run([sys.executable, gate, path],
                       capture_output=True, text=True)
    out = r.stdout
    if r.stderr.strip():
        out += '--- stderr ---\n' + r.stderr
    return out + f"exit={r.returncode}\n"


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    write = '--write' in sys.argv
    gate = ROOT + '/scripts/pr-evidence-gate.py'
    if '--gate' in sys.argv:
        gate = args[0]

    drift, flaky = [], []
    for path, recorded in CASES:
        out = run_gate(gate, path)
        rec_path = os.path.join(HERE, recorded)
        if 'HTTP 000' in out:
            flaky.append(recorded)
        label = os.path.basename(path)
        if write:
            if recorded in flaky:
                print(f"SKIP (network flake, HTTP 000): {label}")
                continue
            with open(rec_path, 'w', encoding='utf-8') as f:
                f.write(out)
            print(f"recorded {recorded}: {label}")
            continue
        with open(rec_path, encoding='utf-8') as f:
            want = f.read()
        if out != want:
            drift.append(recorded)
            print(f"DRIFT {recorded}: {label}")
            print('--- want ---')
            print(want, end='')
            print('--- got ---')
            print(out, end='')
        else:
            print(f"ok {recorded}: {label}")

    if flaky:
        print(f"\nflaky (HTTP 000, recording host could not reach the URL): "
              f"{', '.join(flaky)}")
    if drift:
        print(f"\nREPLAY RED ({len(drift)} drift)")
        return 1
    if flaky and write:
        print("\nREPLAY INCOMPLETE (flake; re-run until every case records)")
        return 1
    print("\nREPLAY GREEN")
    return 0


if __name__ == '__main__':
    sys.exit(main())
