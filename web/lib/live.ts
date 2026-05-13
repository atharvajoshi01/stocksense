/**
 * Server-side helpers for live data.
 * Centralizes the Supabase-or-fallback decision so every route reads the same.
 */
import { getServerClient, isSupabaseConfigured, type InventoryRow, type OrderRow } from "./supabase";

export type LiveStatus = {
  configured: boolean;
  source: "supabase" | "snapshot";
};

export function liveStatus(): LiveStatus {
  return {
    configured: isSupabaseConfigured(),
    source: isSupabaseConfigured() ? "supabase" : "snapshot",
  };
}

export async function fetchOrders(opts: {
  sku?: string;
  segment?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
} = {}): Promise<OrderRow[]> {
  const client = getServerClient();
  if (!client) return [];
  let q = client.from("orders").select("*").order("order_date", { ascending: true });
  if (opts.sku) q = q.eq("sku", opts.sku);
  if (opts.segment) q = q.eq("segment", opts.segment);
  if (opts.fromDate) q = q.gte("order_date", opts.fromDate);
  if (opts.toDate) q = q.lte("order_date", opts.toDate);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as OrderRow[];
}

export async function fetchInventory(): Promise<InventoryRow[]> {
  const client = getServerClient();
  if (!client) return [];
  const { data, error } = await client.from("inventory").select("*").order("sku");
  if (error) throw new Error(error.message);
  return (data ?? []) as InventoryRow[];
}

export function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function aggregateDaily(
  rows: OrderRow[],
): { date: string; quantity: number; revenue: number }[] {
  const map = new Map<string, { quantity: number; revenue: number }>();
  for (const r of rows) {
    const prev = map.get(r.order_date) ?? { quantity: 0, revenue: 0 };
    prev.quantity += Number(r.quantity);
    prev.revenue += Number(r.quantity) * Number(r.unit_price);
    map.set(r.order_date, prev);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, ...v }));
}
