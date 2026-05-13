"""Feature engineering for forecasting.

The forecast unit is a daily series for a single (sku_id, segment). Features
must be safe to use at inference time: every feature is derived only from
observations strictly earlier than the target date. Leakage tests cover this.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

LAG_DAYS: tuple[int, ...] = (1, 2, 7, 14, 28)
ROLLING_WINDOWS: tuple[int, ...] = (7, 14, 28)
GRAIN: tuple[str, ...] = ("sku_id", "segment")


def _calendar_features(d: pd.Series) -> pd.DataFrame:
    out = pd.DataFrame(index=d.index)
    dt = pd.to_datetime(d)
    out["dow"] = dt.dt.dayofweek
    out["day_of_month"] = dt.dt.day
    out["day_of_year"] = dt.dt.dayofyear
    out["month"] = dt.dt.month
    out["week_of_year"] = dt.dt.isocalendar().week.astype(int)
    out["is_weekend"] = (dt.dt.dayofweek >= 5).astype(int)
    # Sin/cos encoding for cyclical features
    out["dow_sin"] = np.sin(2 * np.pi * out["dow"] / 7)
    out["dow_cos"] = np.cos(2 * np.pi * out["dow"] / 7)
    out["month_sin"] = np.sin(2 * np.pi * out["month"] / 12)
    out["month_cos"] = np.cos(2 * np.pi * out["month"] / 12)
    return out


def build_features(df: pd.DataFrame, target: str = "units") -> pd.DataFrame:
    """Add lag, rolling, and calendar features. Sort by grain and date.

    Lags and rolling stats are computed per-group and shifted by 1 day so the
    feature at row t never reflects the target at row t (no leakage).
    """
    if "order_date" not in df.columns or target not in df.columns:
        raise ValueError(f"DataFrame must contain order_date and {target} columns")

    work = df.copy()
    work["order_date"] = pd.to_datetime(work["order_date"])
    work = work.sort_values([*GRAIN, "order_date"]).reset_index(drop=True)

    grouped = work.groupby(list(GRAIN), sort=False)[target]

    for lag in LAG_DAYS:
        work[f"lag_{lag}"] = grouped.shift(lag)

    for window in ROLLING_WINDOWS:
        shifted = grouped.shift(1)
        work[f"roll_mean_{window}"] = (
            shifted.groupby([work[c] for c in GRAIN])
            .rolling(window, min_periods=max(2, window // 2))
            .mean()
            .reset_index(level=list(range(len(GRAIN))), drop=True)
        )
        work[f"roll_std_{window}"] = (
            shifted.groupby([work[c] for c in GRAIN])
            .rolling(window, min_periods=max(2, window // 2))
            .std()
            .reset_index(level=list(range(len(GRAIN))), drop=True)
        )

    cal = _calendar_features(work["order_date"])
    work = pd.concat([work, cal], axis=1)

    # Segment one-hot
    if "segment" in work.columns:
        work["seg_food_service"] = (work["segment"] == "food_service").astype(int)
        work["seg_healthcare"] = (work["segment"] == "healthcare").astype(int)

    return work


def feature_columns(df: pd.DataFrame) -> list[str]:
    """Return the model-ready feature column names from a built frame."""
    candidates = [
        *(f"lag_{lag}" for lag in LAG_DAYS),
        *(f"roll_mean_{w}" for w in ROLLING_WINDOWS),
        *(f"roll_std_{w}" for w in ROLLING_WINDOWS),
        "dow",
        "day_of_month",
        "day_of_year",
        "month",
        "week_of_year",
        "is_weekend",
        "dow_sin",
        "dow_cos",
        "month_sin",
        "month_cos",
        "seg_food_service",
        "seg_healthcare",
    ]
    return [c for c in candidates if c in df.columns]
