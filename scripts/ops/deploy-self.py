import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import shlex
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
UNITS = os.environ.get('CAIRN_DEPLOY_UNITS', 'cairn-server.service cairn-daemon.service').split()
BACKUP_TIMER = os.environ.get('CAIRN_DEPLOY_BACKUP_TIMER', 'cairn-db-backup.timer')
BACKUP_OUT = Path(os.environ.get('CAIRN_DEPLOY_BACKUP_OUT', str(ROOT / 'backups'))).resolve()
SCRATCH_PORT = os.environ.get('CAIRN_DEPLOY_SCRATCH_PORT', '18787')
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
        print(f'PASS {name} {sha}', flush=True)


def gate(sha):
    if not re.fullmatch('[0-9a-f]{40}', sha):
        raise RuntimeError('a full lowercase commit SHA is required')
    comparison = json.loads(run(['gh', 'api', f'repos/{REPOSITORY}/compare/{sha}...main']))
    if comparison.get('status') not in ('ahead', 'identical'):
        raise RuntimeError('SHA is not on origin/main')
    print(f'PASS main {sha}', flush=True)
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
    env.update({'HOME': str(home), 'CAIRN_HOME': str(home), 'CAIRN_TOKEN': TOKEN, 'CAIRN_REQUIRE_TOKEN': '1', 'HOST': '127.0.0.1', 'PORT': SCRATCH_PORT, 'NODE_ENV': 'production'})
    with (ROOT / f'{label}.log').open('w') as output:
        process = subprocess.Popen(['node', '--import', 'tsx', 'src/index.ts'], cwd=release / 'apps/server', env=env, stdout=output, stderr=output, start_new_session=True)
        try:
            def ready():
                if process.poll() is not None:
                    raise RuntimeError('scratch server exited')
                time.sleep(0.1)
                user = read_api(f'http://127.0.0.1:{SCRATCH_PORT}', '/api/user/me')
                teams = read_api(f'http://127.0.0.1:{SCRATCH_PORT}', '/api/teams')
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


def install_barriers(connection):
    with connection:
        connection.execute('update deploy_pause_state set deadline=?', (time.time() + max(TIMEOUT * 4, 600),))
        connection.execute('drop trigger if exists deploy_claim_barrier')
        connection.execute('drop trigger if exists deploy_claim_insert_barrier')
        active = "exists(select 1 from deploy_pause_state where deadline>cast(strftime('%s','now') as integer))"
        connection.execute(f"create trigger deploy_claim_barrier before update of status on step when NEW.status='claimed' and OLD.status!='claimed' and {active} begin select raise(ignore); end")
        connection.execute(f"create trigger deploy_claim_insert_barrier before insert on step when NEW.status='claimed' and {active} begin select raise(ignore); end")


def restart(connection=None):
    run(['systemctl', '--user', 'stop', UNITS[1]])
    run(['systemctl', '--user', 'restart', UNITS[0]])
    if connection is not None:
        def ready():
            user = read_api(URL, '/api/user/me')
            teams = read_api(URL, '/api/teams')
            return isinstance(user.get('id'), str) and isinstance(teams, list)
        wait_for(ready, 'server migration readiness')
        install_barriers(connection)
    run(['systemctl', '--user', 'restart', UNITS[1]])


def drain(connection):
    with connection:
        connection.execute('begin immediate')
        connection.execute('create table deploy_pause_state(id text primary key, paused integer not null, deadline real not null)')
        connection.execute('insert into deploy_pause_state select id, autonomyPaused, ? from team', (time.time() + max(TIMEOUT * 4, 600),))
        connection.execute('update team set autonomyPaused=1')
        active = "exists(select 1 from deploy_pause_state where deadline>cast(strftime('%s','now') as integer))"
        connection.execute(f"create trigger deploy_claim_barrier before update of status on step when NEW.status='claimed' and OLD.status!='claimed' and {active} begin select raise(ignore); end")
        connection.execute(f"create trigger deploy_claim_insert_barrier before insert on step when NEW.status='claimed' and {active} begin select raise(ignore); end")


