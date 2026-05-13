"""Feature-engineering correctness, especially no-future-leakage."""

import numpy as np
import pandas as pd
import pytest

from stocksense.features import build_features, feature_columns, LAG_DAYS, ROLLING_WINDOWS


def test_lag_value_matches_target_at_minus_lag(small_panel):
    feats = build_features(small_panel)
    one_sku = (
        feats[(feats["sku_id"] == "GLV-NIT-M") & (feats["segment"] == "food_service")]
        .sort_values("order_date")
        .reset_index(drop=True)
    )
    for lag in LAG_DAYS:
        # for any row i >= lag, lag_{lag} should equal units at i-lag
        for i in range(lag + 1, min(len(one_sku), lag + 5)):
            assert one_sku.loc[i, f"lag_{lag}"] == pytest.approx(one_sku.loc[i - lag, "units"])


def test_lag_features_are_nan_before_history_exists(small_panel):
    feats = build_features(small_panel)
    g = feats.groupby(["sku_id", "segment"], sort=False)
    for (sku, seg), grp in g:
        grp = grp.sort_values("order_date").reset_index(drop=True)
        for lag in LAG_DAYS:
            # First `lag` rows must be NaN for that lag feature
            assert grp.loc[: lag - 1, f"lag_{lag}"].isna().all(), (sku, seg, lag)


def test_rolling_mean_excludes_current_row(small_panel):
    feats = build_features(small_panel)
    one = (
        feats[(feats["sku_id"] == "GLV-NIT-M") & (feats["segment"] == "food_service")]
        .sort_values("order_date")
        .reset_index(drop=True)
    )
    window = 7
    # For row i, roll_mean_7 should match mean of units[i-7:i]
    for i in range(20, 30):
        expected = one.loc[i - window : i - 1, "units"].mean()
        observed = one.loc[i, f"roll_mean_{window}"]
        if not np.isnan(observed):
            assert observed == pytest.approx(expected, rel=1e-6)


def test_calendar_features_present(small_panel):
    feats = build_features(small_panel)
    for col in ("dow", "month", "day_of_year", "dow_sin", "month_cos", "is_weekend"):
        assert col in feats.columns


def test_feature_columns_returns_subset(small_panel):
    feats = build_features(small_panel)
    cols = feature_columns(feats)
    assert all(c in feats.columns for c in cols)
    # The target should never be in the feature set
    assert "units" not in cols
    # All lag and rolling features should be included
    for lag in LAG_DAYS:
        assert f"lag_{lag}" in cols
    for w in ROLLING_WINDOWS:
        assert f"roll_mean_{w}" in cols


def test_no_leakage_from_future_rows(small_panel):
    """Truncating history at date t must not change features at dates <= t."""
    feats_full = build_features(small_panel)
    cutoff = pd.Timestamp("2024-07-15")
    truncated = small_panel[small_panel["order_date"] <= cutoff]
    feats_trunc = build_features(truncated)

    join_keys = ["sku_id", "segment", "order_date"]
    overlap_cols = ["lag_1", "lag_7", "roll_mean_7", "roll_mean_14", "month", "dow"]
    merged = feats_full.merge(feats_trunc, on=join_keys, suffixes=("_full", "_trunc"))
    for col in overlap_cols:
        a = merged[f"{col}_full"]
        b = merged[f"{col}_trunc"]
        # Both should agree where both are non-null
        mask = a.notna() & b.notna()
        assert (a[mask] == b[mask]).all(), f"Leakage detected in {col}"
