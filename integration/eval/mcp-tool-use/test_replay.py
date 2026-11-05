import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('replay', Path(__file__).with_name('replay.py'))
replay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(replay)


class ReplayTests(unittest.TestCase):
    def test_required_args_and_order_use_distinct_calls(self):
        case = {'required': [{'tool': 'models'}, {'tool': 'create_agent', 'args': {'modelId': 'known'}}]}
        self.assertTrue(replay.grade(case, [{'tool': 'models'}, {'tool': 'create_agent', 'args': {'modelId': 'known', 'name': 'builder'}}])['passed'])
        self.assertFalse(replay.grade(case, [{'tool': 'create_agent', 'args': {'modelId': 'known'}}, {'tool': 'models'}])['passed'])
        self.assertFalse(replay.grade(case, [{'tool': 'models'}, {'tool': 'create_agent', 'args': {'modelId': 'guessed'}}])['passed'])
        self.assertFalse(replay.grade({'required': [{'tool': 'models'}, {'tool': 'models'}]}, [{'tool': 'models'}])['passed'])

    def test_forbidden_matches_every_call_even_after_success(self):
        case = {'required': [{'tool': 'todos'}], 'forbidden': [{'tool': 'delete_todo'}]}
        result = replay.grade(case, [{'tool': 'todos'}, {'tool': 'delete_todo'}])
        self.assertFalse(result['passed'])
        self.assertIn('forbidden:1', result['failures'])

    def test_failed_required_call_does_not_satisfy_requirement(self):
        self.assertFalse(replay.grade({'required': [{'tool': 'todos'}]}, [{'tool': 'todos', 'error': 'unauthorized'}])['passed'])

    def test_empty_or_malformed_trace_fails_closed(self):
        for trace in [[], [{'name': 'todos'}], [{'tool': 'todos', 'args': []}]]:
            self.assertFalse(replay.grade({'required': [{'tool': 'todos'}]}, trace)['passed'])

    def test_fixture_is_never_model_improvement(self):
        report = replay.evaluate({'cases': [{'id': 'a', 'required': [{'tool': 'todos'}]}]}, {'kind': 'fixture', 'traces': {'a': [{'tool': 'todos'}]}})
        self.assertEqual(report['passed'], 1)
        self.assertFalse(report['model_improvement_evidence'])

    def test_measured_runs_require_complete_binding_and_coverage(self):
        pack = {'cases': [{'id': 'a', 'required': [{'tool': 'todos'}]}]}
        run = {'kind': 'metered', 'traces': {'a': [{'tool': 'todos'}]}}
        with self.assertRaises(ValueError):
            replay.evaluate(pack, run)
        run.update(model='model', harness_sha='a' * 40, task_set_sha='b' * 64, cost_usd=0.1, run_id='run', executed_at='2026-11-04T00:00:00Z')
        self.assertTrue(replay.evaluate(pack, run)['metered'])
        run['cost_usd'] = -1
        with self.assertRaises(ValueError):
            replay.evaluate(pack, run)

    def test_registry_validates_required_and_nested_types(self):
        registry = {'run_builds': {'type': 'object', 'required': ['todoIds'], 'properties': {'todoIds': {'type': 'array', 'items': {'type': 'string'}}}}}
        self.assertFalse(replay.grade({}, [{'tool': 'run_builds', 'args': {}}], registry)['passed'])
        self.assertFalse(replay.grade({}, [{'tool': 'run_builds', 'args': {'todoIds': [1]}}], registry)['passed'])
        self.assertFalse(replay.grade({}, [{'tool': 'unknown'}], registry)['passed'])
        self.assertFalse(replay.grade({}, [{'tool': 'run_builds', 'args': {'todoIds': [True]}}], registry)['passed'])

    def test_mock_session_records_real_tool_results_and_limits_calls(self):
        case = {'prompt': 'Read the tasks', 'mocks': {'todos': {'todos': []}}}
        registry = {'todos': {'type': 'object'}}
        requests = []
        def adapter(request):
            requests.append(request)
            return {'calls': [{'tool': 'todos', 'args': {}}]} if len(requests) == 1 else {'text': 'No tasks'}
        result = replay.play(case, registry, adapter)
        self.assertEqual(result['trace'][0]['result'], {'todos': []})
        self.assertEqual(requests[1]['history'][0]['result'], {'todos': []})
        self.assertEqual(result['text'], 'No tasks')
        with self.assertRaises(ValueError):
            replay.play(case, registry, lambda request: {'calls': [{'tool': 'todos'}]}, max_rounds=2)

    def test_pack_does_not_claim_ten_recorded_model_mistakes(self):
        import json
        pack = json.loads(Path(__file__).with_name('cases.json').read_text())
        self.assertGreaterEqual(len(pack['cases']), 10)
        self.assertLess(sum(c['provenance']['kind'] == 'model-incident' for c in pack['cases']), 10)
        self.assertTrue(all(c['provenance']['source'] for c in pack['cases']))


if __name__ == '__main__':
    unittest.main()