def resume(connection):
    with connection:
        restored = connection.execute('select team.id, paused, autonomyPaused from deploy_pause_state join team using(id) order by id').fetchall()
        connection.execute('update team set autonomyPaused=(select paused from deploy_pause_state where id=team.id) where autonomyPaused=1 and id in (select id from deploy_pause_state)')
    for team_id, paused, current in restored:
        if current == 1:
            print(json.dumps({'id': team_id, 'autonomyPaused': paused}), flush=True)
        else:
            print(json.dumps({'id': team_id, 'autonomyPaused': current, 'result': 'left unchanged'}), flush=True)
    with connection:
        connection.execute('drop trigger if exists deploy_claim_barrier')
        connection.execute('drop trigger if exists deploy_claim_insert_barrier')
        connection.execute('drop table deploy_pause_state')
    print('Restored saved team pause values; claim barriers removed', flush=True)


def discard_report(live):
    discarded = []
    for (table,) in live.execute("select name from main.sqlite_master where type='table' and name not like 'sqlite_%' order by name").fetchall():
        quoted = '"' + table.replace('"', '""') + '"'
        try:
            rows = live.execute(f'select * from main.{quoted} except select * from snapshot.{quoted}').fetchall()
        except sqlite3.Error:
            rows = live.execute(f'select * from main.{quoted}').fetchall()
        for row in rows:
            discarded.append(json.dumps({'table': table, 'discardedCurrentRow': row}, default=str, sort_keys=True))
    discarded.sort()
    for row in discarded:
        print(row, flush=True)
    digest = hashlib.sha256('\n'.join(discarded).encode()).hexdigest()
    print(f'DISCARD_DIGEST {digest}', flush=True)
    return digest


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
        try:
            for unit in [*reversed(UNITS), BACKUP_TIMER]:
                run(['systemctl', '--user', 'stop', unit])
            if not confirm:
                print('Configured writers stopped; they remain stopped until confirmation or explicit operator restart', flush=True)
            with sqlite3.connect(f'file:{DB}?mode=rw', uri=True) as live:
                live.execute('attach database ? as snapshot', (str(source),))
                digest = discard_report(live)
            if not confirm:
                raise RuntimeError('restore requires --confirm-discard <digest>; rows above would be discarded')
            if confirm != digest:
                raise RuntimeError('discard set changed; preview again before confirming')
            destination = sqlite3.connect(DB)
            try:
                saved.backup(destination)
                if destination.execute("select count(*) from sqlite_master where type='table' and name='deploy_pause_state'").fetchone()[0]:
                    resume(destination)
            finally:
                destination.close()
            log('restore', '', 'confirmed-discard')
        finally:
            saved.close()
            if confirm:
                failures = []
                for unit in [*UNITS, BACKUP_TIMER]:
                    try:
                        run(['systemctl', '--user', 'start', unit])
                    except BaseException as error:
                        failures.append(f'{unit}: {error}')
                if failures:
                    raise RuntimeError('service recovery failed: ' + '; '.join(failures))


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
    for unit, app in zip(UNITS, ['server', 'daemon']):
        working = run(['systemctl', '--user', 'show', unit, '--property=WorkingDirectory', '--value'])
        if working != str(ROOT / 'current' / 'apps' / app):
            raise RuntimeError(f'{unit} WorkingDirectory must point through current; install the drop-in')
    gate(sha)
    release = ROOT / 'releases' / sha
    if release.exists():
        raise RuntimeError('release already exists; inspect and remove the failed worktree explicitly')
    git('fetch', 'origin', 'main')
    git('worktree', 'add', '--detach', release, sha)
    run(['pnpm', 'install', '--frozen-lockfile'], cwd=release)
    run(['node', '-e', "const Database = require('better-sqlite3'); const db = new Database(':memory:'); db.close();"], cwd=release / 'apps/server')
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
    switched = False
    try:
        drain(connection)
        wait_for(lambda: connection.execute("select count(*) from step where status='claimed'").fetchone()[0] == 0, 'drain')
        run(['bash', Path(__file__).with_name('backup-server-db.sh'), '--db', DB, '--out', BACKUP_OUT])
        select_release(sha)
        switched = True
        restart(connection)
        heartbeat = connection.execute('select coalesce(lastSeenAt,0) from machine where id=?', (MACHINE,)).fetchone()[0]
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
                restart(connection)
                log('rollback', previous, 'restarted-without-db-restore')
            except BaseException:
                log('rollback', previous, 'restart-failed')
                raise
        raise
    finally:
        try:
            if connection.execute("select 1 from sqlite_master where name='deploy_pause_state'").fetchone():
                resume(connection)
        finally:
            connection.close()


