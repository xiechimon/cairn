import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
HARBOR = Path(__file__).resolve().parent

if __name__ == '__main__':
    version = subprocess.check_output(['harbor', '--version'], text=True).strip()
    if version != '0.24.0':
        raise SystemExit(f'Expected Harbor 0.24.0, got {version}')
    output = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / 'docs/verify/1946/jobs'
    output.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')
    env = {**os.environ, 'PYTHONPATH': str(ROOT)}
    selection = sys.argv[2] if len(sys.argv) > 2 else 'all'
    if selection not in ('all', 'oracle', 'tamper'):
        raise SystemExit('Control selection must be all, oracle, or tamper')
    for task, agent, expected in [
        ('hello-file', 'oracle', 1.0),
        ('hidden-answer', 'oracle', 1.0),
        ('hidden-answer', 'integration.eval.harbor.tamper_agent:TamperAgent', 0.0),
    ]:
        if selection == 'oracle' and expected == 0 or selection == 'tamper' and expected == 1:
            continue
        name = f'1946-{task}-{agent.split(":")[-1]}-{stamp}'
        command = [
            'harbor', 'run', '-p', str(HARBOR / 'tasks' / task), '-a', agent,
            '--job-name', name, '--jobs-dir', str(output), '-n', '1',
            '--ek', 'keep_containers=true',
        ]
        print(' '.join(command), flush=True)
        try:
            with (output / f'{name}.log').open('w') as log:
                subprocess.run(command, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
            trials = list((output / name).glob('*/result.json'))
            assert len(trials) == 1, trials
            result = json.loads(trials[0].read_text())
            assert result['exception_info'] is None, result['exception_info']
            assert result['verifier_result']['rewards']['reward'] == expected, result
            if expected == 0:
                trial = trials[0].parent
                probe = (trial / 'agent/isolation.txt').read_text()
                verifier = (trial / 'verifier/test-stdout.txt').read_text()
                agent_hostname = probe.splitlines()[0].split('=', 1)[1]
                verifier_hostname = verifier.splitlines()[0].split('=', 1)[1]
                assert agent_hostname != verifier_hostname
                assert probe.count('unreadable=') == 3
                assert 'forged\n1\n' in (trial / 'agent/tampering.txt').read_text()
            print(f'{name}: reward={expected}', flush=True)
        finally:
            inspections = []
            for config in (output / name).glob('*/config.json'):
                project = config.parent.name.lower()
                for suffix in ('__env', '__verifier__trial'):
                    ids = subprocess.check_output([
                        'docker', 'ps', '-aq', '--filter', f'label=com.docker.compose.project={project}{suffix}'
                    ], text=True).split()
                    for container in ids:
                        info = json.loads(subprocess.check_output(['docker', 'inspect', container], text=True))[0]
                        inspections.append({
                            'Id': info['Id'], 'Name': info['Name'],
                            'Hostname': info['Config']['Hostname'],
                            'NetworkMode': info['HostConfig']['NetworkMode'],
                            'Mounts': info['Mounts'], 'State': info['State'],
                        })
                        subprocess.run(['docker', 'rm', '-f', container], check=True)
            (output / f'{name}-containers.json').write_text(json.dumps(inspections, indent=2) + '\n')
            assert len(inspections) == 2, inspections
            assert all(item['NetworkMode'] == 'none' for item in inspections)
