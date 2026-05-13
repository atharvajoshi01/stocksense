export function fmtCurrency(value: number, opts: { compact?: boolean } = {}): string {
  const compact = opts.compact ?? Math.abs(value) >= 10_000;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 0,
  }).format(value);
}

export function fmtNumber(value: number, opts: { compact?: boolean; digits?: number } = {}): string {
  const compact = opts.compact ?? Math.abs(value) >= 10_000;
  return new Intl.NumberFormat("en-US", {
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: opts.digits ?? (compact ? 1 : 0),
  }).format(value);
}

export function fmtPct(value: number | null, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
