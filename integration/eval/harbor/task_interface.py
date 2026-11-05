import argparse
import json
from pathlib import Path, PurePosixPath
import posixpath
import re
import subprocess

SCRIPT = Path(__file__).with_name("task-interface.mjs")
SOURCE_SUFFIXES = (".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".jsx")


def parse_source(path, source, names=(), public_names=None):
    result = subprocess.run(
        ["node", str(SCRIPT)],
        input=json.dumps({"path": path, "source": source, "names": list(names), "publicNames": public_names or {}}),
        text=True, capture_output=True, check=True, timeout=60,
    )
    return json.loads(result.stdout)


def require_no_assertion_literals(declarations, literals):
    for match in re.finditer(r'''(["'`])((?:\\.|(?!\1).)*)\1''', declarations):
        value = match.group(2)
        if value in literals:
            raise ValueError("Interface contains an assertion literal")


class SourceSnapshot:
    def __init__(self, repo, provenance, tests):
        self.repo = repo
        self.base = provenance["baseSha"]
        self.head = provenance["headSha"]
        if not all(re.fullmatch(r"[a-f0-9]{40}", sha) for sha in (self.base, self.head)):
            raise ValueError("Expected full base and head commit SHAs")
        self.paths = set(provenance["paths"])
        self.tests = tests
        self.base_tree = self.tree(self.base)
        self.head_tree = self.tree(self.head)
        self.reads = {}
        self.refusals = {}

    def tree(self, sha):
        result = subprocess.run(
            ["git", "ls-tree", "-r", "-z", "--full-tree", sha],
            cwd=self.repo, text=True, capture_output=True, check=True,
        )
        entries = {}
        for line in result.stdout.rstrip("\0").split("\0"):
            if not line:
                continue
            descriptor, path = line.split("\t", 1)
            mode, kind, blob = descriptor.split(" ")
            entries[path] = {"mode": mode, "kind": kind, "blob": blob}
        return entries

    def record(self, path):
        return {
            "path": path,
            "headBlobSha": self.head_tree[path]["blob"],
            "baseBlobSha": (self.base_tree.get(path) or {}).get("blob"),
            "inTaskProvenance": path in self.paths,
        }

    def available(self, path):
        entry = self.head_tree.get(path)
        if not entry or PurePosixPath(path).suffix not in SOURCE_SUFFIXES:
            return False
        reason = None
        if path in self.tests:
            reason = "grader-source"
        elif entry["kind"] != "blob" or entry["mode"] not in ("100644", "100755"):
            reason = "unsupported-source-kind"
        elif path not in self.paths and entry != self.base_tree.get(path):
            reason = "changed-outside-provenance"
        if reason:
            self.refusals[(path, reason)] = self.record(path) | {"reason": reason}
            return False
        return True

    def read(self, path, grader=False):
        if grader:
            if path not in self.paths or path not in self.tests or path not in self.head_tree:
                return None
        elif not self.available(path):
            return None
        result = subprocess.run(
            ["git", "show", f"{self.head}:{path}"],
            cwd=self.repo, text=True, capture_output=True,
        )
        if result.returncode:
            self.refusals[(path, "unreadable-source")] = self.record(path) | {"reason": "unreadable-source"}
            return None
        self.reads[path] = self.record(path)
        return result.stdout


def resolve_source(sources, origin, module_path, snapshot=None):
    if not isinstance(module_path, str) or not module_path.startswith("."):
        return None
    resolved = posixpath.normpath(str(PurePosixPath(origin).parent / module_path))
    stem = str(PurePosixPath(resolved).with_suffix("")) if PurePosixPath(resolved).suffix else resolved
    candidates = [resolved, *(stem + suffix for suffix in SOURCE_SUFFIXES)]
    candidates += [resolved + "/index" + suffix for suffix in SOURCE_SUFFIXES]
    found = {
        candidate for candidate in candidates
        if candidate in sources or (snapshot and candidate in snapshot.head_tree)
    }
    if len(found) != 1:
        return None
    target = next(iter(found))
    return target if target in sources or (snapshot and snapshot.available(target)) else None


def interface_sections(sources, tests, snapshot=None, evidence=None):
    requested = {}
    import_paths = {}
    literals = set()
    parsed_sources = {}
    details = evidence if evidence is not None else {}
    details.update(edges=[], findings=[], resolutionSources=[], requests=[])

    def resolve_export(path, name, seen):
        if name == "default" or (path, name) in seen:
            details["findings"].append({"path": path, "name": name, "reason": "default-or-cycle"})
            return set(), False
        if path not in sources:
            text = snapshot.read(path) if snapshot else None
            if text is None:
                details["findings"].append({"path": path, "name": name, "reason": "unavailable-source"})
                return set(), False
            sources[path] = text
        if path not in parsed_sources:
            parsed_sources[path] = parse_source(path, sources[path])
            details["resolutionSources"].append(path)
        parsed = parsed_sources[path]
        if name in parsed["unsupportedExports"]:
            details["findings"].append({"path": path, "name": name, "reason": "unsupported-export"})
            return set(), False
        local = [entry for entry in parsed["publicExports"] if entry["name"] == name]
        forwarded = [entry for entry in parsed["reexports"] if entry["name"] == name]
        if len(local) + len(forwarded) > 1:
            details["findings"].append({"path": path, "name": name, "reason": "ambiguous-explicit-export"})
            return set(), False
        if local:
            return {(path, local[0]["localName"])}, True
        visited = seen | {(path, name)}
        if forwarded:
            entry = forwarded[0]
            target = resolve_source(sources, path, entry["path"], snapshot)
            details["edges"].append({"origin": path, "kind": "named", "specifier": entry["path"], "target": target})
            if not target:
                details["findings"].append({"path": path, "name": name, "reason": "unresolved-or-ambiguous-module"})
                return set(), False
            return resolve_export(target, entry["sourceName"], visited)
        terminals = set()
        for module_path in parsed["starExports"]:
            target = resolve_source(sources, path, module_path, snapshot)
            details["edges"].append({"origin": path, "kind": "star", "specifier": module_path, "target": target})
            if not target:
                details["findings"].append({"path": path, "name": name, "reason": "unresolved-or-ambiguous-module"})
                return set(), False
            matches, complete = resolve_export(target, name, visited)
            if not complete:
                return set(), False
            terminals.update(matches)
        if len(terminals) > 1:
            details["findings"].append({"path": path, "name": name, "reason": "ambiguous-star-export"})
            return set(), False
        return terminals, True

    for test_path, text in sorted(tests.items()):
        parsed = parse_source(test_path, text)
        literals.update(parsed["assertionLiterals"])
        for imported in parsed["imports"]:
            found = resolve_source(sources, test_path, imported["path"])
            if found:
                requested.setdefault(found, set()).update(imported["names"])
                import_paths.setdefault(found, set()).add(imported["path"])
    sections = []
    for path, names in sorted(requested.items()):
        groups = {}
        transitive = False
        for name in sorted(names):
            terminals, complete = resolve_export(path, name, set())
            details["requests"].append({
                "path": path, "name": name, "complete": complete,
                "terminals": [{"path": target, "localName": local_name} for target, local_name in sorted(terminals)],
            })
            if not complete or len(terminals) != 1:
                continue
            target, local_name = next(iter(terminals))
            groups.setdefault(target, {}).setdefault(local_name, []).append(name)
            transitive = transitive or (target, local_name) != (path, name)
        blocks = []
        for target, public_names in sorted(groups.items()):
            declarations = parse_source(target, sources[target], sorted(public_names), public_names=public_names)["declarations"]
            if not declarations:
                continue
            require_no_assertion_literals(declarations, literals)
            blocks.append(f"```typescript\n{declarations}\n```")
        if not blocks:
            continue
        imports = ""
        if transitive:
            imports = "\n\n" + "\n".join(f"Import path: `{value}`" for value in sorted(import_paths[path]))
        sections.append(f"### `{path}`" + imports + "\n\n" + "\n\n".join(blocks))
    return "\n\n".join(sections)


def build_interface(task, repo):
    provenance = json.loads((task / "provenance.json").read_text())
    test_paths = set((task / "tests/grader-paths.txt").read_text().splitlines())
    snapshot = SourceSnapshot(repo, provenance, test_paths)
    sources, tests = {}, {}
    for path in sorted(provenance["paths"]):
        if PurePosixPath(path).suffix not in SOURCE_SUFFIXES:
            continue
        text = snapshot.read(path, grader=path in test_paths)
        if text is not None:
            (tests if path in test_paths else sources)[path] = text
    details = {}
    interface = interface_sections(sources, tests, snapshot, details)
    evidence = {
        "schemaVersion": 1,
        "baseSha": snapshot.base,
        "headSha": snapshot.head,
        "additionalSources": [snapshot.reads[path] for path in sorted(snapshot.reads) if path not in snapshot.paths],
        "resolutionSources": [snapshot.record(path) for path in sorted(set(details["resolutionSources"]))],
        "refusedSources": [snapshot.refusals[key] for key in sorted(snapshot.refusals)],
    }
    for name in ("edges", "findings", "requests"):
        evidence[name] = [json.loads(value) for value in sorted({json.dumps(item, sort_keys=True) for item in details[name]})]
    return interface, evidence


def add_interface(task, repo):
    interface, evidence = build_interface(task, repo)
    instruction = task / "instruction.md"
    original = task / "instruction.pre-interface.md"
    if not original.exists():
        original.write_text(instruction.read_text())
    text = original.read_text()
    if interface:
        text += (
            "\n## Interface\n\nThe regression tests call the following public interfaces. "
            "Only names, call signatures and input shapes are specified here; "
            "return types marked unknown are unspecified.\n\n" + interface + "\n"
        )
    instruction.write_text(text)
    (task / "interface.provenance.json").write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n")
    return bool(interface)


def main():
    parser = argparse.ArgumentParser(description="Add public call interfaces without solution bodies or expected outputs")
    parser.add_argument("--tasks", type=Path, required=True)
    parser.add_argument("--repo", type=Path, required=True)
    args = parser.parse_args()
    for task in sorted(args.tasks.glob("task-*")):
        print(f"{task.name}: {'interface added' if add_interface(task, args.repo) else 'no callable interface'}", flush=True)


if __name__ == "__main__":
    main()
