const STYLES = {
  high: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  medium: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  low: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
} as const;

export function RiskBadge({ level }: { level: "low" | "medium" | "high" }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-xs uppercase tracking-wider ${STYLES[level]}`}
    >
      {level}
    </span>
  );
}
