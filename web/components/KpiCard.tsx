import { ReactNode } from "react";

type Variant = "default" | "good" | "warning" | "bad";

const VARIANTS: Record<Variant, string> = {
  default: "border-zinc-800",
  good: "border-emerald-700/60",
  warning: "border-amber-700/60",
  bad: "border-rose-700/60",
};

export function KpiCard({
  label,
  value,
  hint,
  variant = "default",
  children,
}: {
  label: string;
  value: string;
  hint?: string;
  variant?: Variant;
  children?: ReactNode;
}) {
  return (
    <div className={`rounded-xl border ${VARIANTS[variant]} bg-zinc-900/40 p-5`}>
      <div className="text-xs uppercase tracking-wider text-zinc-400">{label}</div>
      <div className="mt-2 text-3xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-sm text-zinc-400">{hint}</div>}
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}
