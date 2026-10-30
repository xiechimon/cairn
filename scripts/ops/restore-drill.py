import argparse
import datetime
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import sqlite3
import struct
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request


MUTABLE_COLUMNS = {
    'machine': ('online tokenHash apiKeyId latestCliVersion enabledRuntimes claudeCodeReport claudeRateLimits maxConcurrent maxConcurrentOverridden lastSeenAt capabilities', 'Machine registration, configuration and heartbeat update without updatedAt.'),
    'todo': ('title spec phase phaseAt orderIndex assignment latestBuildId lastRunAt hasChanges hasPlan blockedBy v ownerId output userSpecAttachmentIds userMessageAttachmentIds', 'Todo edits and lifecycle transitions use phaseAt and v rather than updatedAt.'),
    'build': ('planDocId errorMessage prUrl prNumber changes diffHash baseSha harnessHash reportAttachmentId', 'Build execution and review metadata are updated in place.'),
    'step': ('machineId status quotaBlock fallback sessionId checkpointCommit claimedAt lastHeartbeatAt finishedAt prompt freshSession skillInjection blockerHandoff holdReason holdUntil holdCount', 'Step execution, claim and heartbeat state are updated in place.'),
    'token_usage': ('input output cacheRead cacheWrite costInput costOutput costCacheRead costCacheWrite costTotal', 'Usage totals accumulate during execution.'),
    'notification': ('readAt', 'Reading a notification changes readAt.'),
    'schedule': ('nextRunAt', 'The scheduler advances nextRunAt after execution.'),
    'chief': ('charter watches wakes lastTurnAt tz agentId', 'Chief configuration and turn state have no updatedAt.'),
    'branch_sync': ('status errorMessage startedAt finishedAt', 'Synchronization lifecycle advances in place.'),
    'attachment': ('status', 'Pending uploads transition to ready or failed.'),
    'tag': ('name color v', 'Tag edits are versioned by v.'),
    'team': ('name plan avatarStyle autonomyPaused firstPrReportPromptEnabled firstPrReportPromptDismissedAt firstPrReportPromptFirstPrAt firstPrReportPromptFirstPrNumber', 'Team preferences and onboarding state are edited in place.'),
    'user': ('displayName avatarUrl', 'Profile edits have no updatedAt.'),
    'project': ('name splitPolicy description repoKind repoName githubRepo localPath autonomy', 'Project settings have no updatedAt.'),
    'agent': ('displayName description status avatarUrl provider modelId thinkingLevel persona machineId tools secrets defaultSkill skillsAllowlist mcpServers maxConcurrentTasks requiredCapabilities fallbackModels', 'Agent configuration has no updatedAt.'),
    'member_activity': ('at', 'Member activity stores the latest write time.'),
    'autonomy_state': ('lastStartedAt baselineSha lastBlockedReason lastEvaluatedAt', 'Autonomy evaluation state advances in place.'),
    'schedule_report': ('decidedAt decidedBy appliedAt', 'Review and application of a generated report advance in place.'),
}
ROOT = Path(__file__).resolve().parents[2]


def inside(path, parent):
    return path == parent or parent in path.parents


def ident(name):
    return '"' + name.replace('"', '""') + '"'


def readonly(path):
    return sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)


def cell(value):
    if isinstance(value, str):
        return ('text', value.encode('utf-8'))
    if isinstance(value, float):
        return ('real', struct.pack('>d', value))
    return (type(value).__name__, value)


