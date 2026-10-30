import fcntl
import gzip
import json
import os
from pathlib import Path
import re
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time


ROOT = Path(os.environ.get('CAIRN_DEPLOY_ROOT', str(Path.home() / '.local/share/cairn-deploy'))).resolve()
REPO = Path(os.environ.get('CAIRN_DEPLOY_REPO', str(Path.home() / 'Code/AgentProjects/cairn'))).resolve()
DB = Path(os.environ.get('CAIRN_DEPLOY_DB', '/mnt/fast/cairn/server/server.db')).resolve()
TIMEOUT = float(os.environ.get('CAIRN_DEPLOY_TIMEOUT', '120'))
TOKEN = os.environ.get('CAIRN_DEPLOY_TOKEN', '')
MACHINE = os.environ.get('CAIRN_DEPLOY_MACHINE', '')
URL = os.environ.get('CAIRN_DEPLOY_URL', 'http://127.0.0.1:8787')
REPOSITORY = 'xiechimon/cairn'


def run(args, cwd=None, env=None):
    result = subprocess.run([str(arg) for arg in args], cwd=cwd, env=env, text=True, capture_output=True, timeout=600)
    if result.returncode:
        raise RuntimeError(f'{args[0]} {args[1]} failed ({result.returncode})')
    return result.stdout.strip()


def git(*args):
    return run(['git', '-C', REPO, *args])


def atomic(path, value):
    temp = path.with_name(path.name + '.next')
    temp.write_text(value)
    os.replace(temp, path)


def select_release(sha):
    temp = ROOT / 'current.next'
    temp.unlink(missing_ok=True)
    temp.symlink_to(ROOT / 'releases' / sha)
    os.replace(temp, ROOT / 'current')


