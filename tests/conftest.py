"""Shared test fixtures."""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
import pytest

# Ensure pipeline package is importable
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))

from stocksense.generate import GenerationConfig, generate  # noqa: E402


@pytest.fixture(scope="session")
def order_panel() -> pd.DataFrame:
    """Full 18-month panel used across most tests."""
    return generate()


@pytest.fixture(scope="session")
def small_panel() -> pd.DataFrame:
    """A short panel for fast parity / leakage tests."""
    cfg = GenerationConfig(
        start=pd.Timestamp("2024-06-01").date(),
        end=pd.Timestamp("2024-08-31").date(),
        seed=7,
    )
    return generate(cfg)
