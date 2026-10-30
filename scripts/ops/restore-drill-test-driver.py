import importlib.util
import json
from pathlib import Path
import subprocess
import sys


spec = importlib.util.spec_from_file_location('restore_drill', Path(__file__).with_name('restore-drill.py'))
drill = importlib.util.module_from_spec(spec)
spec.loader.exec_module(drill)


def fixture_api(db, home, env, report, node):
    run = subprocess.run([node, '--import', 'tsx', str(drill.ROOT / 'scripts/ops/restore-drill-api.mts'), str(home), sys.argv[sys.argv.index('--secretbox-key') + 1], '--in-process-fixture'], cwd=drill.ROOT / 'apps/server', env=env, capture_output=True, text=True, timeout=30)
    if run.returncode:
        raise RuntimeError('fixture in-process API failed')
    report['api'] = json.loads(run.stdout)
    report['fixtureOnly'] = True


drill.api = fixture_api
sys.exit(drill.main())
