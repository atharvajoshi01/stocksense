import pandas as pd
import pytest

from stocksense.validators import (
    REQUIRED_COLUMNS,
    VALID_SEGMENTS,
    validate,
)


def test_clean_panel_passes(order_panel):
    report = validate(order_panel)
    assert report.passed, [f.detail for f in report.failed]


def test_missing_column_fails():
    df = pd.DataFrame({"sku_id": ["X"]})
    report = validate(df)
    assert not report.passed
    assert any(f.name == "schema:required_columns" for f in report.findings)


def test_bad_segment_fails(order_panel):
    df = order_panel.copy()
    df.loc[0, "segment"] = "wholesale"  # not in VALID_SEGMENTS
    report = validate(df)
    assert not report.passed
    assert any(not f.passed and "segment" in f.name for f in report.findings)


def test_negative_units_fails(order_panel):
    df = order_panel.copy()
    df.loc[10, "units"] = -5.0
    report = validate(df)
    assert not report.passed
    assert any(f.name == "range:units>=0" and not f.passed for f in report.findings)


def test_duplicate_grain_fails(order_panel):
    df = pd.concat([order_panel, order_panel.iloc[[0]]], ignore_index=True)
    report = validate(df)
    assert not report.passed
    assert any(f.name == "grain:unique" and not f.passed for f in report.findings)


def test_calendar_gap_fails(order_panel):
    df = order_panel[order_panel["order_date"] != order_panel["order_date"].iloc[5]].copy()
    report = validate(df)
    assert not report.passed
    assert any(f.name == "date:continuity" and not f.passed for f in report.findings)


def test_required_columns_listed():
    assert "order_date" in REQUIRED_COLUMNS
    assert "units" in REQUIRED_COLUMNS
    assert "segment" in REQUIRED_COLUMNS


def test_segment_set():
    assert VALID_SEGMENTS == {"food_service", "healthcare"}
