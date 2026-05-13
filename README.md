# StockSense

> Demand forecasting and inventory health for a disposable-products distributor.

[![CI](https://github.com/atharvajoshi01/stocksense/actions/workflows/ci.yml/badge.svg)](https://github.com/atharvajoshi01/stocksense/actions)
[![Python 3.10+](https://img.shields.io/badge/python-3.10+-1f6feb.svg)](https://python.org)
[![Tests](https://img.shields.io/badge/tests-31%20passed-2da44e.svg)](#tests)

StockSense is an end-to-end demand forecasting and inventory health platform built for the
operating model of a disposable-products distributor serving healthcare and food service —
gloves, wraps, containers, cutlery, portion cups, and exam supplies. It produces SKU-level
forecasts, surfaces stockout risk before it happens, flags demand anomalies, and tracks data
quality on every run.

Live dashboard: <https://stocksense-ajoshs-projects.vercel.app/>

The dashboard runs in two modes:

- **Snapshot mode** (default, no setup): reads pre-computed JSON artifacts
  produced by the offline Python pipeline. Useful for a fully reproducible
  demo with zero external dependencies.
- **Live mode**: backs the same dashboard with a Supabase Postgres database,
  exposes write APIs, accepts new orders / inventory updates / CSV uploads
  through the **Input** page, and pushes realtime updates over WebSockets.

See [`SUPABASE.md`](./SUPABASE.md) for the 10-minute live-mode setup.

---

## Highlights

| Capability                | Where in the repo                                                 |
| ------------------------- | ----------------------------------------------------------------- |
| Synthetic order panel     | `pipeline/stocksense/generate.py` — 13k daily rows, 12 SKUs × 2 segments, 18 months, with realistic seasonality, promo lifts, and a supply-shock episode |
| Data quality validators   | `pipeline/stocksense/validators.py` — schema, null, range, grain uniqueness, calendar continuity, revenue consistency |
| Pandas feature engineering| `pipeline/stocksense/features.py` — lags, rolling means/stds, calendar, cyclical sin/cos, segment encoding; provably no future leakage |
| PySpark feature parity    | `pipeline/stocksense/spark_features.py` — same logic in Spark; tested against Pandas to numerical tolerance |
| Forecasting models        | `pipeline/stocksense/models.py` — Seasonal Naive baseline, Histogram Gradient Boosted Trees, SARIMAX |
| Walk-forward backtest     | `pipeline/stocksense/backtest.py` — disjoint train/test by date, per-fold metrics, per-panel model selection |
| Inventory & KPI math      | `pipeline/stocksense/kpis.py` — days of cover, stockout risk, slow movers, revenue concentration, residual-based anomalies |
| Tiny DAG orchestrator     | `pipeline/stocksense/orchestrator.py` — topo-sort + cycle detection, no Airflow infra needed |
| JSON export for the web   | `pipeline/stocksense/export.py` |
| Next.js + Recharts UI     | `web/` — dark-mode dashboard with KPI cards, leaderboard, per-SKU forecast charts with 95% bands, anomaly timeline, inventory table, data-quality view |
| Live data layer           | `web/lib/supabase.ts`, `web/lib/loaders.ts` — Supabase reads with snapshot fallback; `web/app/api/*` write routes with service-role |
| Realtime + input          | `web/components/LiveIndicator.tsx`, `web/app/input/page.tsx` — websocket subscription with toast on order/anomaly; forms + CSV bulk upload |
| Database schema           | `supabase/schema.sql` — tables, RLS, indexes, anomaly trigger, realtime publication |
| CI                        | `.github/workflows/ci.yml` — ruff lint, pytest, full pipeline smoke, Next.js build |

## Architecture

```
                   ┌─────────────────────────────────────────┐
                   │                  pipeline/              │
                   │                                         │
generate ─▶ validate ─▶ backtest each ─▶ select winners ─▶ fit winners ─▶ forecast 14d
                                       │                                  │
                                       └▶ inventory health ◀──────────────┘
                                       └▶ slow movers, anomalies, concentration
                                       │
                                       ▼
                              export.py → web/public/data/*.json
                   └─────────────────────────────────────────┘
                                       │
                                       ▼
                              ┌────────────────────┐
                              │     web/ (Next)    │
                              │  Recharts + RSC    │
                              │  static-rendered   │
                              │  on Vercel         │
                              └────────────────────┘
```

The Python pipeline computes every metric and serializes JSON. The dashboard is a fully static
Next.js build — no Python at runtime — which keeps the Vercel deploy simple while the repo
itself shows the full data engineering and modeling stack.

## Results on the sample run

```
forecaster        MAPE     RMSE    bias
hgbt              0.219    15.14   -0.18
seasonal_naive_7  0.274    18.55   +1.53
```

The HGBT model is selected for 24/24 panels because it wins MAPE on every SKU × segment, with
near-zero bias and a 22% lower RMSE than the seasonal-naive baseline. Walk-forward
cross-validation (3 folds, 14-day horizon, 270-day initial training window) prevents lookahead.

## Quick start

```bash
# 1. install
python -m pip install -e ".[dev]"

# 2. run pipeline (writes JSON into web/public/data)
PYTHONPATH=pipeline python -m stocksense.run

# 3. run dashboard
cd web && npm install && npm run dev
```

Open <http://localhost:3000>.

## Tests

```bash
PYTHONPATH=pipeline pytest -ra
```

31 tests cover:

- every validator pass/fail path
- lag and rolling-feature correctness, including a leakage probe that truncates history and
  asserts feature values are stable
- KPI math: days-of-cover, stockout-risk classification, revenue concentration, MAPE bias
  direction, anomaly recall on the known glove supply shock
- backtest fold structure (train ≤ cutoff < test), winner-selection coverage
- DAG topological order, cycle detection, dependency wiring
- Pandas ↔ PySpark feature parity (skipped automatically when PySpark is absent)

## What lines up with the Daxwell role

| Daxwell requirement                              | Implementation                                          |
| ------------------------------------------------ | ------------------------------------------------------- |
| SQL, Python, Pandas analytical workflows         | DuckDB + Pandas pipeline, end-to-end                    |
| PySpark for distributed processing               | `spark_features.py` with parity test                    |
| Data validation, cleansing, transformation       | `validators.py` running 7 checks per pass               |
| EDA and ad-hoc analytical models                 | Tested KPIs in `kpis.py`, forecast leaderboard          |
| KPI frameworks across finance / supply chain     | Revenue, units, MAPE, DOC, stockout risk, concentration |
| Dashboards and visualization                     | `web/` Next.js + Recharts on Vercel                     |
| Backtesting and statistical rigor                | Walk-forward CV, per-panel model selection              |
| GBT and statistical model families               | HGBT, SARIMAX, Seasonal Naive                           |
| Data orchestration                               | DAG orchestrator with topological sort                  |
| Communicating findings to non-technical stakeholders | Dashboard is the deliverable                       |

## License

MIT. Synthetic data; no third-party IP or PII.
