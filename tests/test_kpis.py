import numpy as np
import pandas as pd
import pytest

from stocksense.kpis import (
    anomalies,
    days_of_cover,
    forecast_accuracy,
    revenue_concentration,
    slow_movers,
    stockout_risk_flag,
)


def _toy_actuals(n: int = 30) -> pd.DataFrame:
    dates = pd.date_range("2024-06-01", periods=n, freq="D")
    return pd.DataFrame(
        {
            "sku_id": ["SKU1"] * n,
            "segment": ["food_service"] * n,
            "order_date": dates,
            "units": np.linspace(10, 40, n),
            "revenue": np.linspace(10, 40, n) * 5.0,
        }
    )


def test_forecast_accuracy_perfect_predictor():
    df = _toy_actuals()
    fc = df.rename(columns={"units": "units"}).copy()
    acc = forecast_accuracy(df, fc)
    assert (acc["mape"] == 0.0).all()
    assert (acc["rmse"] == 0.0).all()


def test_forecast_accuracy_bias_direction():
    actuals = _toy_actuals()
    fc = actuals.copy()
    fc["units"] = fc["units"] + 5
    acc = forecast_accuracy(actuals, fc)
    assert (acc["bias"] > 0).all()
    fc2 = actuals.copy()
    fc2["units"] = fc2["units"] - 5
    acc2 = forecast_accuracy(actuals, fc2)
    assert (acc2["bias"] < 0).all()


def test_days_of_cover_math():
    on_hand = pd.DataFrame(
        [{"sku_id": "SKU1", "segment": "food_service", "units_on_hand": 100}]
    )
    fc = pd.DataFrame(
        [
            {"sku_id": "SKU1", "segment": "food_service", "order_date": pd.Timestamp("2024-06-01"), "units": 10},
            {"sku_id": "SKU1", "segment": "food_service", "order_date": pd.Timestamp("2024-06-02"), "units": 20},
        ]
    )
    out = days_of_cover(on_hand, fc, horizon_days=14)
    # avg daily = 15 => doc = 100/15 ~ 6.667; stockout days = max(0, 14-6.667) ~ 7.33
    assert out["days_of_cover"].iloc[0] == pytest.approx(100 / 15, rel=1e-6)
    assert out["projected_stockout_days"].iloc[0] == pytest.approx(14 - 100 / 15, rel=1e-6)


def test_days_of_cover_zero_demand_is_infinite():
    on_hand = pd.DataFrame(
        [{"sku_id": "SKU1", "segment": "food_service", "units_on_hand": 50}]
    )
    fc = pd.DataFrame(
        [{"sku_id": "SKU1", "segment": "food_service", "order_date": pd.Timestamp("2024-06-01"), "units": 0}]
    )
    out = days_of_cover(on_hand, fc)
    assert np.isinf(out["days_of_cover"].iloc[0])
    assert out["projected_stockout_days"].iloc[0] == 0


def test_stockout_risk_classification():
    doc = pd.DataFrame(
        [
            {"sku_id": "A", "segment": "food_service", "units_on_hand": 0, "avg_daily_forecast": 10, "days_of_cover": 3.0, "projected_stockout_days": 11},
            {"sku_id": "B", "segment": "food_service", "units_on_hand": 0, "avg_daily_forecast": 10, "days_of_cover": 8.0, "projected_stockout_days": 6},
            {"sku_id": "C", "segment": "food_service", "units_on_hand": 0, "avg_daily_forecast": 10, "days_of_cover": 30.0, "projected_stockout_days": 0},
        ]
    )
    lead = pd.DataFrame(
        [{"sku_id": "A", "lead_time_days": 7}, {"sku_id": "B", "lead_time_days": 7}, {"sku_id": "C", "lead_time_days": 7}]
    )
    out = stockout_risk_flag(doc, lead).set_index("sku_id")
    assert out.loc["A", "stockout_risk"] == "high"
    assert out.loc["B", "stockout_risk"] == "medium"
    assert out.loc["C", "stockout_risk"] == "low"


def test_slow_movers_labels(order_panel):
    df = slow_movers(order_panel)
    assert {"baseline_daily", "recent_daily", "delta_pct", "movement"} <= set(df.columns)
    assert df["movement"].isin(["decelerating", "stable", "accelerating"]).all()


def test_revenue_concentration_sums_to_one(order_panel):
    out = revenue_concentration(order_panel)
    assert out["share"].sum() == pytest.approx(1.0, rel=1e-6)
    # Cumulative must be monotonic non-decreasing
    assert (out["cumulative_share"].diff().fillna(0) >= -1e-9).all()


def test_anomalies_finds_known_supply_shock(order_panel):
    """The glove supply shock (Sept 2024) should produce flagged glove anomalies.

    During and right after the shock window we expect either shortfalls (during)
    or surges (as the rolling baseline catches up to the depressed window and
    the recovery surprises the seasonal naive predictor).
    """
    from stocksense.models import SeasonalNaive

    sn = SeasonalNaive().fit(order_panel)
    pred = order_panel[["sku_id", "segment", "order_date"]].copy()
    pred["units"] = sn.predict(pred).values
    flagged = anomalies(order_panel, pred, z_threshold=2.0)
    glove_september = flagged[
        (flagged["sku_id"].isin(["GLV-NIT-M", "GLV-NIT-L"]))
        & (flagged["order_date"].between("2024-09-01", "2024-09-30"))
    ]
    assert len(glove_september) >= 5, (
        f"Expected several glove anomalies in Sept 2024, got {len(glove_september)}"
    )
    # And at least one of those should be a shortfall, since the shock itself
    # is a downward event
    assert (glove_september["direction"] == "shortfall").any()
