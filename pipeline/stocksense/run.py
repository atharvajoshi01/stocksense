"""End-to-end pipeline runner.

Usage:
    python -m stocksense.run [--out web/public/data]

Steps (orchestrated by the DAG):
    1. generate              synthetic order panel
    2. validate              data-quality report
    3. backtest_each         walk-forward backtest of every forecaster
    4. select_winners        pick best forecaster per (sku, segment)
    5. fit_winners           train winning forecasters on the full history
    6. produce_forecasts     14-day forecast per (sku, segment)
    7. inventory_health      days of cover, stockout risk
    8. movement              slow movers, accelerating movers
    9. anomalies             residual-based outlier detection
   10. concentration         pareto revenue concentration
   11. export                write all JSON to the dashboard data dir
"""

from __future__ import annotations

import argparse
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from .backtest import select_winner, walk_forward
from .catalog import CATALOG
from .features import GRAIN
from .generate import generate
from .kpis import (
    anomalies,
    days_of_cover,
    revenue_concentration,
    slow_movers,
    stockout_risk_flag,
)
from .models import GradientBoostedForecaster, SeasonalNaive, StatsForecaster
from .orchestrator import DAG, Task, run_dag
from .validators import validate
from .export import (
    write_anomalies,
    write_data_quality,
    write_forecasts,
    write_inventory,
    write_kpis,
    write_leaderboard,
    write_meta,
    write_revenue_concentration,
    write_slow_movers,
    write_winners,
)

ROOT = Path(__file__).resolve().parents[2]


FORECAST_HORIZON_DAYS = 14
BACKTEST_FOLDS = 3
BACKTEST_INITIAL_TRAIN_DAYS = 270


def _make_inventory_seed(history: pd.DataFrame, rng: np.random.Generator) -> pd.DataFrame:
    """Synthetic snapshot of on-hand inventory per (sku, segment)."""
    recent = history[
        history["order_date"] >= history["order_date"].max() - pd.Timedelta(days=13)
    ]
    avg = recent.groupby(list(GRAIN))["units"].mean().rename("avg14").reset_index()
    multipliers = rng.uniform(4.0, 22.0, len(avg))
    avg["units_on_hand"] = (avg["avg14"] * multipliers).round(0)
    return avg[[*GRAIN, "units_on_hand"]]


def _build_forecast_frame(history: pd.DataFrame, horizon: int) -> pd.DataFrame:
    last = pd.to_datetime(history["order_date"]).max()
    future_dates = pd.date_range(last + pd.Timedelta(days=1), periods=horizon, freq="D")
    rows = []
    for sku in history["sku_id"].unique():
        for seg in history["segment"].unique():
            for d in future_dates:
                rows.append({"sku_id": sku, "segment": seg, "order_date": d})
    return pd.DataFrame(rows)


