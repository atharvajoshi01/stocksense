"""Walk-forward backtesting.

A forecaster is evaluated on a rolling origin: train on data up to time t,
forecast the next `horizon` days, advance, repeat. Metrics are reported per
fold and aggregated per (sku_id, segment). No future information ever leaks
into the training window of any fold.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .features import GRAIN
from .models import TARGET


@dataclass
class FoldResult:
    fold: int
    cutoff: pd.Timestamp
    horizon_days: int
    rows: pd.DataFrame  # actual + predicted per (sku, segment, date)
    mape: float
    rmse: float
    bias: float


@dataclass
class BacktestSummary:
    forecaster_name: str
    folds: list[FoldResult]

    def per_sku(self) -> pd.DataFrame:
        all_rows = pd.concat([f.rows for f in self.folds], ignore_index=True)
        all_rows["abs_pct_err"] = (
            (all_rows["y_true"] - all_rows["y_pred"]).abs()
            / all_rows["y_true"].replace({0: np.nan})
        )
        all_rows["sq_err"] = (all_rows["y_true"] - all_rows["y_pred"]) ** 2
        all_rows["err"] = all_rows["y_pred"] - all_rows["y_true"]
        summary = (
            all_rows.groupby(list(GRAIN))
            .agg(
                mape=("abs_pct_err", "mean"),
                rmse=("sq_err", lambda s: float(np.sqrt(s.mean()))),
                bias=("err", "mean"),
                n=("y_true", "size"),
            )
            .reset_index()
        )
        return summary

    def overall(self) -> dict:
        all_rows = pd.concat([f.rows for f in self.folds], ignore_index=True)
        nz = all_rows[all_rows["y_true"] > 0]
        if len(nz):
            mape = float(((nz["y_true"] - nz["y_pred"]).abs() / nz["y_true"]).mean())
        else:
            mape = float("nan")
        rmse = float(np.sqrt(((all_rows["y_true"] - all_rows["y_pred"]) ** 2).mean()))
        bias = float((all_rows["y_pred"] - all_rows["y_true"]).mean())
        return {"mape": mape, "rmse": rmse, "bias": bias, "n": int(len(all_rows))}


def _fold_metrics(rows: pd.DataFrame) -> tuple[float, float, float]:
    nz = rows[rows["y_true"] > 0]
    if len(nz):
        mape = float(((nz["y_true"] - nz["y_pred"]).abs() / nz["y_true"]).mean())
    else:
        mape = float("nan")
    rmse = float(np.sqrt(((rows["y_true"] - rows["y_pred"]) ** 2).mean()))
    bias = float((rows["y_pred"] - rows["y_true"]).mean())
    return mape, rmse, bias


def walk_forward(
    df: pd.DataFrame,
    forecaster_factory,
    horizon_days: int = 14,
    n_folds: int = 4,
    initial_train_days: int = 270,
    step_days: int | None = None,
) -> BacktestSummary:
    """Generic walk-forward CV.

    `forecaster_factory` is a zero-arg callable returning a fresh forecaster.
    """
    work = df.copy()
    work["order_date"] = pd.to_datetime(work["order_date"])
    dates = pd.DatetimeIndex(sorted(work["order_date"].unique()))
    if len(dates) < initial_train_days + horizon_days + 1:
        raise ValueError(
            f"Not enough days ({len(dates)}) for initial_train_days={initial_train_days} "
            f"+ horizon={horizon_days}"
        )

    step = step_days if step_days else horizon_days
    cutoffs: list[pd.Timestamp] = []
    last_allowed = dates[-horizon_days - 1]
    cutoff = dates[initial_train_days - 1]
    while cutoff <= last_allowed and len(cutoffs) < n_folds:
        cutoffs.append(cutoff)
        cutoff = cutoff + pd.Timedelta(days=step)

    folds: list[FoldResult] = []
    forecaster_name = forecaster_factory().name
    for i, cutoff in enumerate(cutoffs):
        train = work[work["order_date"] <= cutoff].copy()
        test = work[
            (work["order_date"] > cutoff)
            & (work["order_date"] <= cutoff + pd.Timedelta(days=horizon_days))
        ].copy()
        if len(test) == 0:
            continue
        forecaster = forecaster_factory().fit(train)
        future = test[[*GRAIN, "order_date"]].copy()
        yhat = forecaster.predict(future)
        rows = pd.DataFrame(
            {
                "sku_id": test["sku_id"].to_numpy(),
                "segment": test["segment"].to_numpy(),
                "order_date": test["order_date"].to_numpy(),
                "y_true": test[TARGET].to_numpy(),
                "y_pred": yhat.to_numpy() if hasattr(yhat, "to_numpy") else np.asarray(yhat),
            }
        )
        mape, rmse, bias = _fold_metrics(rows)
        folds.append(
            FoldResult(
                fold=i,
                cutoff=cutoff,
                horizon_days=horizon_days,
                rows=rows,
                mape=mape,
                rmse=rmse,
                bias=bias,
            )
        )

    return BacktestSummary(forecaster_name=forecaster_name, folds=folds)


def select_winner(summaries: list[BacktestSummary]) -> dict[tuple[str, str], str]:
    """Pick the forecaster with lowest mean MAPE per (sku, segment)."""
    rankings: dict[tuple[str, str], list[tuple[str, float]]] = {}
    for s in summaries:
        per_sku = s.per_sku()
        for _, row in per_sku.iterrows():
            key = (row["sku_id"], row["segment"])
            rankings.setdefault(key, []).append((s.forecaster_name, float(row["mape"])))

    winners: dict[tuple[str, str], str] = {}
    for key, scored in rankings.items():
        scored = [(n, m) for n, m in scored if not np.isnan(m)]
        if not scored:
            winners[key] = "seasonal_naive_7"
            continue
        scored.sort(key=lambda x: x[1])
        winners[key] = scored[0][0]
    return winners
