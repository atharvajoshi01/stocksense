"""Serialize pipeline outputs to JSON for the dashboard.

Files written under `web/public/data/`:
  * meta.json            (dataset bounds, generated_at)
  * kpis.json            (top-line headline numbers)
  * leaderboard.json     (overall + per-model backtest metrics)
  * winners.json         (best forecaster per (sku, segment))
  * forecasts.json       (per (sku, segment), actuals last 90d + forecast 14d)
  * inventory.json       (days of cover, stockout risk)
  * slow_movers.json
  * anomalies.json
  * revenue_concentration.json
  * data_quality.json
"""

from __future__ import annotations

import json
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from .backtest import BacktestSummary
from .catalog import CATALOG
from .features import GRAIN
from .validators import ValidationReport


def _to_records(df: pd.DataFrame) -> list[dict]:
    out = df.copy()
    for col in out.columns:
        if pd.api.types.is_datetime64_any_dtype(out[col]):
            out[col] = pd.to_datetime(out[col]).dt.strftime("%Y-%m-%d")
        elif out[col].dtype == bool:
            out[col] = out[col].astype(bool)
    out = out.replace([np.inf, -np.inf], np.nan).where(pd.notnull(out), None)
    return out.to_dict(orient="records")


def _write(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, default=str))


def write_meta(out_dir: Path, history: pd.DataFrame) -> None:
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "start_date": pd.to_datetime(history["order_date"]).min().strftime("%Y-%m-%d"),
        "end_date": pd.to_datetime(history["order_date"]).max().strftime("%Y-%m-%d"),
        "n_orders": int(len(history)),
        "n_skus": int(history["sku_id"].nunique()),
        "n_segments": int(history["segment"].nunique()),
        "catalog": [
            {
                "sku_id": s.sku_id,
                "name": s.name,
                "product_family": s.product_family,
                "primary_segment": s.primary_segment,
                "lead_time_days": s.lead_time_days,
                "case_pack": s.case_pack,
                "unit_cost": s.unit_cost,
            }
            for s in CATALOG
        ],
    }
    _write(out_dir / "meta.json", payload)


def write_kpis(
    out_dir: Path,
    history: pd.DataFrame,
    overall_backtest: dict,
    inventory: pd.DataFrame,
    slow_movers_df: pd.DataFrame,
) -> None:
    revenue_30d = history[
        history["order_date"] >= history["order_date"].max() - pd.Timedelta(days=29)
    ]["revenue"].sum()
    revenue_prior_30d = history[
        (history["order_date"] >= history["order_date"].max() - pd.Timedelta(days=59))
        & (history["order_date"] < history["order_date"].max() - pd.Timedelta(days=29))
    ]["revenue"].sum()
    delta = (revenue_30d - revenue_prior_30d) / revenue_prior_30d if revenue_prior_30d else None
    high_risk = int((inventory["stockout_risk"] == "high").sum())
    payload = {
        "revenue_last_30d": float(revenue_30d),
        "revenue_prior_30d": float(revenue_prior_30d),
        "revenue_change_pct": float(delta) if delta is not None else None,
        "units_last_30d": float(
            history[
                history["order_date"] >= history["order_date"].max() - pd.Timedelta(days=29)
            ]["units"].sum()
        ),
        "forecast_mape": float(overall_backtest["mape"]),
        "forecast_bias": float(overall_backtest["bias"]),
        "high_risk_skus": high_risk,
        "decelerating_skus": int((slow_movers_df["movement"] == "decelerating").sum()),
        "accelerating_skus": int((slow_movers_df["movement"] == "accelerating").sum()),
    }
    _write(out_dir / "kpis.json", payload)


def write_leaderboard(out_dir: Path, summaries: list[BacktestSummary]) -> None:
    payload = []
    for s in summaries:
        overall = s.overall()
        per_sku = s.per_sku().sort_values("mape").to_dict(orient="records")
        payload.append(
            {
                "forecaster": s.forecaster_name,
                "overall": overall,
                "per_sku": [
                    {
                        "sku_id": r["sku_id"],
                        "segment": r["segment"],
                        "mape": None if pd.isna(r["mape"]) else float(r["mape"]),
                        "rmse": float(r["rmse"]),
                        "bias": float(r["bias"]),
                        "n": int(r["n"]),
                    }
                    for r in per_sku
                ],
            }
        )
    _write(out_dir / "leaderboard.json", payload)


def write_winners(out_dir: Path, winners: dict[tuple[str, str], str]) -> None:
    payload = [
        {"sku_id": k[0], "segment": k[1], "winner": v} for k, v in sorted(winners.items())
    ]
    _write(out_dir / "winners.json", payload)


def write_forecasts(
    out_dir: Path,
    history: pd.DataFrame,
    forecasts: pd.DataFrame,
    history_tail_days: int = 120,
) -> None:
    """For each (sku, segment), emit recent actuals + forecast."""
    history = history.copy()
    history["order_date"] = pd.to_datetime(history["order_date"])
    forecasts = forecasts.copy()
    forecasts["order_date"] = pd.to_datetime(forecasts["order_date"])
    cutoff = history["order_date"].max() - pd.Timedelta(days=history_tail_days)
    recent = history[history["order_date"] > cutoff]

    series_list = []
    for keys, grp in recent.groupby(list(GRAIN), sort=False):
        fc = forecasts[
            (forecasts["sku_id"] == keys[0]) & (forecasts["segment"] == keys[1])
        ].sort_values("order_date")
        sigma = float((grp["units"] - grp["units"].rolling(7, min_periods=2).mean()).std()) or 1.0
        actuals = [
            {"date": d.strftime("%Y-%m-%d"), "actual": float(u), "forecast": None, "lower": None, "upper": None}
            for d, u in zip(grp["order_date"], grp["units"], strict=True)
        ]
        fc_rows = [
            {
                "date": d.strftime("%Y-%m-%d"),
                "actual": None,
                "forecast": float(y),
                "lower": float(max(0.0, y - 1.96 * sigma)),
                "upper": float(y + 1.96 * sigma),
            }
            for d, y in zip(fc["order_date"], fc["units"], strict=True)
        ]
        series_list.append(
            {
                "sku_id": keys[0],
                "segment": keys[1],
                "sigma": sigma,
                "points": actuals + fc_rows,
            }
        )
    _write(out_dir / "forecasts.json", series_list)


def write_inventory(out_dir: Path, inventory: pd.DataFrame) -> None:
    _write(out_dir / "inventory.json", _to_records(inventory))


def write_slow_movers(out_dir: Path, df: pd.DataFrame) -> None:
    _write(out_dir / "slow_movers.json", _to_records(df))


def write_anomalies(out_dir: Path, df: pd.DataFrame) -> None:
    _write(out_dir / "anomalies.json", _to_records(df))


def write_revenue_concentration(out_dir: Path, df: pd.DataFrame) -> None:
    _write(out_dir / "revenue_concentration.json", _to_records(df))


def write_data_quality(out_dir: Path, report: ValidationReport) -> None:
    _write(out_dir / "data_quality.json", report.to_dict())
