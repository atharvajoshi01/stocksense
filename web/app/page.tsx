import Link from "next/link";

import { KpiCard } from "@/components/KpiCard";
import { Section } from "@/components/Section";
import { RiskBadge } from "@/components/RiskBadge";
import { RefreshedAt } from "@/components/RefreshedAt";
import { SourceBadge } from "@/components/SourceBadge";
import {
  loadInventory,
  loadKpis,
  loadLeaderboard,
  loadMeta,
  loadRevenueConcentration,
  loadSlowMovers,
} from "@/lib/loaders";
import { fmtCurrency, fmtDate, fmtNumber, fmtPct } from "@/lib/format";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function OverviewPage() {
  const [meta, kpis, inv, slowMovers, leaderboard, rev] = await Promise.all([
    loadMeta(),
    loadKpis(),
    loadInventory(),
    loadSlowMovers(),
    loadLeaderboard(),
    loadRevenueConcentration(),
  ]);
  const inventory = inv.rows;

  const highRiskTop = inventory
    .filter((r) => r.stockout_risk === "high")
    .sort((a, b) => b.projected_stockout_days - a.projected_stockout_days)
    .slice(0, 6);

  const bestModel = leaderboard
    .map((m) => ({ name: m.forecaster, mape: m.overall.mape }))
    .sort((a, b) => a.mape - b.mape)[0];

  const top5 = rev.slice(0, 5);
  const top5Share = top5.reduce((s, r) => s + r.share, 0);

  return (
    <div>
      <div className="flex flex-col gap-1 mb-2">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
          <div className="flex items-center gap-3">
            <SourceBadge source={kpis.source} />
            <RefreshedAt iso={kpis.generated_at} />
          </div>
        </div>
        <p className="text-zinc-400">
          {meta.n_orders.toLocaleString()} orders across {meta.n_skus} SKUs and {meta.n_segments}{" "}
          customer segments from {fmtDate(meta.start_date)} to {fmtDate(meta.end_date)}.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12 mt-6">
        <KpiCard
          label="Revenue, last 30 days"
          value={fmtCurrency(kpis.revenue_last_30d)}
          hint={
            kpis.revenue_change_pct === null
              ? undefined
              : `${kpis.revenue_change_pct >= 0 ? "+" : ""}${fmtPct(kpis.revenue_change_pct)} vs prior 30 days`
          }
          variant={kpis.revenue_change_pct && kpis.revenue_change_pct >= 0 ? "good" : "default"}
        />
        <KpiCard
          label="Units shipped, 30d"
          value={fmtNumber(kpis.units_last_30d, { compact: true })}
        />
        <KpiCard
          label="Forecast MAPE"
          value={kpis.forecast_mape === null ? "—" : fmtPct(kpis.forecast_mape)}
          hint={
            kpis.forecast_bias !== undefined
              ? `bias ${kpis.forecast_bias > 0 ? "+" : ""}${fmtNumber(kpis.forecast_bias, { digits: 2 })} units / day`
              : undefined
          }
          variant={
            kpis.forecast_mape === null
              ? "default"
              : kpis.forecast_mape < 0.25
                ? "good"
                : kpis.forecast_mape < 0.35
                  ? "warning"
                  : "bad"
          }
        />
        <KpiCard
          label="High stockout risk"
          value={`${kpis.high_risk_skus}`}
          hint="SKU-segments where DOC < lead time"
          variant={kpis.high_risk_skus > 5 ? "bad" : kpis.high_risk_skus > 0 ? "warning" : "good"}
        />
      </div>

      <Section
        title="At-risk inventory"
        description="Sorted by projected stockout days inside the 14-day forecast horizon."
        right={
          <Link href="/inventory" className="text-sm text-emerald-400 hover:text-emerald-300">
            See all inventory →
          </Link>
        }
      >
        <div className="rounded-xl border border-zinc-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900/60 text-xs uppercase tracking-wider text-zinc-400">
              <tr>
                <th className="text-left p-3">SKU</th>
                <th className="text-left p-3">Segment</th>
                <th className="text-right p-3">On hand</th>
                <th className="text-right p-3">Days of cover</th>
                <th className="text-right p-3">Stockout days</th>
                <th className="text-right p-3">Lead time</th>
                <th className="text-right p-3">Risk</th>
              </tr>
            </thead>
            <tbody>
              {highRiskTop.map((row) => (
                <tr key={`${row.sku_id}-${row.segment}`} className="border-t border-zinc-800/80">
                  <td className="p-3 font-mono text-xs">
                    <Link
                      href={`/forecasts/${encodeURIComponent(row.sku_id)}/${row.segment}`}
                      className="text-emerald-400 hover:text-emerald-300"
                    >
                      {row.sku_id}
                    </Link>
                  </td>
                  <td className="p-3 text-zinc-400">{row.segment.replace("_", " ")}</td>
                  <td className="p-3 text-right tabular-nums">{fmtNumber(row.units_on_hand)}</td>
                  <td className="p-3 text-right tabular-nums">
                    {Number.isFinite(row.days_of_cover) ? row.days_of_cover.toFixed(1) : "∞"}
                  </td>
                  <td className="p-3 text-right tabular-nums">{row.projected_stockout_days.toFixed(1)}</td>
                  <td className="p-3 text-right tabular-nums">{row.lead_time_days}d</td>
                  <td className="p-3 text-right">
                    <RiskBadge level={row.stockout_risk} />
                  </td>
                </tr>
              ))}
              {highRiskTop.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-zinc-500">
                    No high-risk SKUs at the current snapshot.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid md:grid-cols-2 gap-8 mb-12">
        <Section
          title="Best forecaster"
          description="Overall walk-forward backtest metrics (3 folds × 14-day horizon)."
        >
          <div className="rounded-xl border border-zinc-800 p-5">
            <div className="flex items-baseline gap-3">
              <span className="text-2xl font-semibold tabular-nums">{bestModel?.name}</span>
              <span className="text-zinc-400 text-sm">
                MAPE {fmtPct(bestModel?.mape ?? 0)}
              </span>
            </div>
            <div className="mt-4 text-sm text-zinc-300 space-y-2">
              {leaderboard.map((m) => (
                <div key={m.forecaster} className="flex justify-between border-t border-zinc-800/60 pt-2">
                  <span className="text-zinc-400">{m.forecaster}</span>
                  <span className="tabular-nums">
                    MAPE {fmtPct(m.overall.mape)} · RMSE {m.overall.rmse.toFixed(1)} · bias{" "}
                    {m.overall.bias.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
            <Link
              href="/leaderboard"
              className="inline-block mt-4 text-sm text-emerald-400 hover:text-emerald-300"
            >
              Full leaderboard →
            </Link>
          </div>
        </Section>

        <Section
          title="Revenue concentration"
          description="Top 5 SKUs by trailing 90-day revenue."
        >
          <div className="rounded-xl border border-zinc-800 p-5">
            <div className="text-sm text-zinc-400">
              The top 5 SKUs deliver <span className="text-zinc-100">{fmtPct(top5Share)}</span> of
              trailing 90-day revenue.
            </div>
            <div className="mt-4 space-y-2 text-sm">
              {top5.map((r) => (
                <div key={r.sku_id} className="flex items-center gap-3">
                  <div className="font-mono text-xs w-24">{r.sku_id}</div>
                  <div className="flex-1 h-2 rounded-full bg-zinc-800 overflow-hidden">
                    <div
                      className="h-2 bg-emerald-500/80"
                      style={{ width: `${(r.share / (top5[0]?.share || 1)) * 100}%` }}
                    />
                  </div>
                  <div className="w-20 text-right tabular-nums text-zinc-300">
                    {fmtCurrency(r.revenue)}
                  </div>
                  <div className="w-12 text-right tabular-nums text-zinc-500">
                    {fmtPct(r.share, 0)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Section>
      </div>

      <Section
        title="Movement"
        description="Recent 30-day average daily demand vs trailing 90-day baseline."
      >
        <div className="rounded-xl border border-zinc-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900/60 text-xs uppercase tracking-wider text-zinc-400">
              <tr>
                <th className="text-left p-3">SKU</th>
                <th className="text-left p-3">Segment</th>
                <th className="text-right p-3">Baseline (90d)</th>
                <th className="text-right p-3">Recent (30d)</th>
                <th className="text-right p-3">Δ%</th>
                <th className="text-right p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {slowMovers
                .slice()
                .sort((a, b) => (b.delta_pct ?? 0) - (a.delta_pct ?? 0))
                .slice(0, 8)
                .map((row) => (
                  <tr key={`${row.sku_id}-${row.segment}`} className="border-t border-zinc-800/80">
                    <td className="p-3 font-mono text-xs">{row.sku_id}</td>
                    <td className="p-3 text-zinc-400">{row.segment.replace("_", " ")}</td>
                    <td className="p-3 text-right tabular-nums">{row.baseline_daily.toFixed(1)}</td>
                    <td className="p-3 text-right tabular-nums">{row.recent_daily.toFixed(1)}</td>
                    <td
                      className={`p-3 text-right tabular-nums ${
                        (row.delta_pct ?? 0) > 0 ? "text-emerald-300" : "text-rose-300"
                      }`}
                    >
                      {row.delta_pct === null ? "—" : fmtPct(row.delta_pct)}
                    </td>
                    <td className="p-3 text-right text-xs uppercase tracking-wider text-zinc-400">
                      {row.movement}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
