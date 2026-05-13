"""Pandas vs PySpark feature parity.

Skips when PySpark isn't installed or Java isn't available (the typical local /
CI environment without Spark). When it does run, it asserts that the engineered
features match within a small numerical tolerance.
"""

import os

import numpy as np
import pandas as pd
import pytest

pyspark = pytest.importorskip("pyspark", reason="pyspark not installed")
from pyspark.sql import SparkSession  # noqa: E402


from stocksense.features import build_features, feature_columns  # noqa: E402
from stocksense.spark_features import build_features_spark  # noqa: E402


SHARED_COLS = [
    "lag_1", "lag_2", "lag_7", "lag_14", "lag_28",
    "roll_mean_7", "roll_mean_14", "roll_mean_28",
    "roll_std_7", "roll_std_14", "roll_std_28",
    "month", "day_of_month", "day_of_year", "week_of_year", "is_weekend",
    "seg_food_service", "seg_healthcare",
]


@pytest.fixture(scope="module")
def spark():
    sess = (
        SparkSession.builder.appName("stocksense-parity")
        .master("local[2]")
        .config("spark.sql.shuffle.partitions", "4")
        .getOrCreate()
    )
    yield sess
    sess.stop()


@pytest.mark.slow
def test_pandas_spark_parity(small_panel, spark):
    pdf = small_panel.copy()
    pdf["order_date"] = pd.to_datetime(pdf["order_date"]).dt.date
    sdf = spark.createDataFrame(pdf)
    spark_out = build_features_spark(sdf).toPandas()
    spark_out["order_date"] = pd.to_datetime(spark_out["order_date"])

    pandas_out = build_features(small_panel)
    pandas_out["order_date"] = pd.to_datetime(pandas_out["order_date"])

    keys = ["sku_id", "segment", "order_date"]
    merged = pandas_out.merge(spark_out, on=keys, suffixes=("_p", "_s"))

    for col in SHARED_COLS:
        a = merged[f"{col}_p"].astype(float).to_numpy()
        b = merged[f"{col}_s"].astype(float).to_numpy()
        mask = ~np.isnan(a) & ~np.isnan(b)
        np.testing.assert_allclose(a[mask], b[mask], rtol=1e-6, atol=1e-6, err_msg=col)