def log(action, sha, result):
    with (ROOT / 'deploy.jsonl').open('a') as stream:
        stream.write(json.dumps({'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'action': action, 'sha': sha, 'result': result}) + '\n')
        stream.flush()
        os.fsync(stream.fileno())


def pages(endpoint):
    value = json.loads(run(['gh', 'api', '--paginate', '--slurp', f'repos/{REPOSITORY}/{endpoint}']))
    return value


def require_checks(sha, names):
    checks = [check for page in pages(f'commits/{sha}/check-runs?per_page=100') for check in page['check_runs']]
    for name in names:
        matches = [check for check in checks if check['name'] == name and check['head_sha'] == sha and check.get('app', {}).get('slug') == 'github-actions']
        latest = max(matches, key=lambda check: check['id']) if matches else {}
        if latest.get('status') != 'completed' or latest.get('conclusion') != 'success':
            raise RuntimeError(f'{name} is not success on {sha}')


def gate(sha):
    git('fetch', 'origin', 'main')
    try:
        git('merge-base', '--is-ancestor', sha, 'origin/main')
    except RuntimeError as error:
        raise RuntimeError('SHA is not on origin/main') from error
    require_checks(sha, ['check', 'pack-smoke', 'e2e-gate'])
    pulls = [pull for page in pages(f'commits/{sha}/pulls') for pull in page]
    matches = [pull for pull in pulls if pull.get('merged_at') and pull.get('merge_commit_sha') == sha and pull['base']['ref'] == 'main' and pull['base']['repo']['full_name'] == REPOSITORY]
    if len(matches) != 1:
        raise RuntimeError('exactly one merged main PR is required')
    require_checks(matches[0]['head']['sha'], ['pr-evidence'])


def read_api(url, path):
    value = run(['curl', '--fail', '--silent', '--show-error', '--max-time', '3', '-H', f'Authorization: Bearer {TOKEN}', url + path])
    return json.loads(value)


def wait_for(check, label):
    deadline = time.monotonic() + TIMEOUT
    while True:
        try:
            if check():
                return
        except (RuntimeError, ValueError, sqlite3.Error):
            pass
        if time.monotonic() >= deadline:
            raise RuntimeError(f'{label} timed out')
        time.sleep(0.1)


def scratch_server(release, home, label):
    env = {key: value for key, value in os.environ.items() if not key.startswith('CAIRN_')}
    env.update({'HOME': str(home), 'CAIRN_HOME': str(home), 'CAIRN_TOKEN': TOKEN, 'CAIRN_REQUIRE_TOKEN': '1', 'HOST': '127.0.0.1', 'PORT': '18787', 'NODE_ENV': 'production'})
    with (ROOT / f'{label}.log').open('w') as output:
        process = subprocess.Popen(['node', '--import', 'tsx', 'src/index.ts'], cwd=release / 'apps/server', env=env, stdout=output, stderr=output, start_new_session=True)
        try:
            def ready():
                if process.poll() is not None:
                    raise RuntimeError('scratch server exited')
                time.sleep(0.1)
                user = read_api('http://127.0.0.1:18787', '/api/user/me')
                teams = read_api('http://127.0.0.1:18787', '/api/teams')
                return process.poll() is None and isinstance(user.get('id'), str) and isinstance(teams, list)
            wait_for(ready, f'scratch {label}')
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()


def restart():
    for unit in ['cairn-server.service', 'cairn-daemon.service']:
        run(['systemctl', '--user', 'restart', unit])


def drain(connection):
    with connection:
        connection.execute('begin immediate')
        connection.execute('create table deploy_pause_state(id text primary key, paused integer not null)')
        connection.execute('insert into deploy_pause_state select id, autonomyPaused from team')
        connection.execute('update team set autonomyPaused=1')
        connection.execute("create trigger deploy_claim_barrier before update of status on step when NEW.status='claimed' and OLD.status!='claimed' begin select raise(ignore); end")
        connection.execute("create trigger deploy_claim_insert_barrier before insert on step when NEW.status='claimed' begin select raise(ignore); end")


def resume(connection):
    with connection:
        connection.execute('update team set autonomyPaused=(select paused from deploy_pause_state where id=team.id) where id in (select id from deploy_pause_state)')
        connection.execute('drop trigger deploy_claim_barrier')
        connection.execute('drop trigger deploy_claim_insert_barrier')
        connection.execute('drop table deploy_pause_state')


def restore(snapshot, confirm):
    with tempfile.TemporaryDirectory(dir=ROOT) as folder:
        source = Path(folder) / 'restore.db'
        if snapshot.suffix == '.gz':
            with gzip.open(snapshot, 'rb') as stream:
                source.write_bytes(stream.read())
        else:
            source.write_bytes(snapshot.read_bytes())
        saved = sqlite3.connect(source)
        if saved.execute('pragma integrity_check').fetchone()[0] != 'ok':
            raise RuntimeError('snapshot integrity failed')
        if confirm:
            for unit in ['cairn-daemon.service', 'cairn-server.service', 'cairn-db-backup.timer']:
                run(['systemctl', '--user', 'stop', unit])
        live = sqlite3.connect(f'file:{DB}?mode=rw', uri=True)
        live.execute('attach database ? as snapshot', (str(source),))
        for (table,) in live.execute("select name from main.sqlite_master where type='table' and name not like 'sqlite_%'").fetchall():
            quoted = '"' + table.replace('"', '""') + '"'
            try:
                rows = live.execute(f'select * from main.{quoted} except select * from snapshot.{quoted}').fetchall()
            except sqlite3.Error:
                rows = live.execute(f'select * from main.{quoted}').fetchall()
            for row in rows:
                print(json.dumps({'table': table, 'discardedCurrentRow': row}, default=str), flush=True)
        live.close()
        if not confirm:
            raise RuntimeError('restore requires --confirm-discard; rows above would be discarded')
        destination = sqlite3.connect(DB)
        saved.backup(destination)
        if destination.execute("select count(*) from sqlite_master where type='table' and name='deploy_pause_state'").fetchone()[0]:
            resume(destination)
        destination.close()
        saved.close()
        log('restore', '', 'confirmed-discard')
        restart()
        run(['systemctl', '--user', 'start', 'cairn-db-backup.timer'])


def deploy(sha):
    if not re.fullmatch('[0-9a-f]{40}', sha):
        raise RuntimeError('a full lowercase commit SHA is required')
    if not TOKEN or not MACHINE:
        raise RuntimeError('CAIRN_DEPLOY_TOKEN and CAIRN_DEPLOY_MACHINE are required')
    previous = (ROOT / 'last-good').read_text().strip()
    old = ROOT / 'releases' / previous
    if not re.fullmatch('[0-9a-f]{40}', previous) or (ROOT / 'current').resolve(strict=True) != old or git('-C', old, 'rev-parse', 'HEAD') != previous:
        raise RuntimeError('current must match last-good release')
    if git('-C', old, 'status', '--porcelain', '--untracked-files=no'):
        raise RuntimeError('last-good release is dirty')
    if sha == previous:
        raise RuntimeError('SHA is already current')
    for unit, app in [('cairn-server.service', 'server'), ('cairn-daemon.service', 'daemon')]:
        working = run(['systemctl', '--user', 'show', unit, '--property=WorkingDirectory', '--value'])
        if working != str(ROOT / 'current' / 'apps' / app):
            raise RuntimeError(f'{unit} WorkingDirectory must point through current; install the drop-in')
    gate(sha)
    release = ROOT / 'releases' / sha
    if release.exists():
        raise RuntimeError('release already exists; inspect and remove the failed worktree explicitly')
    git('worktree', 'add', '--detach', release, sha)
    run(['pnpm', 'install', '--frozen-lockfile', '--ignore-scripts'], cwd=release)
    connection = sqlite3.connect(f'file:{DB}?mode=rw', uri=True, timeout=10)
    if connection.execute('select lastSeenAt from machine where id=?', (MACHINE,)).fetchone() is None:
        raise RuntimeError('configured daemon machine does not exist')
    with tempfile.TemporaryDirectory(prefix='scratch-', dir=ROOT) as folder:
        home = Path(folder)
        (home / 'server').mkdir()
        run(['sqlite3', DB, '.backup server.db'], cwd=home / 'server')
        scratch = sqlite3.connect(home / 'server/server.db')
        scratch.execute('update team set autonomyPaused=1')
        scratch.commit()
        scratch.close()
        scratch_server(release, home, 'new-scratch')
        scratch_server(old, home, 'old-scratch')
    drain(connection)
    switched = False
    try:
        wait_for(lambda: connection.execute("select count(*) from step where status='claimed'").fetchone()[0] == 0, 'drain')
        run(['bash', Path(__file__).with_name('backup-server-db.sh'), '--db', DB, '--out', ROOT / 'backups'])
        heartbeat = connection.execute('select coalesce(lastSeenAt,0) from machine where id=?', (MACHINE,)).fetchone()[0]
        select_release(sha)
        switched = True
        restart()
        def healthy():
            user = read_api(URL, '/api/user/me')
            teams = read_api(URL, '/api/teams')
            row = connection.execute('select lastSeenAt from machine where id=?', (MACHINE,)).fetchone()
            return isinstance(user.get('id'), str) and isinstance(teams, list) and row is not None and row[0] is not None and row[0] > heartbeat
        wait_for(healthy, 'health')
        atomic(ROOT / 'last-good', sha + '\n')
        log('deploy', sha, 'success')
    except BaseException:
        if switched:
            select_release(previous)
            atomic(ROOT / 'last-good', previous + '\n')
            try:
                restart()
                log('rollback', previous, 'restarted-without-db-restore')
            except BaseException:
                log('rollback', previous, 'restart-failed')
                raise
        raise
    finally:
        resume(connection)
        connection.close()


def main():
    os.umask(0o077)
    def interrupted(signum, frame):
        raise KeyboardInterrupt(f'signal {signum}')
    signal.signal(signal.SIGTERM, interrupted)
    if len(sys.argv) < 2 or TIMEOUT <= 0:
        raise RuntimeError('usage: deploy-self.sh <sha> | restore <snapshot.db[.gz]> [--confirm-discard] | resume')
    ROOT.mkdir(parents=True, exist_ok=True)
    with (ROOT / 'lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if sys.argv[1] == 'restore' and len(sys.argv) in (3, 4):
            if len(sys.argv) == 4 and sys.argv[3] != '--confirm-discard':
                raise RuntimeError('unknown restore argument')
            restore(Path(sys.argv[2]), len(sys.argv) == 4)
        elif sys.argv[1:] == ['resume']:
            with sqlite3.connect(f'file:{DB}?mode=rw', uri=True) as connection:
                resume(connection)
        elif len(sys.argv) == 2:
            try:
                deploy(sys.argv[1])
            except BaseException:
                log('deploy', sys.argv[1], 'failed')
                raise
        else:
            raise RuntimeError('invalid arguments')


if __name__ == '__main__':
    try:
        main()
    except (Exception, KeyboardInterrupt) as error:
        print(f'FAIL {error}', file=sys.stderr)
        sys.exit(1)
