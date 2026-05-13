"""Inventory and demand KPIs for the dashboard.

These are the metrics a Daxwell-style operations team would ask for first:

  * forecast accuracy at SKU, family, and company level
  * days of cover at current inventory and projected demand
  * stockout risk inside the next forecast horizon
  * slow movers vs. accelerating items
  * revenue concentration
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .features import GRAIN


def forecast_accuracy(actuals: pd.DataFrame, forecasts: pd.DataFrame) -> pd.DataFrame:
    """Compute per-(sku, segment) MAPE, RMSE, and bias on the overlap window."""
    join_cols = [*GRAIN, "order_date"]
    merged = actuals.merge(forecasts, on=join_cols, how="inner", suffixes=("_actual", "_pred"))
    if "units_actual" not in merged.columns or "units_pred" not in merged.columns:
        raise ValueError("actuals must have 'units' and forecasts must have 'units' columns")
    nz = merged[merged["units_actual"] > 0].copy()
    nz["abs_pct_err"] = (nz["units_actual"] - nz["units_pred"]).abs() / nz["units_actual"]
    nz["sq_err"] = (nz["units_actual"] - nz["units_pred"]) ** 2
    nz["err"] = nz["units_pred"] - nz["units_actual"]
    return (
        nz.groupby(list(GRAIN))
        .agg(
            mape=("abs_pct_err", "mean"),
            rmse=("sq_err", lambda s: float(np.sqrt(s.mean()))),
            bias=("err", "mean"),
            n=("units_actual", "size"),
        )
        .reset_index()
    )


def days_of_cover(on_hand: pd.DataFrame, forecasts: pd.DataFrame, horizon_days: int = 14) -> pd.DataFrame:
    """Days of cover = on-hand units / average daily forecast over horizon.

    `on_hand` must have columns (sku_id, segment, units_on_hand).
    `forecasts` must have columns (sku_id, segment, order_date, units).
    """
    avg_daily = (
        forecasts.groupby(list(GRAIN))["units"].mean().rename("avg_daily_forecast").reset_index()
    )
    out = on_hand.merge(avg_daily, on=list(GRAIN), how="left")
    out["avg_daily_forecast"] = out["avg_daily_forecast"].fillna(0)
    out["days_of_cover"] = np.where(
        out["avg_daily_forecast"] > 0,
        out["units_on_hand"] / out["avg_daily_forecast"],
        np.inf,
    )
    out["projected_stockout_days"] = np.maximum(
        0, horizon_days - out["days_of_cover"]
    )
    return out


def stockout_risk_flag(doc_df: pd.DataFrame, lead_times: pd.DataFrame) -> pd.DataFrame:
    """Mark high/medium/low risk based on days of cover vs lead time."""
    merged = doc_df.merge(lead_times, on="sku_id", how="left")

    def _classify(row: pd.Series) -> str:
        doc = row["days_of_cover"]
        lt = row["lead_time_days"]
        if np.isinf(doc):
            return "low"
        if doc < lt:
            return "high"
        if doc < lt * 1.5:
            return "medium"
        return "low"

    merged["stockout_risk"] = merged.apply(_classify, axis=1)
    return merged


def slow_movers(history: pd.DataFrame, recent_days: int = 30, lookback_days: int = 90) -> pd.DataFrame:
    """Compare recent vs. baseline daily demand and rank movement."""
    work = history.copy()
    work["order_date"] = pd.to_datetime(work["order_date"])
    end = work["order_date"].max()
    recent_start = end - pd.Timedelta(days=recent_days - 1)
    baseline_start = end - pd.Timedelta(days=lookback_days - 1)

    baseline = (
        work[work["order_date"] >= baseline_start]
        .groupby(list(GRAIN))["units"]
        .mean()
        .rename("baseline_daily")
    )
    recent = (
        work[work["order_date"] >= recent_start]
        .groupby(list(GRAIN))["units"]
        .mean()
        .rename("recent_daily")
    )
    df = pd.concat([baseline, recent], axis=1).reset_index()
    df["delta_pct"] = (df["recent_daily"] - df["baseline_daily"]) / df["baseline_daily"].replace(
        {0: np.nan}
    )
    df["movement"] = np.where(
        df["delta_pct"] < -0.15,
        "decelerating",
        np.where(df["delta_pct"] > 0.15, "accelerating", "stable"),
    )
    return df


def revenue_concentration(history: pd.DataFrame, recent_days: int = 90) -> pd.DataFrame:
    """Pareto curve: cumulative share of revenue by SKU descending."""
    work = history.copy()
    work["order_date"] = pd.to_datetime(work["order_date"])
    end = work["order_date"].max()
    recent_start = end - pd.Timedelta(days=recent_days - 1)
    rev = (
        work[work["order_date"] >= recent_start]
        .groupby("sku_id")["revenue"]
        .sum()
        .sort_values(ascending=False)
        .rename("revenue")
        .reset_index()
    )
    rev["share"] = rev["revenue"] / rev["revenue"].sum()
    rev["cumulative_share"] = rev["share"].cumsum()
    return rev


def anomalies(actuals: pd.DataFrame, forecasts: pd.DataFrame, z_threshold: float = 2.5) -> pd.DataFrame:
    """Flag dates where the absolute residual exceeds `z_threshold` rolling sigmas."""
    join_cols = [*GRAIN, "order_date"]
    merged = actuals.merge(forecasts, on=join_cols, how="inner", suffixes=("_actual", "_pred"))
    merged["residual"] = merged["units_actual"] - merged["units_pred"]
    merged = merged.sort_values([*GRAIN, "order_date"])
    rolled = merged.groupby(list(GRAIN))["residual"]
    merged["resid_mean"] = rolled.transform(lambda s: s.rolling(14, min_periods=5).mean())
    merged["resid_std"] = rolled.transform(lambda s: s.rolling(14, min_periods=5).std())
    merged["z"] = (merged["residual"] - merged["resid_mean"]) / merged["resid_std"]
    flagged = merged[merged["z"].abs() >= z_threshold].copy()
    flagged["direction"] = np.where(flagged["residual"] > 0, "surge", "shortfall")
    return flagged[[*GRAIN, "order_date", "units_actual", "units_pred", "residual", "z", "direction"]]
