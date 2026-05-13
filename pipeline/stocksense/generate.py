"""Synthetic order-history generator for a disposable-products distributor.

Produces a daily order series per (sku_id, customer_segment) with realistic
patterns:

  * weekly seasonality with food-service spikes on weekends and healthcare
    spikes on weekdays
  * yearly seasonality matching the SKU's primary segment
  * known promo events with measurable lift
  * a supply-disruption episode with multi-day shortfalls
  * Gaussian noise on the multiplicative log scale so the series is positive
    and dispersed
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from .catalog import CATALOG, SKU


@dataclass(frozen=True)
class GenerationConfig:
    start: date = date(2024, 1, 1)
    end: date = date(2025, 6, 30)
    seed: int = 42
    base_food_service_units: float = 80.0
    base_healthcare_units: float = 55.0
    promo_lift: float = 0.45
    supply_shock_drop: float = 0.65
    noise_sigma: float = 0.18


def _seasonal_multiplier(d: date, pattern: str) -> float:
    """Return a yearly seasonal multiplier between roughly 0.7 and 1.4."""
    day_of_year = d.timetuple().tm_yday
    phase = 2 * np.pi * day_of_year / 365.0
    if pattern == "food_service":
        # Peak in summer + holiday season
        summer = 0.20 * np.sin(phase - np.pi / 2)
        holiday = 0.18 * np.exp(-((day_of_year - 350) ** 2) / 200) + 0.18 * np.exp(
            -((day_of_year - 15) ** 2) / 200
        )
        return float(1.0 + summer + holiday)
    if pattern == "healthcare":
        # Peak in flu season (Nov-Feb)
        flu = 0.28 * (np.cos(phase) * 0.5 + 0.5)
        return float(0.85 + flu)
    return 1.0


def _weekly_multiplier(d: date, segment: str) -> float:
    weekday = d.weekday()  # 0 Mon ... 6 Sun
    if segment == "food_service":
        weekly = [0.95, 1.00, 1.05, 1.05, 1.20, 1.40, 1.30]
    else:  # healthcare
        weekly = [1.20, 1.18, 1.15, 1.12, 1.08, 0.65, 0.50]
    return weekly[weekday]


PROMO_WINDOWS = [
    (date(2024, 4, 15), date(2024, 4, 28), ["WRP-FOIL-18", "WRP-PLAS-12"]),
    (date(2024, 7, 1), date(2024, 7, 14), ["CTR-32OZ", "CUT-KIT"]),
    (date(2024, 11, 25), date(2024, 12, 8), ["GLV-NIT-M", "GLV-NIT-L"]),
    (date(2025, 3, 10), date(2025, 3, 24), ["CUT-FRK", "PRT-2OZ"]),
]

# Supply disruption: glove suppliers hit by raw-material shortage
SUPPLY_SHOCK = (date(2024, 9, 5), date(2024, 9, 23), ["GLV-NIT-M", "GLV-NIT-L"])


def _in_window(d: date, start: date, end: date) -> bool:
    return start <= d <= end


def _is_promo(d: date, sku_id: str) -> bool:
    return any(
        _in_window(d, s, e) and sku_id in skus for s, e, skus in PROMO_WINDOWS
    )


def _is_supply_shock(d: date, sku_id: str) -> bool:
    s, e, skus = SUPPLY_SHOCK
    return _in_window(d, s, e) and sku_id in skus


def _generate_for_sku_segment(
    sku: SKU,
    segment: str,
    cfg: GenerationConfig,
    rng: np.random.Generator,
) -> pd.DataFrame:
    days = pd.date_range(cfg.start, cfg.end, freq="D")
    records = []
    # Segment mix: 70% of demand from the primary segment, 30% from the other
    if segment == sku.primary_segment:
        base = (
            cfg.base_food_service_units
            if segment == "food_service"
            else cfg.base_healthcare_units
        )
        base *= 1.0
    else:
        base = (
            cfg.base_food_service_units
            if segment == "food_service"
            else cfg.base_healthcare_units
        )
        base *= 0.35

    # Apply per-SKU demand scale
    base *= sku.demand_scale

    for d in days:
        dd = d.date()
        seasonal = _seasonal_multiplier(dd, sku.seasonality_pattern)
        weekly = _weekly_multiplier(dd, segment)
        promo = cfg.promo_lift if _is_promo(dd, sku.sku_id) else 0.0
        shock = -cfg.supply_shock_drop if _is_supply_shock(dd, sku.sku_id) else 0.0
        mu = np.log(max(base * seasonal * weekly, 1.0)) + np.log1p(promo) + np.log1p(shock)
        noise = rng.normal(0.0, cfg.noise_sigma)
        units = float(np.exp(mu + noise))
        units = max(0.0, units)
        records.append(
            {
                "order_date": pd.Timestamp(d).date(),
                "sku_id": sku.sku_id,
                "product_family": sku.product_family,
                "segment": segment,
                "units": round(units, 2),
                "revenue": round(units * sku.unit_cost * 1.35, 2),  # 35% markup
                "is_promo": _is_promo(dd, sku.sku_id),
                "is_supply_shock": _is_supply_shock(dd, sku.sku_id),
            }
        )
    return pd.DataFrame.from_records(records)


def generate(cfg: GenerationConfig | None = None) -> pd.DataFrame:
    cfg = cfg or GenerationConfig()
    rng = np.random.default_rng(cfg.seed)
    frames: list[pd.DataFrame] = []
    for sku in CATALOG:
        for segment in ("food_service", "healthcare"):
            frames.append(_generate_for_sku_segment(sku, segment, cfg, rng))
    df = pd.concat(frames, ignore_index=True)
    df["order_date"] = pd.to_datetime(df["order_date"])
    return df.sort_values(["sku_id", "segment", "order_date"]).reset_index(drop=True)


def write_parquet(df: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(path, index=False)


if __name__ == "__main__":
    df = generate()
    out = Path(__file__).resolve().parents[2] / "pipeline" / "data" / "orders.parquet"
    write_parquet(df, out)
    print(f"Wrote {len(df):,} rows to {out}")
    print(df.head())
    print(df.groupby(["sku_id", "segment"])["units"].sum().head(10))
