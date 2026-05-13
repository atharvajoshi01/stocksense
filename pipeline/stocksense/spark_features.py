"""PySpark version of the feature engineering step.

Exposes a single `build_features_spark` that mirrors the Pandas implementation
in `features.py` row-for-row. A parity test (tests/test_spark_parity.py) loads
both, runs them on a slice, and asserts equality on the shared columns.

The point is not to win on raw speed for a 13k-row demo: it is to demonstrate
that the same logic ports cleanly to a distributed engine for the cases when
the panel grows to tens of millions of rows per day across thousands of SKUs.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import numpy as np

from .features import GRAIN, LAG_DAYS, ROLLING_WINDOWS

if TYPE_CHECKING:  # pragma: no cover
    from pyspark.sql import DataFrame as SparkDataFrame
    from pyspark.sql import SparkSession


def build_features_spark(spark_df: "SparkDataFrame", target: str = "units") -> "SparkDataFrame":
    """Return a Spark DataFrame with the same feature columns as the Pandas pipeline."""
    from pyspark.sql import functions as F
    from pyspark.sql.window import Window

    sdf = spark_df.withColumn("order_date", F.to_date("order_date"))
    w = Window.partitionBy(*GRAIN).orderBy("order_date")

    for lag in LAG_DAYS:
        sdf = sdf.withColumn(f"lag_{lag}", F.lag(F.col(target), lag).over(w))

    for window in ROLLING_WINDOWS:
        min_periods = max(2, window // 2)
        # Shift 1 day first, then rolling over the prior window
        # Spark approach: build a windowed mean/std on (rowsBetween) ranging the prior window
        wr = w.rowsBetween(-(window), -1)
        sdf = sdf.withColumn(
            f"roll_mean_{window}",
            F.when(
                F.count(F.col(target)).over(wr) >= min_periods,
                F.avg(F.col(target)).over(wr),
            ),
        )
        sdf = sdf.withColumn(
            f"roll_std_{window}",
            F.when(
                F.count(F.col(target)).over(wr) >= min_periods,
                F.stddev(F.col(target)).over(wr),
            ),
        )

    sdf = (
        sdf.withColumn("dow", F.dayofweek("order_date") - 2)  # Spark dow: Sun=1..Sat=7
        .withColumn("dow", F.when(F.col("dow") < 0, F.col("dow") + 7).otherwise(F.col("dow")))
        .withColumn("day_of_month", F.dayofmonth("order_date"))
        .withColumn("day_of_year", F.dayofyear("order_date"))
        .withColumn("month", F.month("order_date"))
        .withColumn("week_of_year", F.weekofyear("order_date"))
        .withColumn("is_weekend", (F.col("dow") >= 5).cast("int"))
        .withColumn("dow_sin", F.sin(F.lit(2 * np.pi) * F.col("dow") / F.lit(7)))
        .withColumn("dow_cos", F.cos(F.lit(2 * np.pi) * F.col("dow") / F.lit(7)))
        .withColumn("month_sin", F.sin(F.lit(2 * np.pi) * F.col("month") / F.lit(12)))
        .withColumn("month_cos", F.cos(F.lit(2 * np.pi) * F.col("month") / F.lit(12)))
        .withColumn("seg_food_service", (F.col("segment") == "food_service").cast("int"))
        .withColumn("seg_healthcare", (F.col("segment") == "healthcare").cast("int"))
    )
    return sdf


def get_or_create_session(app: str = "stocksense") -> "SparkSession":  # pragma: no cover
    """Convenience for ad-hoc Spark sessions. Tests build their own."""
    from pyspark.sql import SparkSession

    return SparkSession.builder.appName(app).master("local[2]").getOrCreate()
