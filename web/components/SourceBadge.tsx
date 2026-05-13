export function SourceBadge({ source }: { source: "supabase" | "snapshot" }) {
  if (source === "supabase") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 uppercase tracking-wider">
        Live
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-md bg-zinc-700/40 text-zinc-300 border border-zinc-600/40 uppercase tracking-wider">
      Snapshot
    </span>
  );
}
