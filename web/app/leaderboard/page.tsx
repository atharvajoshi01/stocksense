import Link from "next/link";

import { loadLeaderboard, loadWinners } from "@/lib/data";
import { fmtPct } from "@/lib/format";

export const dynamic = "force-static";

export default async function LeaderboardPage() {
  const [leaderboard, winners] = await Promise.all([loadLeaderboard(), loadWinners()]);

  const winnerCounts = winners.reduce<Record<string, number>>((acc, w) => {
    acc[w.winner] = (acc[w.winner] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight mb-2">Models</h1>
      <p className="text-zinc-400 mb-8">
        Walk-forward backtest results (3 folds, 14-day forecast horizon). Lower MAPE is better;
        bias near zero is better.
      </p>

      <div className="grid md:grid-cols-2 gap-4 mb-10">
        {leaderboard.map((lb) => (
          <div key={lb.forecaster} className="rounded-xl border border-zinc-800 p-5">
            <div className="text-sm uppercase tracking-wider text-zinc-400">{lb.forecaster}</div>
            <div className="mt-2 grid grid-cols-3 gap-3 text-sm">
              <Stat label="Overall MAPE" value={fmtPct(lb.overall.mape)} />
              <Stat label="RMSE" value={lb.overall.rmse.toFixed(1)} />
              <Stat label="Bias" value={lb.overall.bias.toFixed(2)} />
            </div>
            <div className="mt-3 text-xs text-zinc-500">
              Selected for {winnerCounts[lb.forecaster] ?? 0} / {winners.length} panels
            </div>
          </div>
        ))}
      </div>

      <h2 className="text-xl font-semibold mb-4">Per-panel MAPE</h2>
      <div className="rounded-xl border border-zinc-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900/60 text-xs uppercase tracking-wider text-zinc-400">
            <tr>
              <th className="text-left p-3">SKU</th>
              <th className="text-left p-3">Segment</th>
              {leaderboard.map((lb) => (
                <th key={lb.forecaster} className="text-right p-3">
                  {lb.forecaster}
                </th>
              ))}
              <th className="text-left p-3">Winner</th>
            </tr>
          </thead>
          <tbody>
            {winners.map((w) => (
              <tr key={`${w.sku_id}-${w.segment}`} className="border-t border-zinc-800/80">
                <td className="p-3 font-mono text-xs">
                  <Link
                    href={`/forecasts/${encodeURIComponent(w.sku_id)}/${w.segment}`}
                    className="text-emerald-400 hover:text-emerald-300"
                  >
                    {w.sku_id}
                  </Link>
                </td>
                <td className="p-3 text-zinc-400 capitalize">{w.segment.replace("_", " ")}</td>
                {leaderboard.map((lb) => {
                  const row = lb.per_sku.find(
                    (r) => r.sku_id === w.sku_id && r.segment === w.segment,
                  );
                  return (
                    <td key={lb.forecaster} className="p-3 text-right tabular-nums">
                      {row?.mape !== null && row?.mape !== undefined ? fmtPct(row.mape) : "—"}
                    </td>
                  );
                })}
                <td className="p-3 text-emerald-400 text-xs uppercase tracking-wider">
                  {w.winner}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="tabular-nums text-lg">{value}</div>
    </div>
  );
}
