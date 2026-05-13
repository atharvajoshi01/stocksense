import { loadDataQuality, loadMeta } from "@/lib/data";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-static";

export default async function DataQualityPage() {
  const [dq, meta] = await Promise.all([loadDataQuality(), loadMeta()]);

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight mb-2">Data Quality</h1>
      <p className="text-zinc-400 mb-8">
        Validators run on every pipeline pass. Failure of any check blocks the dashboard from
        publishing stale or malformed numbers.
      </p>

      <div className="rounded-xl border border-zinc-800 p-6 mb-8">
        <div className="flex items-baseline gap-3">
          <div
            className={`text-3xl font-semibold ${dq.passed ? "text-emerald-300" : "text-rose-300"}`}
          >
            {dq.passed ? "PASS" : "FAIL"}
          </div>
          <div className="text-zinc-400">
            {dq.n_findings - dq.n_failed} / {dq.n_findings} checks passed
          </div>
        </div>
        <div className="mt-2 text-sm text-zinc-500">
          Last run on the panel ending {fmtDate(meta.end_date)}.
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900/60 text-xs uppercase tracking-wider text-zinc-400">
            <tr>
              <th className="text-left p-3">Check</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">Detail</th>
              <th className="text-right p-3">Offending rows</th>
            </tr>
          </thead>
          <tbody>
            {dq.findings.map((f) => (
              <tr key={f.name} className="border-t border-zinc-800/80">
                <td className="p-3 font-mono text-xs">{f.name}</td>
                <td
                  className={`p-3 text-xs uppercase tracking-wider ${
                    f.passed ? "text-emerald-300" : "text-rose-300"
                  }`}
                >
                  {f.passed ? "pass" : "fail"}
                </td>
                <td className="p-3 text-zinc-300">{f.detail}</td>
                <td className="p-3 text-right tabular-nums text-zinc-400">{f.offending_rows}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
