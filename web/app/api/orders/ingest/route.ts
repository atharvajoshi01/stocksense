import { NextResponse } from "next/server";

import { getServiceClient, isServiceConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const VALID_SEGMENTS = new Set(["food_service", "healthcare"]);

type IncomingOrder = {
  sku: string;
  segment: string;
  quantity: number;
  unit_price: number;
  order_date: string;
  shipped_date?: string | null;
};

function validateOrder(o: unknown, idx: number): { ok: true; row: IncomingOrder } | { ok: false; error: string } {
  if (typeof o !== "object" || o === null) {
    return { ok: false, error: `row ${idx}: not an object` };
  }
  const row = o as Record<string, unknown>;
  const sku = typeof row.sku === "string" ? row.sku.trim() : "";
  const segment = typeof row.segment === "string" ? row.segment.trim() : "";
  const quantity = typeof row.quantity === "number" ? row.quantity : Number(row.quantity);
  const unit_price = typeof row.unit_price === "number" ? row.unit_price : Number(row.unit_price);
  const order_date = typeof row.order_date === "string" ? row.order_date.trim() : "";
  const shipped_date = typeof row.shipped_date === "string" ? row.shipped_date : null;

  if (!sku) return { ok: false, error: `row ${idx}: missing sku` };
  if (!VALID_SEGMENTS.has(segment))
    return { ok: false, error: `row ${idx}: invalid segment "${segment}"` };
  if (!Number.isFinite(quantity) || quantity < 0)
    return { ok: false, error: `row ${idx}: invalid quantity` };
  if (!Number.isFinite(unit_price) || unit_price < 0)
    return { ok: false, error: `row ${idx}: invalid unit_price` };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(order_date))
    return { ok: false, error: `row ${idx}: order_date must be YYYY-MM-DD` };

  return {
    ok: true,
    row: { sku, segment, quantity, unit_price, order_date, shipped_date },
  };
}

export async function POST(req: Request) {
  if (!isServiceConfigured()) {
    return NextResponse.json(
      { error: "Service role key not configured on the server." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const arr = Array.isArray(body) ? body : Array.isArray((body as { orders?: unknown }).orders) ? (body as { orders: unknown[] }).orders : null;
  if (!arr) {
    return NextResponse.json({ error: "Expected an array of orders" }, { status: 400 });
  }

  const valid: IncomingOrder[] = [];
  const errors: string[] = [];
  arr.forEach((o, i) => {
    const r = validateOrder(o, i);
    if (r.ok) valid.push(r.row);
    else errors.push(r.error);
  });

  if (!valid.length) {
    return NextResponse.json({ inserted: 0, errors }, { status: 400 });
  }

  const client = getServiceClient()!;
  const { error, data } = await client.from("orders").insert(valid).select("id");
  if (error) {
    return NextResponse.json({ inserted: 0, errors: [error.message, ...errors] }, { status: 500 });
  }
  return NextResponse.json({ inserted: data?.length ?? 0, errors });
}
