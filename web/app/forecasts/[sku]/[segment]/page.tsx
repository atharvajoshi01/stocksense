import Link from "next/link";
import { notFound } from "next/navigation";

import { ForecastChart } from "@/components/ForecastChart";
import { Section } from "@/components/Section";
import { RiskBadge } from "@/components/RiskBadge";
import { SourceBadge } from "@/components/SourceBadge";
import {
  loadForecast,
  loadInventory,
  loadLeaderboard,
  loadMeta,
  loadWinners,
} from "@/lib/loaders";
import { fmtNumber, fmtPct } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ForecastDetail({
  params,
}: {
  params: Promise<{ sku: string; segment: string }>;
}) {
  const { sku, segment } = await params;
  const decodedSku = decodeURIComponent(sku);
  const [{ panel: series, source }, meta, leaderboard, { rows: inventory }, winners] = await Promise.all([
    loadForecast(decodedSku, segment),
    loadMeta(),
    loadLeaderboard(),
    loadInventory(),
    loadWinners(),
  ]);

  if (!series) {
    notFound();
  }

  const skuMeta = meta.catalog.find((c) => c.sku_id === decodedSku);
  const inv = inventory.find((r) => r.sku_id === decodedSku && r.segment === segment);
  const winner = winners.find((w) => w.sku_id === decodedSku && w.segment === segment)?.winner;

  const perModelMape = leaderboard.map((lb) => {
    const row = lb.per_sku.find((r) => r.sku_id === decodedSku && r.segment === segment);
    return { name: lb.forecaster, mape: row?.mape ?? null, rmse: row?.rmse ?? null };
  });

  return (
    <div>
      <div className="mb-2 text-sm flex items-center justify-between">
        <Link href="/forecasts" className="text-zinc-400 hover:text-zinc-200">
          ← All forecasts
        </Link>
        <SourceBadge source={source} />
      </div>
      <div className="flex items-end justify-between mb-8 gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{skuMeta?.name ?? decodedSku}</h1>
          <div className="text-zinc-400 mt-1 flex items-center gap-3 text-sm">
            <span className="font-mono">{decodedSku}</span>
            <span>·</span>
            <span className="capitalize">{segment.replace("_", " ")}</span>
            {skuMeta && (
              <>
                <span>·</span>
                <span>{skuMeta.product_family}</span>
                <span>·</span>
                <span>lead time {skuMeta.lead_time_days}d</span>
              </>
            )}
          </div>
        </div>
        {inv && (
          <div className="flex items-center gap-3 text-sm text-zinc-300">
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider text-zinc-400">Days of cover</div>
              <div className="tabular-nums text-lg">
                {Number.isFinite(inv.days_of_cover) ? inv.days_of_cover.toFixed(1) : "∞"}
              </div>
            </div>
            <RiskBadge level={inv.stockout_risk} />
          </div>
        )}
      </div>

      <Section
        title="Forecast vs actuals"
        description="Recent ~90 days of orders and the next 14-day forecast with a 95% confidence band."
      >
        <div className="rounded-xl border border-zinc-800 p-4 bg-zinc-900/30">
          <ForecastChart data={series.points} />
        </div>
      </Section>

      <div className="grid md:grid-cols-2 gap-8 mb-8">
        <Section title="Model selection">
          <div className="rounded-xl border border-zinc-800 p-5">
            <div className="text-sm text-zinc-400">
              Best forecaster (from offline backtest):
            </div>
            <div className="mt-2 text-xl font-semibold">{winner ?? "ensemble (live)"}</div>
            <div className="mt-4 text-sm text-zinc-300 space-y-2">
              {perModelMape.map((m) => (
                <div key={m.name} className="flex justify-between border-t border-zinc-800/60 pt-2">
                  <span className="text-zinc-400">{m.name}</span>
                  <span className="tabular-nums">
                    MAPE {m.mape === null ? "—" : fmtPct(m.mape)}{" "}
                    {m.rmse !== null && (
                      <span className="text-zinc-500">· RMSE {m.rmse.toFixed(1)}</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Section>

        {inv && (
          <Section title="Inventory">
            <div className="rounded-xl border border-zinc-800 p-5">
              <dl className="text-sm divide-y divide-zinc-800/60">
                <Row label="Units on hand" value={fmtNumber(inv.units_on_hand)} />
                <Row label="Avg daily demand" value={inv.avg_daily_forecast.toFixed(1)} />
                <Row
                  label="Days of cover"
                  value={Number.isFinite(inv.days_of_cover) ? inv.days_of_cover.toFixed(1) : "∞"}
                />
                <Row
                  label="Projected stockout days (14d horizon)"
                  value={inv.projected_stockout_days.toFixed(1)}
                />
                <Row label="Lead time" value={`${inv.lead_time_days} days`} />
                <Row
                  label="Risk"
                  value={
                    <span className="inline-flex">
                      <RiskBadge level={inv.stockout_risk} />
                    </span>
                  }
                />
              </dl>
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between py-2 first:pt-0">
      <dt className="text-zinc-400">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
