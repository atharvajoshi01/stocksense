/**
 * Supabase clients for StockSense.
 *
 * Three flavors:
 *  - `getBrowserClient()` — anon key, used by client components for realtime
 *  - `getServerClient()`  — anon key with no session, used by server-side reads
 *  - `getServiceClient()` — service-role key, used by API routes for writes
 *
 * If env vars aren't set we return null so the rest of the app can fall back to
 * the static JSON snapshot under public/data. That keeps the deploy alive
 * while you wire Supabase up.
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export type Database = unknown; // we type results at the query site

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

let browserClient: SupabaseClient | null | undefined;
let serverClient: SupabaseClient | null | undefined;
let serviceClient: SupabaseClient | null | undefined;

export function isSupabaseConfigured(): boolean {
  return Boolean(url && anon);
}

export function isServiceConfigured(): boolean {
  return Boolean(url && service);
}

export function getBrowserClient(): SupabaseClient | null {
  if (browserClient !== undefined) return browserClient;
  if (!url || !anon) {
    browserClient = null;
    return null;
  }
  browserClient = createClient(url, anon, {
    auth: { persistSession: false },
    realtime: { params: { eventsPerSecond: 5 } },
  });
  return browserClient;
}

export function getServerClient(): SupabaseClient | null {
  if (serverClient !== undefined) return serverClient;
  if (!url || !anon) {
    serverClient = null;
    return null;
  }
  serverClient = createClient(url, anon, {
    auth: { persistSession: false },
  });
  return serverClient;
}

export function getServiceClient(): SupabaseClient | null {
  if (serviceClient !== undefined) return serviceClient;
  if (!url || !service) {
    serviceClient = null;
    return null;
  }
  serviceClient = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return serviceClient;
}

export type SkuRow = {
  sku_id: string;
  name: string;
  product_family: string;
  primary_segment: "food_service" | "healthcare";
  unit_cost: number;
  case_pack: number;
  lead_time_days: number;
  demand_scale: number;
};

export type OrderRow = {
  id: number;
  sku: string;
  segment: "food_service" | "healthcare";
  quantity: number;
  unit_price: number;
  order_date: string;
  shipped_date: string | null;
  created_at: string;
};

export type InventoryRow = {
  id: number;
  sku: string;
  segment: "food_service" | "healthcare";
  on_hand: number;
  lead_time_days: number;
  reorder_point: number;
  last_updated: string;
};

export type ForecastRow = {
  id: number;
  sku: string;
  segment: "food_service" | "healthcare";
  forecast_date: string;
  predicted_qty: number;
  lower_ci: number | null;
  upper_ci: number | null;
  model_name: string;
  created_at: string;
};

export type AnomalyRow = {
  id: number;
  sku: string;
  segment: "food_service" | "healthcare";
  detected_at: string;
  order_date: string;
  anomaly_type: "surge" | "shortfall";
  severity: number;
  description: string | null;
};
