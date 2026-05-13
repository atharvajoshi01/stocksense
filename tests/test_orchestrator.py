import pytest

from stocksense.orchestrator import DAG, Task, run_dag


def test_topological_order_simple():
    dag = DAG()
    dag.add(Task("a", lambda: 1))
    dag.add(Task("b", lambda a: a + 1, upstream=("a",)))
    dag.add(Task("c", lambda a, b: a + b, upstream=("a", "b")))
    order = dag.topological_order()
    assert order.index("a") < order.index("b") < order.index("c")


def test_run_dag_passes_values():
    dag = DAG()
    dag.add(Task("a", lambda: 2))
    dag.add(Task("b", lambda a: a * 3, upstream=("a",)))
    values, results = run_dag(dag)
    assert values["a"] == 2
    assert values["b"] == 6
    assert all(r.ok for r in results)


def test_cycle_detection():
    dag = DAG()
    dag.add(Task("a", lambda b: b, upstream=("b",)))
    dag.add(Task("b", lambda a: a, upstream=("a",)))
    with pytest.raises(ValueError, match="Cycle"):
        dag.topological_order()


def test_unknown_dependency():
    dag = DAG()
    dag.add(Task("a", lambda nope: nope, upstream=("nope",)))
    with pytest.raises(ValueError, match="unknown task"):
        dag.topological_order()


def test_duplicate_task_name():
    dag = DAG()
    dag.add(Task("a", lambda: 1))
    with pytest.raises(ValueError, match="Duplicate"):
        dag.add(Task("a", lambda: 2))