def build_pipeline(out_dir: Path, seed: int = 42) -> DAG:
    rng = np.random.default_rng(seed)
    factories = {
        "seasonal_naive_7": SeasonalNaive,
        "hgbt": GradientBoostedForecaster,
        # sarimax is slow per-panel; include if explicitly requested via env or flag
    }

    def t_generate() -> pd.DataFrame:
        return generate()

    def t_validate(generate: pd.DataFrame):
        return validate(generate)

    def t_backtest_each(generate: pd.DataFrame):
        summaries = []
        for factory in factories.values():
            summaries.append(
                walk_forward(
                    generate,
                    factory,
                    horizon_days=FORECAST_HORIZON_DAYS,
                    n_folds=BACKTEST_FOLDS,
                    initial_train_days=BACKTEST_INITIAL_TRAIN_DAYS,
                )
            )
        return summaries

    def t_select_winners(t_backtest_each):
        return select_winner(t_backtest_each)

    def t_fit_winners(generate: pd.DataFrame, t_select_winners):
        fitted = {name: factory().fit(generate) for name, factory in factories.items()}
        return fitted

    def t_produce_forecasts(
        generate: pd.DataFrame,
        t_select_winners,
        t_fit_winners,
    ):
        future = _build_forecast_frame(generate, FORECAST_HORIZON_DAYS)
        out = []
        for keys, group in future.groupby(list(GRAIN), sort=False):
            winner_name = t_select_winners.get(keys, "seasonal_naive_7")
            forecaster = t_fit_winners[winner_name]
            yhat = forecaster.predict(group)
            block = group.copy()
            block["units"] = yhat.values
            block["model"] = winner_name
            out.append(block)
        forecasts = pd.concat(out, ignore_index=True)
        return forecasts

    def t_inventory_health(generate: pd.DataFrame, t_produce_forecasts: pd.DataFrame):
        on_hand = _make_inventory_seed(generate, rng)
        doc = days_of_cover(on_hand, t_produce_forecasts, horizon_days=FORECAST_HORIZON_DAYS)
        lead_times = pd.DataFrame(
            [{"sku_id": s.sku_id, "lead_time_days": s.lead_time_days} for s in CATALOG]
        )
        return stockout_risk_flag(doc, lead_times)

    def t_movement(generate: pd.DataFrame):
        return slow_movers(generate)

    def t_anomalies(generate: pd.DataFrame):
        # Use seasonal naive as the reference for anomaly detection
        sn = SeasonalNaive().fit(generate)
        future = generate[[*GRAIN, "order_date"]].copy()
        yhat = sn.predict(future)
        pred = future.copy()
        pred["units"] = yhat.values
        return anomalies(generate, pred)

    def t_concentration(generate: pd.DataFrame):
        return revenue_concentration(generate)

    def t_export(
        generate: pd.DataFrame,
        t_validate,
        t_backtest_each,
        t_select_winners,
        t_produce_forecasts,
        t_inventory_health,
        t_movement,
        t_anomalies,
        t_concentration,
    ):
        out_dir.mkdir(parents=True, exist_ok=True)
        write_meta(out_dir, generate)
        write_data_quality(out_dir, t_validate)
        write_leaderboard(out_dir, t_backtest_each)
        write_winners(out_dir, t_select_winners)
        write_forecasts(out_dir, generate, t_produce_forecasts)
        write_inventory(out_dir, t_inventory_health)
        write_slow_movers(out_dir, t_movement)
        write_anomalies(out_dir, t_anomalies)
        write_revenue_concentration(out_dir, t_concentration)
        # Top-line KPIs derive from already-computed pieces
        overall_best = min(
            (s.overall() for s in t_backtest_each), key=lambda d: d["mape"]
        )
        write_kpis(
            out_dir,
            generate,
            overall_best,
            t_inventory_health,
            t_movement,
        )
        return {"ok": True, "out_dir": str(out_dir)}

    dag = DAG()
    dag.add(Task("generate", t_generate))
    dag.add(Task("t_validate", t_validate, upstream=("generate",)))
    dag.add(Task("t_backtest_each", t_backtest_each, upstream=("generate",)))
    dag.add(Task("t_select_winners", t_select_winners, upstream=("t_backtest_each",)))
    dag.add(Task("t_fit_winners", t_fit_winners, upstream=("generate", "t_select_winners")))
    dag.add(
        Task(
            "t_produce_forecasts",
            t_produce_forecasts,
            upstream=("generate", "t_select_winners", "t_fit_winners"),
        )
    )
    dag.add(
        Task(
            "t_inventory_health",
            t_inventory_health,
            upstream=("generate", "t_produce_forecasts"),
        )
    )
    dag.add(Task("t_movement", t_movement, upstream=("generate",)))
    dag.add(Task("t_anomalies", t_anomalies, upstream=("generate",)))
    dag.add(Task("t_concentration", t_concentration, upstream=("generate",)))
    dag.add(
        Task(
            "t_export",
            t_export,
            upstream=(
                "generate",
                "t_validate",
                "t_backtest_each",
                "t_select_winners",
                "t_produce_forecasts",
                "t_inventory_health",
                "t_movement",
                "t_anomalies",
                "t_concentration",
            ),
        )
    )
    return dag


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--out",
        type=Path,
        default=ROOT / "web" / "public" / "data",
        help="Directory to write dashboard JSON artifacts",
    )
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--log-level", default="INFO")
    args = parser.parse_args()

    logging.basicConfig(
        level=args.log_level.upper(),
        format="%(asctime)s %(levelname)-7s %(name)s :: %(message)s",
    )

    started = datetime.now(timezone.utc).isoformat()
    dag = build_pipeline(args.out, seed=args.seed)
    values, run_results = run_dag(dag)
    finished = datetime.now(timezone.utc).isoformat()

    summary = {
        "started_at": started,
        "finished_at": finished,
        "tasks": [
            {"task": r.task, "duration_s": r.duration_s, "ok": r.ok, "error": r.error}
            for r in run_results
        ],
    }
    (args.out / "run_summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
