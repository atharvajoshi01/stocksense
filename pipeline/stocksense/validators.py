"""Data quality validators for the order panel.

Each check returns a `Finding` describing what was checked, whether it passed,
and a count of offending rows when applicable. Validators are pure functions
on a DataFrame so the same definitions are reused at ingest time and in tests.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable

import pandas as pd

REQUIRED_COLUMNS: tuple[str, ...] = (
    "order_date",
    "sku_id",
    "product_family",
    "segment",
    "units",
    "revenue",
    "is_promo",
    "is_supply_shock",
)

VALID_SEGMENTS: frozenset[str] = frozenset({"food_service", "healthcare"})


@dataclass
class Finding:
    name: str
    passed: bool
    detail: str = ""
    offending_rows: int = 0


@dataclass
class ValidationReport:
    findings: list[Finding] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return all(f.passed for f in self.findings)

    @property
    def failed(self) -> list[Finding]:
        return [f for f in self.findings if not f.passed]

    def to_dict(self) -> dict:
        return {
            "passed": self.passed,
            "n_findings": len(self.findings),
            "n_failed": len(self.failed),
            "findings": [
                {
                    "name": f.name,
                    "passed": f.passed,
                    "detail": f.detail,
                    "offending_rows": f.offending_rows,
                }
                for f in self.findings
            ],
        }


def _check_schema(df: pd.DataFrame) -> Finding:
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        return Finding(
            name="schema:required_columns",
            passed=False,
            detail=f"Missing required columns: {missing}",
        )
    return Finding(name="schema:required_columns", passed=True, detail="All required columns present")


def _check_no_nulls(df: pd.DataFrame, columns: Iterable[str]) -> Finding:
    cols = [c for c in columns if c in df.columns]
    if not cols:
        return Finding(name="nulls:critical", passed=True, detail="No critical columns to check")
    null_counts = df[cols].isna().sum()
    bad = null_counts[null_counts > 0]
    if len(bad):
        return Finding(
            name="nulls:critical",
            passed=False,
            detail=f"Null counts: {bad.to_dict()}",
            offending_rows=int(bad.sum()),
        )
    return Finding(name="nulls:critical", passed=True, detail="No nulls in critical columns")


def _check_segments(df: pd.DataFrame) -> Finding:
    if "segment" not in df.columns:
        return Finding(name="segment:domain", passed=True, detail="segment column missing, skipping")
    bad = ~df["segment"].isin(VALID_SEGMENTS)
    if bad.any():
        return Finding(
            name="segment:domain",
            passed=False,
            detail=f"Unexpected segments: {df.loc[bad, 'segment'].unique().tolist()}",
            offending_rows=int(bad.sum()),
        )
    return Finding(name="segment:domain", passed=True, detail="All segments in domain")


def _check_non_negative(df: pd.DataFrame, column: str) -> Finding:
    if column not in df.columns:
        return Finding(name=f"range:{column}>=0", passed=True, detail="column missing")
    bad = df[column] < 0
    if bad.any():
        return Finding(
            name=f"range:{column}>=0",
            passed=False,
            detail=f"{int(bad.sum())} negative values in {column}",
            offending_rows=int(bad.sum()),
        )
    return Finding(name=f"range:{column}>=0", passed=True, detail="No negative values")


def _check_unique_grain(df: pd.DataFrame) -> Finding:
    keys = ["order_date", "sku_id", "segment"]
    if any(k not in df.columns for k in keys):
        return Finding(name="grain:unique", passed=True, detail="grain columns missing, skipping")
    dup = df.duplicated(subset=keys)
    if dup.any():
        return Finding(
            name="grain:unique",
            passed=False,
            detail=f"{int(dup.sum())} duplicate (date, sku, segment) rows",
            offending_rows=int(dup.sum()),
        )
    return Finding(name="grain:unique", passed=True, detail="Grain is unique")


def _check_date_continuity(df: pd.DataFrame) -> Finding:
    if "order_date" not in df.columns:
        return Finding(name="date:continuity", passed=True, detail="order_date missing")
    dates = pd.to_datetime(df["order_date"])
    expected = pd.date_range(dates.min(), dates.max(), freq="D")
    actual = pd.DatetimeIndex(sorted(dates.unique()))
    missing = expected.difference(actual)
    if len(missing):
        return Finding(
            name="date:continuity",
            passed=False,
            detail=f"{len(missing)} missing calendar days between min and max",
            offending_rows=len(missing),
        )
    return Finding(name="date:continuity", passed=True, detail="No calendar gaps")


def _check_revenue_consistency(df: pd.DataFrame) -> Finding:
    """Revenue should be non-zero when units > 0."""
    if not {"units", "revenue"}.issubset(df.columns):
        return Finding(name="revenue:consistency", passed=True, detail="missing columns")
    bad = (df["units"] > 0) & (df["revenue"] <= 0)
    if bad.any():
        return Finding(
            name="revenue:consistency",
            passed=False,
            detail="Rows with units > 0 but revenue <= 0",
            offending_rows=int(bad.sum()),
        )
    return Finding(name="revenue:consistency", passed=True, detail="Revenue consistent with units")


def validate(df: pd.DataFrame) -> ValidationReport:
    """Run all validators and return a report."""
    report = ValidationReport()
    report.findings.append(_check_schema(df))
    if report.findings[-1].passed:
        report.findings.append(_check_no_nulls(df, ["order_date", "sku_id", "segment", "units"]))
        report.findings.append(_check_segments(df))
        report.findings.append(_check_non_negative(df, "units"))
        report.findings.append(_check_non_negative(df, "revenue"))
        report.findings.append(_check_unique_grain(df))
        report.findings.append(_check_date_continuity(df))
        report.findings.append(_check_revenue_consistency(df))
    return report
