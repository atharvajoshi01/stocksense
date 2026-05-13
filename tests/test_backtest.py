"""Backtester correctness: fold structure + no-future-leakage."""

import pandas as pd
import pytest

from stocksense.backtest import select_winner, walk_forward
from stocksense.models import SeasonalNaive


def test_folds_have_disjoint_train_and_test(order_panel):
    summary = walk_forward(
        order_panel, SeasonalNaive, horizon_days=14, n_folds=3, initial_train_days=270
    )
    assert len(summary.folds) >= 1
    for f in summary.folds:
        train_max = order_panel[order_panel["order_date"] <= f.cutoff]["order_date"].max()
        test_min = f.rows["order_date"].min()
        assert train_max < test_min, "train and test windows must be disjoint and time-ordered"


def test_no_future_dates_in_training_window(order_panel):
    summary = walk_forward(
        order_panel, SeasonalNaive, horizon_days=14, n_folds=2, initial_train_days=270
    )
    for f in summary.folds:
        # Each test row's date must be strictly greater than the fold's cutoff
        assert (f.rows["order_date"] > f.cutoff).all()


def test_overall_metrics_finite(order_panel):
    summary = walk_forward(
        order_panel, SeasonalNaive, horizon_days=14, n_folds=3, initial_train_days=270
    )
    overall = summary.overall()
    assert overall["mape"] >= 0
    assert overall["rmse"] >= 0
    assert overall["n"] > 0


def test_select_winner_returns_per_panel():
    """select_winner should produce one entry per (sku, segment) seen in any summary."""
    from stocksense.models import GradientBoostedForecaster

    # Use a smaller slice so this is fast
    cfg_dates = pd.date_range("2024-06-01", "2024-12-31", freq="D")
    from stocksense.generate import generate, GenerationConfig

    df = generate(GenerationConfig(start=cfg_dates[0].date(), end=cfg_dates[-1].date(), seed=1))
    summaries = [
        walk_forward(df, SeasonalNaive, horizon_days=7, n_folds=2, initial_train_days=120),
        walk_forward(df, GradientBoostedForecaster, horizon_days=7, n_folds=2, initial_train_days=120),
    ]
    winners = select_winner(summaries)
    seen = set()
    for s in summaries:
        for _, row in s.per_sku().iterrows():
            seen.add((row["sku_id"], row["segment"]))
    assert set(winners.keys()) == seen
    assert all(v in {"seasonal_naive_7", "hgbt"} for v in winners.values())
