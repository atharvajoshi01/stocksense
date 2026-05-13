"""Forecasting models.

Three families:

  * `SeasonalNaive` is a non-parametric baseline. The forecast for date t is
    the observed value at date (t - 7). It is the right yardstick for any
    serious model on retail/distribution data.
  * `GradientBoostedForecaster` is a single global model trained on lag and
    calendar features across all (sku, segment) panels.
  * `StatsForecaster` wraps `statsmodels` SARIMAX with conservative defaults.
    Used as a fallback when the GBT model overfits a specific panel.

All forecasters share a small interface so the backtester can score them on
even footing.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from statsmodels.tsa.statespace.sarimax import SARIMAX

from .features import GRAIN, build_features, feature_columns

TARGET = "units"


@dataclass
class ForecasterMetadata:
    name: str
    trained_rows: int = 0
    extra: dict | None = None


class SeasonalNaive:
    """forecast(t) = observed(t - period)."""

    name = "seasonal_naive_7"
    period = 7

    def __init__(self) -> None:
        self.meta = ForecasterMetadata(name=self.name)

    def fit(self, train: pd.DataFrame) -> "SeasonalNaive":
        self.train_ = train.sort_values([*GRAIN, "order_date"])
        self.meta.trained_rows = len(train)
        return self

    def predict(self, future_dates: pd.DataFrame) -> pd.Series:
        """future_dates must include the order_date plus grain columns."""
        out = []
        for keys, group in future_dates.groupby(list(GRAIN), sort=False):
            hist = self.train_[
                (self.train_["sku_id"] == keys[0]) & (self.train_["segment"] == keys[1])
            ].copy()
            hist = hist.set_index("order_date").sort_index()
            for d in group["order_date"]:
                lag_date = pd.Timestamp(d) - pd.Timedelta(days=self.period)
                if lag_date in hist.index:
                    out.append((keys[0], keys[1], d, float(hist.loc[lag_date, TARGET])))
                else:
                    out.append((keys[0], keys[1], d, float(hist[TARGET].mean()) if len(hist) else 0.0))
        pred = pd.DataFrame(out, columns=["sku_id", "segment", "order_date", "yhat"])
        merged = future_dates.merge(pred, on=["sku_id", "segment", "order_date"], how="left")
        return merged["yhat"].astype(float)


class GradientBoostedForecaster:
    """Global LightGBM-style HGBT on engineered features."""

    name = "hgbt"

    def __init__(self, max_iter: int = 350, max_depth: int = 6, learning_rate: float = 0.06) -> None:
        self.model = HistGradientBoostingRegressor(
            max_iter=max_iter,
            max_depth=max_depth,
            learning_rate=learning_rate,
            l2_regularization=1.0,
            random_state=42,
            early_stopping=True,
            validation_fraction=0.1,
            n_iter_no_change=25,
        )
        self.meta = ForecasterMetadata(name=self.name)
        self.feature_cols_: list[str] = []

    def fit(self, train: pd.DataFrame) -> "GradientBoostedForecaster":
        feats = build_features(train, target=TARGET)
        self.feature_cols_ = feature_columns(feats)
        # Drop rows with NaN features from cold start
        ready = feats.dropna(subset=self.feature_cols_)
        X = ready[self.feature_cols_].values
        y = ready[TARGET].values
        self.model.fit(X, y)
        self.train_ = train.copy()
        self.meta.trained_rows = len(ready)
        return self

    def predict(self, future_dates: pd.DataFrame) -> pd.Series:
        """Iteratively build features one day at a time so lag values reflect
        prior predictions (recursive forecasting). future_dates must be sorted
        by date within each grain group."""
        history = self.train_.copy()
        future_dates = future_dates.sort_values([*GRAIN, "order_date"]).reset_index(drop=True)
        all_dates = future_dates["order_date"].sort_values().unique()
        preds: dict[tuple[str, str, pd.Timestamp], float] = {}

        for d in all_dates:
            stub = future_dates[future_dates["order_date"] == d].copy()
            for col in (TARGET, "revenue"):
                if col not in stub.columns:
                    stub[col] = np.nan
            if "product_family" not in stub.columns:
                stub = stub.merge(
                    history[["sku_id", "product_family"]].drop_duplicates(),
                    on="sku_id",
                    how="left",
                )
            for col in ("is_promo", "is_supply_shock"):
                if col not in stub.columns:
                    stub[col] = False
            combined = pd.concat([history, stub], ignore_index=True)
            feats = build_features(combined, target=TARGET)
            today = feats[feats["order_date"] == pd.Timestamp(d)]
            X = today[self.feature_cols_].fillna(0).values
            yhat = self.model.predict(X)
            yhat = np.clip(yhat, 0, None)
            for (sku, seg), pred in zip(
                zip(today["sku_id"], today["segment"]), yhat, strict=True
            ):
                preds[(sku, seg, pd.Timestamp(d))] = float(pred)
            # Append predictions to history so the next day's lags see them
            today = today.copy()
            today[TARGET] = yhat
            history = pd.concat([history, today[history.columns.intersection(today.columns)]], ignore_index=True)

        out = []
        for _, row in future_dates.iterrows():
            key = (row["sku_id"], row["segment"], pd.Timestamp(row["order_date"]))
            out.append(preds.get(key, 0.0))
        return pd.Series(out, dtype=float)


class StatsForecaster:
    """Per-panel SARIMAX(1,1,1)(0,1,1,7)."""

    name = "sarimax"

    def __init__(self) -> None:
        self.meta = ForecasterMetadata(name=self.name)
        self.fits_: dict[tuple[str, str], object] = {}
        self.train_: pd.DataFrame | None = None

    def fit(self, train: pd.DataFrame) -> "StatsForecaster":
        self.train_ = train.copy()
        self.meta.trained_rows = len(train)
        # Fit lazily in predict to avoid up-front cost when not needed
        return self

    def _fit_panel(self, sku: str, segment: str) -> object | None:
        assert self.train_ is not None
        hist = (
            self.train_[(self.train_["sku_id"] == sku) & (self.train_["segment"] == segment)]
            .sort_values("order_date")
            .set_index("order_date")[TARGET]
            .asfreq("D")
        )
        if hist.isna().any():
            hist = hist.interpolate("linear")
        if len(hist) < 30:
            return None
        try:
            model = SARIMAX(
                hist,
                order=(1, 1, 1),
                seasonal_order=(0, 1, 1, 7),
                enforce_stationarity=False,
                enforce_invertibility=False,
            )
            return model.fit(disp=False, maxiter=200)
        except Exception:
            return None

    def predict(self, future_dates: pd.DataFrame) -> pd.Series:
        future = future_dates.sort_values([*GRAIN, "order_date"]).reset_index(drop=True)
        preds = np.zeros(len(future), dtype=float)
        for keys, group in future.groupby(list(GRAIN), sort=False):
            key = (keys[0], keys[1])
            if key not in self.fits_:
                self.fits_[key] = self._fit_panel(*key)
            fit = self.fits_[key]
            if fit is None:
                preds[group.index] = float(
                    self.train_[
                        (self.train_["sku_id"] == keys[0]) & (self.train_["segment"] == keys[1])
                    ][TARGET].mean()
                ) if self.train_ is not None else 0.0
                continue
            n = len(group)
            forecast = fit.forecast(steps=n)
            preds[group.index] = np.asarray(forecast, dtype=float)
        return pd.Series(np.clip(preds, 0, None), dtype=float)


def all_forecasters() -> list:
    return [SeasonalNaive(), GradientBoostedForecaster(), StatsForecaster()]
