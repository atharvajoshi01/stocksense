"""Tiny DAG orchestrator.

Stands in for Airflow in a single-file form: each step is a `Task`, tasks
declare upstream dependencies, and `run_dag` topologically sorts and executes
them. Each task can produce a value that downstream tasks consume by name.
"""

from __future__ import annotations

import logging
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any, Callable

log = logging.getLogger("stocksense.orchestrator")


@dataclass
class Task:
    name: str
    fn: Callable[..., Any]
    upstream: tuple[str, ...] = ()


@dataclass
class RunResult:
    task: str
    duration_s: float
    ok: bool
    error: str = ""


@dataclass
class DAG:
    tasks: dict[str, Task] = field(default_factory=dict)

    def add(self, task: Task) -> "DAG":
        if task.name in self.tasks:
            raise ValueError(f"Duplicate task name: {task.name}")
        self.tasks[task.name] = task
        return self

    def topological_order(self) -> list[str]:
        indegree: dict[str, int] = {n: 0 for n in self.tasks}
        graph: dict[str, list[str]] = defaultdict(list)
        for name, task in self.tasks.items():
            for up in task.upstream:
                if up not in self.tasks:
                    raise ValueError(f"Task {name} depends on unknown task {up}")
                indegree[name] += 1
                graph[up].append(name)
        queue = deque([n for n, d in indegree.items() if d == 0])
        order: list[str] = []
        while queue:
            n = queue.popleft()
            order.append(n)
            for d in graph[n]:
                indegree[d] -= 1
                if indegree[d] == 0:
                    queue.append(d)
        if len(order) != len(self.tasks):
            raise ValueError("Cycle detected in DAG")
        return order


def run_dag(dag: DAG) -> tuple[dict[str, Any], list[RunResult]]:
    """Execute tasks in topological order. Values from upstream tasks are
    passed by name as kwargs to downstream tasks."""
    order = dag.topological_order()
    values: dict[str, Any] = {}
    results: list[RunResult] = []
    for name in order:
        task = dag.tasks[name]
        kwargs = {up: values[up] for up in task.upstream}
        t0 = time.perf_counter()
        try:
            log.info("running task: %s", name)
            values[name] = task.fn(**kwargs)
            dt = time.perf_counter() - t0
            results.append(RunResult(task=name, duration_s=dt, ok=True))
            log.info("task %s ok in %.2fs", name, dt)
        except Exception as exc:  # noqa: BLE001
            dt = time.perf_counter() - t0
            log.exception("task %s failed: %s", name, exc)
            results.append(RunResult(task=name, duration_s=dt, ok=False, error=str(exc)))
            raise
    return values, results