def refuse_paused():
    if not DB.exists():
        return
    connection = sqlite3.connect(DB.as_uri() + '?mode=ro&vfs=unix-none', uri=True)
    try:
        connection.execute('pragma locking_mode=exclusive')
        if connection.execute("select 1 from sqlite_master where type='table' and name='deploy_pause_state'").fetchone():
            columns = [row[1] for row in connection.execute('pragma table_info(deploy_pause_state)')]
            deadline = connection.execute('select max(deadline) from deploy_pause_state').fetchone()[0] if 'deadline' in columns else 'legacy state without expiry'
            raise RuntimeError(f'leftover deploy_pause_state; deadline={deadline}; inspect release and unit state, then run deploy-self.sh resume')
    finally:
        connection.close()


def validate_instance():
    defaults = ['cairn-server.service', 'cairn-daemon.service']
    if UNITS != defaults and (DB == Path('/mnt/fast/cairn/server/server.db').resolve() or BACKUP_TIMER == 'cairn-db-backup.timer' or URL.rstrip('/') == 'http://127.0.0.1:8787'):
        raise RuntimeError('custom units must not use the live default DB, backup timer or URL')
    environment = run(['systemctl', '--user', 'show', '-p', 'Environment', UNITS[0]])
    values = dict(item.split('=', 1) for item in shlex.split(environment.removeprefix('Environment=')) if '=' in item)
    home = values.get('CAIRN_HOME', '')
    if not home or not Path(home).is_absolute() or not DB.is_relative_to(Path(home).resolve()) or DB == Path(home).resolve():
        raise RuntimeError('DB must sit under the server unit CAIRN_HOME from systemctl Environment')


def main():
    os.umask(0o077)
    def interrupted(signum, frame):
        raise KeyboardInterrupt(f'signal {signum}')
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGHUP, interrupted)
    if len(sys.argv) < 2 or TIMEOUT <= 0:
        raise RuntimeError('usage: deploy-self.sh <sha> | check <sha> | restore <snapshot.db[.gz]> [--confirm-discard <digest>] | resume')
    if sys.argv[1] != 'resume':
        refuse_paused()
    if sys.argv[1] == 'check':
        if len(sys.argv) != 3:
            raise RuntimeError('usage: deploy-self.sh check <sha>')
        gate(sys.argv[2])
        return
    if len(UNITS) != 2 or len(set(UNITS)) != 2 or any(not re.fullmatch(r'[A-Za-z0-9_.@:-]+\.service', unit) for unit in UNITS):
        raise RuntimeError('CAIRN_DEPLOY_UNITS must name server and daemon services in that order')
    if not SCRATCH_PORT.isdecimal() or not 1 <= int(SCRATCH_PORT) <= 65535:
        raise RuntimeError('CAIRN_DEPLOY_SCRATCH_PORT must be a TCP port')
    validate_instance()
    ROOT.mkdir(parents=True, exist_ok=True)
    with (ROOT / 'lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if sys.argv[1] != 'resume':
            refuse_paused()
        if sys.argv[1] == 'restore' and len(sys.argv) in (3, 5):
            if len(sys.argv) == 5 and (sys.argv[3] != '--confirm-discard' or not re.fullmatch('[0-9a-f]{64}', sys.argv[4])):
                raise RuntimeError('unknown restore argument')
            restore(Path(sys.argv[2]), sys.argv[4] if len(sys.argv) == 5 else None)
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
