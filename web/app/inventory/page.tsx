import Link from "next/link";

import { RiskBadge } from "@/components/RiskBadge";
import { loadInventory, loadMeta } from "@/lib/data";
import { fmtNumber } from "@/lib/format";

export const dynamic = "force-static";

export default async function InventoryPage() {
  const [inventory, meta] = await Promise.all([loadInventory(), loadMeta()]);
  const byName = new Map(meta.catalog.map((c) => [c.sku_id, c.name]));

  const sorted = inventory.slice().sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 } as const;
    const r = order[a.stockout_risk] - order[b.stockout_risk];
    if (r !== 0) return r;
    return a.days_of_cover - b.days_of_cover;
  });

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight mb-2">Inventory</h1>
      <p className="text-zinc-400 mb-8">
        Days of cover = on-hand units ÷ average daily forecast over the 14-day horizon. Risk is
        compared against the SKU&apos;s replenishment lead time.
      </p>

      <div className="rounded-xl border border-zinc-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900/60 text-xs uppercase tracking-wider text-zinc-400">
            <tr>
              <th className="text-left p-3">SKU</th>
              <th className="text-left p-3">Product</th>
              <th className="text-left p-3">Segment</th>
              <th className="text-right p-3">On hand</th>
              <th className="text-right p-3">Avg / day</th>
              <th className="text-right p-3">DOC</th>
              <th className="text-right p-3">Stockout days</th>
              <th className="text-right p-3">Lead time</th>
              <th className="text-right p-3">Risk</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={`${row.sku_id}-${row.segment}`} className="border-t border-zinc-800/80">
                <td className="p-3 font-mono text-xs">
                  <Link
                    href={`/forecasts/${encodeURIComponent(row.sku_id)}/${row.segment}`}
                    className="text-emerald-400 hover:text-emerald-300"
                  >
                    {row.sku_id}
                  </Link>
                </td>
                <td className="p-3 text-zinc-300">{byName.get(row.sku_id) ?? "—"}</td>
                <td className="p-3 text-zinc-400 capitalize">{row.segment.replace("_", " ")}</td>
                <td className="p-3 text-right tabular-nums">{fmtNumber(row.units_on_hand)}</td>
                <td className="p-3 text-right tabular-nums">{row.avg_daily_forecast.toFixed(1)}</td>
                <td className="p-3 text-right tabular-nums">{row.days_of_cover.toFixed(1)}</td>
                <td className="p-3 text-right tabular-nums">{row.projected_stockout_days.toFixed(1)}</td>
                <td className="p-3 text-right tabular-nums">{row.lead_time_days}d</td>
                <td className="p-3 text-right">
                  <RiskBadge level={row.stockout_risk} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
