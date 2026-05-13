import Link from "next/link";

import { Section } from "@/components/Section";
import { loadForecasts, loadInventory, loadLeaderboard, loadMeta } from "@/lib/data";
import { fmtPct } from "@/lib/format";

export const dynamic = "force-static";

export default async function ForecastsIndex() {
  const [forecasts, meta, leaderboard, inventory] = await Promise.all([
    loadForecasts(),
    loadMeta(),
    loadLeaderboard(),
    loadInventory(),
  ]);

  const winners = new Map<string, string>();
  for (const lb of leaderboard) {
    // Track best per panel from the chosen winner table — not needed; the
    // backend already picked the winner. We surface MAPE on the row instead.
  }

  // Per-panel MAPE: average across all model results for that panel
  const panelMape = new Map<string, number>();
  for (const lb of leaderboard) {
    for (const r of lb.per_sku) {
      const key = `${r.sku_id}__${r.segment}`;
      const prior = panelMape.get(key);
      const m = r.mape ?? 0;
      panelMape.set(key, prior === undefined ? m : Math.min(prior, m));
    }
  }

  const inventoryByPanel = new Map(
    inventory.map((r) => [`${r.sku_id}__${r.segment}`, r] as const),
  );

  const rows = forecasts.map((f) => {
    const inv = inventoryByPanel.get(`${f.sku_id}__${f.segment}`);
    const lastForecasts = f.points.filter((p) => p.forecast !== null);
    const avgForecast =
      lastForecasts.reduce((s, p) => s + (p.forecast ?? 0), 0) / Math.max(1, lastForecasts.length);
    const productName = meta.catalog.find((c) => c.sku_id === f.sku_id)?.name ?? f.sku_id;
    return {
      sku_id: f.sku_id,
      segment: f.segment,
      productName,
      mape: panelMape.get(`${f.sku_id}__${f.segment}`) ?? null,
      avgForecast,
      risk: inv?.stockout_risk ?? "low",
    };
  });

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight mb-2">Forecasts</h1>
      <p className="text-zinc-400 mb-8">
        14-day horizon per (SKU × customer segment). Best-performing model selected from a
        walk-forward backtest.
      </p>

      <Section title="All panels" description="Click into any SKU/segment for the chart.">
        <div className="grid md:grid-cols-2 gap-3">
          {rows
            .sort((a, b) => b.avgForecast - a.avgForecast)
            .map((row) => (
              <Link
                key={`${row.sku_id}-${row.segment}`}
                href={`/forecasts/${encodeURIComponent(row.sku_id)}/${row.segment}`}
                className="rounded-xl border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900/40 transition-colors p-4 flex items-center justify-between"
              >
                <div>
                  <div className="font-mono text-xs text-zinc-400">{row.sku_id}</div>
                  <div className="font-medium mt-0.5">{row.productName}</div>
                  <div className="text-xs text-zinc-500 mt-1 capitalize">{row.segment.replace("_", " ")}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-zinc-400">Avg daily forecast</div>
                  <div className="text-lg tabular-nums">{row.avgForecast.toFixed(0)}</div>
                  <div className="text-xs text-zinc-500 mt-1">
                    Best MAPE {row.mape === null ? "—" : fmtPct(row.mape)}
                  </div>
                </div>
              </Link>
            ))}
        </div>
      </Section>
    </div>
  );
}
