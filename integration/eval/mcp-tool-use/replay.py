import argparse
import hashlib
import json
import math
import re
from pathlib import Path


def matches(expected, actual):
    if isinstance(expected, dict):
        return isinstance(actual, dict) and all(k in actual and matches(v, actual[k]) for k, v in expected.items())
    return type(expected) is type(actual) and expected == actual


def schema_errors(schema, value, path='args'):
    errors = []
    if set(schema) - {'type', 'properties', 'required', 'items', 'description', 'enum', 'additionalProperties'}:
        return [f'{path}:unsupported-schema']
    types = {'object': dict, 'array': list, 'string': str, 'boolean': bool, 'number': (int, float), 'integer': int, 'null': type(None)}
    kind = schema.get('type')
    if kind in types and (not isinstance(value, types[kind]) or kind in ('number', 'integer') and isinstance(value, bool)):
        return [f'{path}:type']
    if 'enum' in schema and not any(matches(item, value) for item in schema['enum']):
        errors.append(f'{path}:enum')
    if isinstance(value, dict):
        errors.extend(f'{path}.{key}:required' for key in schema.get('required', []) if key not in value)
        for key, item in value.items():
            if key in schema.get('properties', {}):
                errors.extend(schema_errors(schema['properties'][key], item, f'{path}.{key}'))
            elif schema.get('additionalProperties') is False:
                errors.append(f'{path}.{key}:unknown')
    if isinstance(value, list) and 'items' in schema:
        for index, item in enumerate(value):
            errors.extend(schema_errors(schema['items'], item, f'{path}[{index}]'))
    return errors


def grade(case, trace, registry=None):
    failures = []
    if not isinstance(trace, list):
        return {'passed': False, 'failures': ['invalid-trace']}
    for index, call in enumerate(trace):
        if not isinstance(call, dict) or not isinstance(call.get('tool'), str) or not isinstance(call.get('args', {}), dict):
            failures.append(f'invalid-call:{index}')
            continue
        if registry is not None:
            if call['tool'] not in registry:
                failures.append(f'unknown-tool:{index}')
            else:
                failures.extend(f'schema:{index}:{error}' for error in schema_errors(registry[call['tool']], call.get('args', {})))
        if any(matches(rule, call) for rule in case.get('forbidden', [])):
            failures.append(f'forbidden:{index}')
    cursor = 0
    for index, rule in enumerate(case.get('required', [])):
        found = next((i for i in range(cursor, len(trace)) if isinstance(trace[i], dict) and not trace[i].get('error') and matches(rule, trace[i])), None)
        if found is None:
            failures.append(f'missing-or-out-of-order:{index}')
        else:
            cursor = found + 1
    for rule in case.get('limits', []):
        count = sum(isinstance(call, dict) and matches(rule['call'], call) for call in trace)
        if count > rule['max']:
            failures.append(f'excess-calls:{rule["call"]["tool"]}')
    return {'passed': not failures, 'failures': failures}


def play(case, registry, adapter, max_rounds=12):
    history = []
    for _ in range(max_rounds):
        reply = adapter({'prompt': case['prompt'], 'tools': registry, 'history': list(history)})
        if not isinstance(reply, dict):
            raise ValueError('Adapter must return an object')
        if 'calls' not in reply:
            if not isinstance(reply.get('text'), str):
                raise ValueError('Adapter must return calls or final text')
            return {'trace': history, 'text': reply['text']}
        if not isinstance(reply['calls'], list) or not reply['calls']:
            raise ValueError('Tool calls must be a nonempty list')
        if len(history) + len(reply['calls']) > 64:
            raise ValueError('Tool call limit exceeded')
        for call in reply['calls']:
            result = grade({}, [call], registry)
            recorded = dict(call)
            if not result['passed']:
                recorded['error'] = ';'.join(result['failures'])
            elif call['tool'] not in case.get('mocks', {}):
                recorded['error'] = 'No mock configured; no product write was performed'
            else:
                recorded['result'] = case['mocks'][call['tool']]
            history.append(recorded)
    raise ValueError('Round limit exceeded')


def evaluate(pack, run, registry=None):
    if run.get('kind') not in ('fixture', 'metered'):
        raise ValueError('Run kind must be fixture or metered')
    if run['kind'] == 'metered':
        for field in ('model', 'run_id', 'executed_at'):
            if not isinstance(run.get(field), str) or not run[field].strip():
                raise ValueError(f'Missing {field}')
        for field, length in [('harness_sha', 40), ('task_set_sha', 64)]:
            if not re.fullmatch(f'[0-9a-f]{{{length}}}', run.get(field, '')):
                raise ValueError(f'Invalid {field}')
        cost = run.get('cost_usd')
        if isinstance(cost, bool) or not isinstance(cost, (int, float)) or not math.isfinite(cost) or cost < 0:
            raise ValueError('Invalid cost_usd')
    cases = pack['cases']
    ids = [case['id'] for case in cases]
    if len(ids) != len(set(ids)) or not ids:
        raise ValueError('Case ids must be unique and nonempty')
    if set(run.get('traces', {})) != set(ids):
        raise ValueError('Trace ids must match every case exactly')
    results = {case['id']: grade(case, run['traces'][case['id']], registry) for case in cases}
    return {'kind': run['kind'], 'metered': run['kind'] == 'metered', 'model_improvement_evidence': False,
            'passed': sum(result['passed'] for result in results.values()), 'total': len(cases),
            'cost_usd': run.get('cost_usd'), 'binding': {key: run.get(key) for key in ('model', 'harness_sha', 'task_set_sha', 'run_id', 'executed_at')},
            'provenance_counts': {kind: sum(case.get('provenance', {}).get('kind') == kind for case in cases) for kind in sorted({case.get('provenance', {}).get('kind', 'unspecified') for case in cases})},
            'results': results}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--cases', type=Path, default=Path(__file__).with_name('cases.json'))
    parser.add_argument('--run', type=Path, required=True)
    parser.add_argument('--registry', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    raw_cases = args.cases.read_bytes()
    run = json.loads(args.run.read_text())
    digest = hashlib.sha256(raw_cases).hexdigest()
    if run.get('kind') == 'metered' and run.get('task_set_sha') != digest:
        raise ValueError('Task-set digest does not match cases')
    report = evaluate(json.loads(raw_cases), run, json.loads(args.registry.read_text()))
    report['task_set_digest'] = digest
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'passed': report['passed'], 'total': report['total'], 'kind': report['kind']}))
    return 0 if report['passed'] == report['total'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
