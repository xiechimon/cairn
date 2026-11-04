import argparse
import hashlib
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--source', required=True)
parser.add_argument('--out', required=True)
args = parser.parse_args()
source = subprocess.check_output(['git', 'rev-parse', args.source], text=True).strip()
files = {}
for name in ['cases.json', '_state.json', 'baseline/results.jsonl', 'baseline/errors.jsonl']:
    files[name] = subprocess.check_output([
        'git', 'show', f'{source}:.claude/hillclimb/chief-dispatch/{name}',
    ])
cases = json.loads(files['cases.json'])['cases']
results = [json.loads(line) for line in files['baseline/results.jsonl'].splitlines() if line.strip()]
errors = [json.loads(line) for line in files['baseline/errors.jsonl'].splitlines() if line.strip()]
counts = {'cases': len(cases), 'results': len(results), 'errors': len(errors)}
print(json.dumps({'source': source, 'counts': counts}), flush=True)
if counts != {'cases': 64, 'results': 176, 'errors': 16}:
    raise SystemExit('historical replay refused: source is not the documented 64-case / 192-turn batch')
state = json.loads(files['_state.json'])
metrics = state.get('metrics') or state.get('criteria') or []
primary = next((m.get('id') for m in metrics if isinstance(m, dict) and m.get('kind') == 'binary'), None)
if primary != 'decision_ok':
    raise SystemExit('historical replay refused: documented primary metric is not configured')
out = Path(args.out).resolve()
manifest = {'sourceCommit': source, 'counts': counts, 'files': {}}
for name, data in files.items():
    target = out / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    manifest['files'][name] = {'sha256': hashlib.sha256(data).hexdigest()}
(out / 'source-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
for script in ['oracle-check.mts', 'build-report-lite.mts']:
    subprocess.run(['node', f'integration/eval/chief-dispatch/{script}', str(out)], check=True)
html = (out / 'report.html').read_text()
for expected in ['data-headline="withheld"', 's 7/18', 's01 0/3', 'oracle verified']:
    if expected not in html:
        raise SystemExit(f'historical report assertion failed: {expected}')
print('historical report verified: s 7/18; s01 0/3 oracle verified; headline withheld')