def tables(db):
    return {r[0] for r in db.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%'")}


def compare(restored, live, stamp, report):
    names = tables(restored)
    if names != tables(live):
        raise RuntimeError('content schema: table set differs')
    errors = []
    for table in sorted(names):
        columns = list(restored.execute(f'pragma table_info({ident(table)})'))
        if columns != list(live.execute(f'pragma table_info({ident(table)})')):
            raise RuntimeError(f'content schema: {table} columns differ')
        keys = [c[1] for c in sorted(columns, key=lambda c: c[5]) if c[5]]
        fields = [c[1] for c in columns]
        if not keys:
            if restored.execute(f'select count(*) from {ident(table)}').fetchone()[0] == 0 and live.execute(f'select count(*) from {ident(table)}').fetchone()[0] == 0:
                report['tables'][table] = dict(identical=0, changedAfterBackup=0, missing=0, differing=0, allowedMutable=0, addedAfterBackup=0)
                continue
            raise RuntimeError(f'content {table}: no primary key; comparison unsupported')
        projection = '*'
        if table == '__drizzle_migrations':
            keys = ['rowid']
            fields = ['rowid'] + fields
            projection = 'rowid,*'
            report['migrationIdentity'] = 'SQLite rowid: Drizzle serial ids are nullable and not populated.'
        key_indices = [fields.index(k) for k in keys]
        copies = []
        for db in (restored, live):
            rows = {}
            for row in db.execute(f'select {projection} from {ident(table)}'):
                key = tuple(cell(row[i]) for i in key_indices)
                if key in rows:
                    raise RuntimeError(f'content {table}: duplicate primary key')
                rows[key] = row
            copies.append(rows)
        old, current = copies
        counts = dict(identical=0, changedAfterBackup=0, missing=0, differing=0, allowedMutable=0, addedAfterBackup=0)
        allowed, reason = MUTABLE_COLUMNS.get(table, ('', ''))
        allowed = set(allowed.split()) & set(fields)
        if allowed:
            counts['allowlist'] = {'columns': sorted(allowed), 'reason': reason, 'limit': 'Changes to these columns cannot be dated; all other columns remain strict.'}
        for key in old.keys() | current.keys():
            a, b = old.get(key), current.get(key)
            label = '/'.join(str((a or b)[i]) for i in key_indices)
            if a is None or b is None:
                if a is None and 'createdAt' in fields and b[fields.index('createdAt')] > stamp:
                    counts['addedAfterBackup'] += 1
                else:
                    counts['missing'] += 1
                    errors.append(f'content {table} {label}: missing row')
                continue
            if all(cell(x) == cell(y) for x, y in zip(a, b)):
                counts['identical'] += 1
            elif 'updatedAt' in fields and b[fields.index('updatedAt')] is not None and b[fields.index('updatedAt')] > stamp:
                counts['changedAfterBackup'] += 1
            elif all(field in allowed or cell(x) == cell(y) for field, x, y in zip(fields, a, b)):
                counts['allowedMutable'] += 1
            else:
                counts['differing'] += 1
                errors.append(f'content {table} {label}: differing row')
        report['tables'][table] = counts
    if errors:
        raise RuntimeError('; '.join(errors))


def attachments(db, backup, live, report):
    count = 0
    for key, size in db.execute("select storageKey,sizeBytes from attachment where status='ready'"):
        paths = [(base / key).resolve() for base in (backup, live)]
        if Path(key).is_absolute() or '..' in Path(key).parts or any(not inside(p, base) for p, base in zip(paths, (backup, live))):
            raise RuntimeError(f'attachment unsafe key: {key}')
        try:
            if any(p.stat().st_size != size or not p.is_file() for p in paths):
                raise ValueError()
            digests = []
            for path in paths:
                with path.open('rb') as stream:
                    digests.append(hashlib.file_digest(stream, 'sha256').hexdigest())
            if digests[0] != digests[1]:
                raise ValueError()
        except (OSError, ValueError):
            raise RuntimeError(f'attachment {key}: missing, size or sha256 mismatch') from None
        count += 1
    report['attachments'] = {'checked': count}


def relationships(db, live, stamp, report):
    selected = live.execute('select b.todoId,b.id from build b where b.createdAt<=? and exists(select 1 from step s where s.buildId=b.id and s.createdAt<=?) order by b.createdAt desc,b.id desc limit 1', (stamp, stamp)).fetchone()
    if not selected:
        raise RuntimeError('relationship todo/build: no sample')
    todo_id, build_id = selected
    if not db.execute('select 1 from todo where id=?', (todo_id,)).fetchone() or not live.execute('select 1 from todo where id=?', (todo_id,)).fetchone() or not db.execute('select 1 from build where id=? and todoId=? and createdAt<=?', (build_id, todo_id, stamp)).fetchone():
        raise RuntimeError(f'relationship build {build_id}: missing todo/build')
    samples = {}
    for table, column, parent, label in [('step', 'buildId', build_id, 'steps'), ('message', 'conversationId', build_id, 'messages')]:
        query = f'select id from {ident(table)} where {ident(column)}=? and createdAt<=? order by id'
        expected = [r[0] for r in live.execute(query, (parent, stamp))]
        actual = [r[0] for r in db.execute(query, (parent, stamp))]
        if not expected or actual != expected:
            raise RuntimeError(f'relationship build {build_id}: {label} count or identity mismatch (live={len(expected)}, restored={len(actual)})')
        samples[label] = actual
    chief = live.execute('select t.id from chief_thread t where t.createdAt<=? and exists(select 1 from chief_message m where m.threadId=t.id and m.createdAt<=?) order by t.createdAt desc,t.id desc limit 1', (stamp, stamp)).fetchone()
    if not chief:
        raise RuntimeError('relationship chief_thread/messages: no sample')
    query = 'select id from chief_message where threadId=? and createdAt<=? order by id'
    expected = [r[0] for r in live.execute(query, (chief[0], stamp))]
    actual = [r[0] for r in db.execute(query, (chief[0], stamp))]
    if not db.execute('select 1 from chief_thread where id=? and createdAt<=?', (chief[0], stamp)).fetchone() or actual != expected:
        raise RuntimeError(f'relationship chief_thread {chief[0]}: missing thread or message count or identity mismatch (live={len(expected)}, restored={len(actual)})')
    report['relationships'] = dict(todo=todo_id, build=build_id, **samples, chiefThread=chief[0], chiefMessages=actual, cutoff=stamp)


def helper_failure(label, code, stderr, started=False):
    lines = [line for line in stderr.splitlines() if line != label + ' helper started']
    first = lines[0] if lines else ''
    safe = first if first in {'decrypt failed', 'node helper unavailable', 'api helper failed'} else 'stderr withheld' if first else 'stderr empty'
    kind = 'failed' if started else 'helper startup failed'
    return RuntimeError(f'{label} {kind}; exit={code}; {safe}')


def resolve_node():
    try:
        run = subprocess.run(['node', '-p', 'process.execPath'], text=True, capture_output=True, timeout=30)
    except OSError as error:
        raise helper_failure('node', error.errno, '') from None
    except subprocess.TimeoutExpired:
        raise helper_failure('node', 'timeout', '') from None
    path = run.stdout.strip()
    if run.returncode or not Path(path).is_absolute() or not Path(path).is_file():
        raise helper_failure('node', run.returncode, run.stderr)
    return path


def decrypt(db, key, env, report, node):
    candidates = [('secret', 'valueCipher'), ('provider', 'apiKeyCipher'), ('github_connection', 'accessTokenCipher'), ('feishu_binding', 'appSecretCipher')]
    envelope = None
    for table, column in candidates:
        if table in tables(db):
            row = db.execute(f'select {ident(column)} from {ident(table)} where {ident(column)} is not null and {ident(column)} != ? limit 1', ('',)).fetchone()
            if row:
                envelope = row[0]
                break
    if not envelope:
        raise RuntimeError('decrypt: no encrypted sample')
    try:
        run = subprocess.run([node, '--import', 'tsx', str(ROOT / 'scripts/ops/restore-drill-decrypt.mts'), str(key)], cwd=ROOT / 'apps/server', env=env, input=envelope, text=True, capture_output=True, timeout=30)
    except OSError as error:
        raise helper_failure('decrypt', error.errno, '') from None
    except subprocess.TimeoutExpired:
        raise helper_failure('decrypt', 'timeout', '') from None
    if run.returncode or run.stdout.strip() != 'decrypt ok':
        raise helper_failure('decrypt', run.returncode, run.stderr, 'decrypt helper started' in run.stderr.splitlines())
    report['decryption'] = 'decrypt ok'


def api(db, home, env, report, node):
    expected = dict(db.execute('select teamId,count(*) from todo group by teamId'))
    env = dict(env, CAIRN_HOME=str(home), CAIRN_SKILLS_DIR=str(home / 'skills'), CAIRN_MCP_CONFIG=str(home / 'mcp.json'), HOST='127.0.0.1', PORT='0', NODE_ENV='production', LOG_LEVEL='info')
    stderr = tempfile.TemporaryFile(mode='w+')
    try:
        process = subprocess.Popen([node, '--import', 'tsx', str(ROOT / 'scripts/ops/restore-drill-api.mts'), str(home), env['RESTORE_DRILL_KEY_PATH']], cwd=ROOT / 'apps/server', env=env, stdout=subprocess.PIPE, stderr=stderr, text=True)
    except OSError as error:
        stderr.close()
        raise helper_failure('api', error.errno, '') from None
    try:
        port = None
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline and process.poll() is None:
            if not selector.select(timeout=0.2):
                continue
            line = process.stdout.readline()
            try:
                item = json.loads(line)
                if item.get('error'):
                    code = item.get('code') if item.get('code') in ['EPERM', 'EACCES', 'EADDRINUSE'] else 'unknown'
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
                    stderr.seek(0)
                    raise RuntimeError(f'api listen failed: {code}; ' + str(helper_failure('api', process.returncode, stderr.read(), True)))
                if item.get('port') and item.get('dataDir') == str(home / 'server'):
                    port = item['port']
                    break
            except ValueError:
                pass
        selector.close()
        if port is None:
            stderr.seek(0)
            diagnostic = stderr.read()
            raise helper_failure('api', process.poll() if process.poll() is not None else 'timeout', diagnostic, 'api helper started' in diagnostic.splitlines())
        total = 0
        teams = [r[0] for r in db.execute('select id from team')]
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        for team in teams:
            url = f'http://127.0.0.1:{port}/api/todos?' + urllib.parse.urlencode({'teamId': team})
            with opener.open(url, timeout=5) as response:
                todos = json.load(response)
            if not isinstance(todos, list) or len(todos) != expected.get(team, 0):
                raise RuntimeError('api /api/todos count mismatch')
            total += len(todos)
        if total != sum(expected.values()):
            raise RuntimeError('api /api/todos total mismatch')
        report['api'] = {'count': total, 'teams': len(teams), 'surface': 'checkout server HTTP on restored fixture or host DB', 'provider': 'not exercised'}
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        process.stdout.close()
        stderr.close()


def publish(path, report):
    path.parent.mkdir(parents=True, exist_ok=True)
    for target, content in [(path, json.dumps(report, indent=2) + '\n'), (Path(str(path) + '.status'), f"{report['at']} {'PASS' if report['ok'] else 'FAIL'} restore-drill {report.get('error', 'ok')}\n")]:
        with tempfile.NamedTemporaryFile(mode='w', dir=target.parent, delete=False) as stream:
            stream.write(content)
            temporary = stream.name
        os.replace(temporary, target)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument('--backup', default='.')
    for name in ['live-db', 'attachments', 'live-attachments', 'secretbox-key', 'scratch', 'report']:
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    live, backup, scratch, key, report_path, attachment_copy, attachment_live = [Path(p).expanduser().resolve() for p in [args.live_db, args.backup, args.scratch, args.secretbox_key, args.report, args.attachments, args.live_attachments]]
    if backup.is_dir():
        copies = sorted(backup.glob('server-db-????????T??????Z.db.gz'))
        backup = copies[-1] if copies else backup
    protected = [live, key, backup]
    unsafe_report = any(inside(p, live.parent) or inside(p, attachment_copy) or inside(p, attachment_live) or p in protected for p in [report_path, Path(str(report_path) + '.status')])
    if unsafe_report or inside(report_path, scratch) or inside(Path(str(report_path) + '.status'), scratch):
        print('FAIL report unsafe location', file=sys.stderr)
        return 1
    report = {'ok': False, 'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'tables': {}}
    item = 'inputs'
    try:
        if inside(scratch, live.parent) or scratch == live or any(inside(p, scratch) for p in [live, key, backup, attachment_copy, attachment_live]):
            raise RuntimeError('scratch overlaps live data or input')
        if scratch.exists():
            raise RuntimeError('scratch already exists; use a new directory')
        if not live.is_file() or not key.is_file() or not backup.is_file() or not attachment_copy.is_dir() or not attachment_live.is_dir():
            raise RuntimeError('inputs missing')
        match = re.fullmatch(r'server-db-(\d{8}T\d{6}Z)\.db\.gz', backup.name)
        if not match:
            raise RuntimeError('backup timestamp filename invalid')
        stamp = datetime.datetime.strptime(match[1], '%Y%m%dT%H%M%SZ').replace(tzinfo=datetime.timezone.utc).timestamp() * 1000
        report['backupTimestamp'] = match[1]
        scratch.mkdir(parents=True)
        item = 'snapshot sqlite3 .backup'
        subprocess.run(['sqlite3', '-readonly', str(live), '.timeout 10000', '.backup live-snapshot.db'], cwd=scratch, check=True, capture_output=True, timeout=60)
        home = scratch / 'home'
        server_dir = home / 'server'
        server_dir.mkdir(parents=True)
        restored_path = server_dir / 'server.db'
        item = 'restore gzip'
        with gzip.open(backup, 'rb') as source, restored_path.open('xb') as dest:
            shutil.copyfileobj(source, dest)
        with readonly(restored_path) as db, readonly(scratch / 'live-snapshot.db') as snapshot:
            item = 'integrity_check'
            if list(db.execute('pragma integrity_check')) != [('ok',)]:
                raise RuntimeError('integrity_check failed')
            report['integrity'] = 'ok'
            item = 'relationships'
            relationships(db, snapshot, stamp, report)
            item = 'foreign_key_check'
            if list(db.execute('pragma foreign_key_check')):
                raise RuntimeError('foreign_key_check failed')
            report['foreignKeys'] = 'ok'
            item = 'content'
            compare(db, snapshot, stamp, report)
            item = 'attachments'
            attachments(db, attachment_copy, attachment_live, report)
            item = 'node resolution'
            node = resolve_node()
            env = {k: v for k, v in os.environ.items() if k in ['PATH', 'TMPDIR', 'SYSTEMROOT']}
            env['HOME'] = str(home)
            item = 'decrypt'
            decrypt(db, key, env, report, node)
            env['RESTORE_DRILL_KEY_PATH'] = str(key)
            item = 'api'
            api(db, home, env, report, node)
        report['ok'] = True
    except Exception as error:
        safe_error = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        report['error'] = f'{item}: {safe_error}'
        print('FAIL ' + report['error'], file=sys.stderr)
    publish(report_path, report)
    if report['ok']:
        print('PASS restore-drill; decrypt ok')
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())
