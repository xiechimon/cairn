from datetime import datetime
import json
import os
from pathlib import Path
import subprocess
import threading

CGROUP_SCOPE = "/sys/fs/cgroup/system.slice/docker-{id}.scope/cpu.stat"


def parse_time(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def phase_seconds(timing):
    if not timing or not timing.get("started_at") or not timing.get("finished_at"):
        return None
    return round(
        (parse_time(timing["finished_at"]) - parse_time(timing["started_at"])).total_seconds(),
        3,
    )


def timing_record(lock_requested, lock_acquired, harbor_finished, result, cpu_seconds):
    return {
        "lockWaitSeconds": round(lock_acquired - lock_requested, 3),
        "harborWallSeconds": round(harbor_finished - lock_acquired, 3),
        "imageBuildSeconds": phase_seconds(result.get("environment_setup")),
        "agentSeconds": phase_seconds(result.get("agent_execution")),
        "verifierSeconds": phase_seconds(result.get("verifier")),
        "cpuSeconds": cpu_seconds,
    }


def cpu_seconds(cpu_stat):
    for line in cpu_stat.splitlines():
        key, _, value = line.partition(" ")
        if key == "usage_usec":
            return int(value) / 1_000_000
    return None


class ContainerState:
    def __init__(self, ignored=frozenset()):
        self.containers = {}
        self.ignored = set(ignored)

    def observe(self, container_id, name, network_mode, usage_usec):
        if container_id in self.ignored:
            return
        known = self.containers.setdefault(
            container_id, {"name": name, "networkMode": network_mode, "usage": None}
        )
        if usage_usec is not None and (known["usage"] is None or usage_usec > known["usage"]):
            known["usage"] = usage_usec

    def cpu_seconds(self):
        usages = [item["usage"] for item in self.containers.values()]
        if not usages or any(usage is None for usage in usages):
            return None
        return sum(usages) / 1_000_000

    def isolation(self):
        return [
            {"id": key, "name": item["name"], "networkMode": item["networkMode"]}
            for key, item in self.containers.items()
        ]


def require_isolated(isolation):
    if not isolation:
        raise ValueError("no containers were observed")
    bad = sorted({item["networkMode"] for item in isolation if item["networkMode"] != "none"})
    if bad:
        raise ValueError(f"containers with network mode {', '.join(bad)}")


OUTCOME_NAMES = ("reward", "outcome", "result")
PUBLISHED_OUTCOME_FILES = ("outcome.json", "result.json", "reward.txt", "reward.json")


def agent_wrote_outcome(trial):
    trial = Path(trial)
    agent = trial / "agent"
    if agent.is_dir() and any(
        path.is_file() and any(name in path.name.lower() for name in OUTCOME_NAMES)
        for path in agent.rglob("*")
    ):
        return True
    published = trial / "artifacts" / "logs" / "artifacts"
    return any(
        (directory / name).is_file()
        for directory in (published, published / "workspace")
        for name in PUBLISHED_OUTCOME_FILES
    )


def isolation_reason(name, isolation):
    if not isolation:
        return f"{name} had no observed containers"
    if any(item["networkMode"] != "none" for item in isolation):
        return f"{name} container network is not none"
    return None


def probe_verdict(oracle, nop, agent_wrote_outcome):
    reasons = []
    if oracle.get("status") != "pass":
        reasons.append("oracle did not pass")
    if nop.get("status") != "fail" or nop.get("failureKind") != "assertion":
        reasons.append("nop did not fail on an assertion")
    for name, control in (("oracle", oracle), ("nop", nop)):
        reason = isolation_reason(name, control.get("isolation"))
        if reason:
            reasons.append(reason)
    if agent_wrote_outcome:
        reasons.append("agent container wrote an outcome file")
    return {"passed": not reasons, "reasons": reasons}


def write_outcome(trial, agent, outcome, pid=None):
    path = Path(trial) / "outcome.json"
    path.write_text(
        json.dumps(
            {
                "agent": agent,
                **outcome,
                "writer": "host-parent-process",
                "writerPid": os.getpid() if pid is None else pid,
            },
            indent=2,
        )
        + "\n"
    )
    return path


def docker_json(*args):
    return json.loads(subprocess.check_output(["docker", *args], text=True))


def task_containers(task_name):
    prefix = f"{task_name.lower()}__"
    listing = subprocess.run(
        [
            "docker",
            "ps",
            "-a",
            "--no-trunc",
            "--format",
            '{{.ID}}\t{{.Label "com.docker.compose.project"}}',
        ],
        capture_output=True,
        text=True,
    ).stdout
    return [
        container_id
        for container_id, _, project in (line.partition("\t") for line in listing.splitlines())
        if project.startswith(prefix)
    ]


def sample_containers(task_name, state, stop, interval=0.25):
    while True:
        for short_id in task_containers(task_name):
            if short_id in state.ignored:
                continue
            try:
                info = docker_json("inspect", short_id)[0]
                usage = None
                stat = Path(CGROUP_SCOPE.format(id=info["Id"]))
                if stat.exists():
                    seconds = cpu_seconds(stat.read_text())
                    usage = None if seconds is None else int(seconds * 1_000_000)
            except (subprocess.CalledProcessError, OSError, KeyError):
                continue
            state.observe(
                info["Id"], info["Name"].lstrip("/"), info["HostConfig"]["NetworkMode"], usage
            )
        if stop.is_set():
            return
        stop.wait(interval)


def start_sampler(task_name):
    state = ContainerState(ignored=task_containers(task_name))
    stop = threading.Event()
    thread = threading.Thread(
        target=sample_containers, args=(task_name, state, stop), daemon=True
    )
    thread.start()
    return state, stop, thread
