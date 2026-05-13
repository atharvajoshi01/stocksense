import Link from "next/link";

import { SourceBadge } from "@/components/SourceBadge";
import { loadAnomalies, loadMeta } from "@/lib/loaders";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AnomaliesPage() {
  const [{ rows, source }, meta] = await Promise.all([loadAnomalies(), loadMeta()]);
  const byName = new Map(meta.catalog.map((c) => [c.sku_id, c.name]));

  const sorted = rows.slice().sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 200);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-2">
        <h1 className="text-3xl font-bold tracking-tight">Anomalies</h1>
        <SourceBadge source={source} />
      </div>
      <p className="text-zinc-400 mb-8">
        Dates where the order volume residual relative to a 14-day rolling mean exceeds 2.5σ.
        Top 200 events ranked by absolute z-score.
      </p>

      <div className="rounded-xl border border-zinc-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900/60 text-xs uppercase tracking-wider text-zinc-400">
            <tr>
              <th className="text-left p-3">Date</th>
              <th className="text-left p-3">SKU</th>
              <th className="text-left p-3">Product</th>
              <th className="text-left p-3">Segment</th>
              <th className="text-right p-3">Actual</th>
              <th className="text-right p-3">Expected</th>
              <th className="text-right p-3">Residual</th>
              <th className="text-right p-3">z</th>
              <th className="text-right p-3">Direction</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr key={i} className="border-t border-zinc-800/80">
                <td className="p-3 text-zinc-300">{fmtDate(row.order_date)}</td>
                <td className="p-3 font-mono text-xs">
                  <Link
                    href={`/forecasts/${encodeURIComponent(row.sku_id)}/${row.segment}`}
                    className="text-emerald-400 hover:text-emerald-300"
                  >
                    {row.sku_id}
                  </Link>
                </td>
                <td className="p-3 text-zinc-400">{byName.get(row.sku_id) ?? "—"}</td>
                <td className="p-3 text-zinc-400 capitalize">{row.segment.replace("_", " ")}</td>
                <td className="p-3 text-right tabular-nums">{row.units_actual.toFixed(1)}</td>
                <td className="p-3 text-right tabular-nums">{row.units_pred.toFixed(1)}</td>
                <td
                  className={`p-3 text-right tabular-nums ${
                    row.residual > 0 ? "text-emerald-300" : "text-rose-300"
                  }`}
                >
                  {row.residual > 0 ? "+" : ""}
                  {row.residual.toFixed(1)}
                </td>
                <td className="p-3 text-right tabular-nums">{row.z.toFixed(2)}</td>
                <td
                  className={`p-3 text-right text-xs uppercase tracking-wider ${
                    row.direction === "surge" ? "text-emerald-300" : "text-rose-300"
                  }`}
                >
                  {row.direction}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
