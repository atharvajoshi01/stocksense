# StockSense — 5-to-10-minute walkthrough script

Target audience: Daxwell hiring panel.
Format: screen recording (Loom or QuickTime) with voice-over.
Goal: show that the repo solves a real Daxwell-shaped supply-chain problem end-to-end and
that the code is reviewable.

## Suggested structure

### 0:00 – 0:30   Hook + framing
> "Daxwell sells gloves, wraps, containers and cutlery into healthcare and food service. Two
> of the most expensive decisions in that business are: how much of each SKU to forecast,
> and when to reorder. StockSense is an end-to-end project I built around that exact
> problem. I'll show you the dashboard first, then walk through the code."

Open the live URL. Pause for one beat on the **Overview** so the audience can read it.

### 0:30 – 1:30   Dashboard overview
Talk through, in order:
1. The top KPI strip — 30-day revenue with delta vs prior 30 days, forecast MAPE, count of
   high-risk SKUs.
2. The **At-risk inventory** table — point at one row, explain "this SKU has 3 days of cover
   against a 7-day lead time, so reordering is already late."
3. **Best forecaster** card — "HGBT wins MAPE 22%, baseline is 27%, so the model is buying us
   a real five-point reduction."
4. **Revenue concentration** — "top 5 SKUs are 75% of revenue, which tells operations where
   accuracy matters most."

### 1:30 – 3:00   SKU drill-down
Click a high-risk glove SKU. Talk through:
- The actuals → forecast chart with 95% band.
- The model-selection table on the right ("HGBT beat seasonal naive on this exact panel").
- Inventory details on the right pane.

Then click **Anomalies**. Find a glove shortfall in early September.
> "This is a synthetic supply shock I planted in the data — gloves dropped 65% for two
> weeks. The anomaly detector flagged it correctly because residuals against the
> seasonal-naive predictor exceeded 2 sigma on a 14-day rolling window."

### 3:00 – 5:00   Code tour
Open the repo. Pause on each:
1. `pipeline/stocksense/generate.py` — show the realistic patterns: weekly seasonality
   (food service spikes weekends, healthcare spikes weekdays), yearly seasonality, promo
   windows, supply shock.
2. `pipeline/stocksense/validators.py` — point at the 7 data-quality checks.
3. `pipeline/stocksense/features.py` — the lag and rolling features. Emphasize the leakage
   guard: rolling stats are shifted before windowing.
4. `pipeline/stocksense/models.py` — the three forecaster families. Show the recursive
   prediction loop in `GradientBoostedForecaster.predict`.
5. `pipeline/stocksense/backtest.py` — walk-forward CV with disjoint train/test windows by
   date.
6. `pipeline/stocksense/spark_features.py` — PySpark version of feature engineering.
7. `pipeline/stocksense/orchestrator.py` — small DAG runner.
8. `tests/` — show that there's a leakage test that truncates history and asserts feature
   values do not change.

### 5:00 – 6:30   CI and reproducibility
- Open `.github/workflows/ci.yml`. Mention: ruff lint, pytest, full pipeline smoke run,
  Next.js build.
- Run `pytest -ra` locally on camera. 31 tests pass in under 5 seconds.
- Show `python -m stocksense.run` regenerating every JSON artifact.

### 6:30 – 8:00   Choices and trade-offs
> "Two design choices worth calling out. First, I separated the modeling pipeline from the
> dashboard runtime. The Python pipeline writes static JSON; the Next.js app is purely
> render-time. That means no Python on Vercel — cheaper, faster cold starts — but the repo
> still shows the full data science stack. Second, I included a PySpark version of feature
> engineering that's parity-tested against the Pandas version. The point isn't speed on 13k
> rows; it's showing that the same logic scales when the panel grows to tens of millions of
> rows per day."

### 8:00 – 9:30   What I'd build next
Open `README.md` and skim. Talk about:
- Adding a Kafka/Flink streaming variant for live order ingestion.
- Replacing the synthetic on-hand inventory with a real ERP integration shape.
- Persisting backtest history so model drift is visible over time.
- A causal-inference module for promo-lift estimation.

### 9:30 – 10:00   Close
> "Code's on GitHub at github.com/atharvajoshi01/stocksense. Dashboard is live at the
> Vercel URL. Thanks for watching."

## Recording tips

- Quit Slack and notifications.
- Run the dev server in advance — `npm run dev` from `web/` — so page transitions are fast.
- Keep the cursor steady, hover over the chart once so the tooltip shows up, then move on.
- 95th percentile of a good walkthrough is unhurried diction and matching the camera to
  exactly the artifact you're describing. Don't read the README to them; describe what's on
  screen.
