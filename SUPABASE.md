# Supabase setup for StockSense

A 10-minute, free-tier-only setup. Once complete, the dashboard switches from
the static JSON snapshot to live data with realtime subscriptions.

## 1. Create the project

1. Go to <https://supabase.com> and sign in.
2. **New project** → name `stocksense`, pick the closest region, set a strong
   database password. Wait ~60s for provisioning.

## 2. Run the schema

1. Open **SQL Editor** (left sidebar).
2. Paste the entire contents of [`supabase/schema.sql`](./supabase/schema.sql).
3. Click **Run**. It will:
   - drop existing StockSense tables (safe to re-run),
   - create `skus`, `orders`, `inventory`, `forecasts`, `anomalies`,
   - add indexes, a `last_updated` trigger, and an anomaly-detection trigger
     that fires on order insert,
   - enable Row Level Security with anon-read / service-role-write,
   - create the `stocksense_realtime` publication,
   - insert the 12-SKU catalog.

## 3. Grab the keys

1. Project **Settings** → **API**.
2. Copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role (secret)** → `SUPABASE_SERVICE_ROLE_KEY`

> **service_role bypasses RLS.** Treat it like a password. Never paste it into
> the browser and never commit it to git. We only use it in API routes and the
> seed script.

## 4. Local dev

```bash
cd web
cp .env.example .env.local      # then paste your three keys
npm install
npm run dev
```

Open <http://localhost:3000>. Without seeded data the **Live** badge will
flip on but pages will appear empty (Supabase returns zero rows). Seed next.

## 5. Seed data

```bash
cd web
npx tsx scripts/seed.ts
```

This inserts ~13,000 daily orders across 12 SKUs × 2 segments over 18 months
with the same seasonality, promo windows, and supply-shock event as the
original synthetic generator, plus a fresh inventory snapshot.

## 6. Deploy to Vercel

1. Vercel project → **Settings** → **Environment Variables**.
2. Add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
   `SUPABASE_SERVICE_ROLE_KEY` for **Production** (and Preview if you want).
3. **Deployments** → top deployment → **Redeploy**.

## 7. Verify

- Overview page should show `Live` badge in the nav and the "Last refreshed Xs
  ago" indicator should tick up.
- Go to **Input** → submit a new order. A toast should fire on every page
  thanks to the realtime channel; the order should appear in the **Anomalies**
  table within seconds if it's outside the ±2.5σ band of the prior 14 days.
- Inventory page should reflect any update you make on the Input page.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Live` badge stays grey (`disabled`) | `NEXT_PUBLIC_SUPABASE_*` not set on the deployed build. Redeploy after adding env vars. |
| Insert returns "Service role key not configured" | `SUPABASE_SERVICE_ROLE_KEY` missing on the server. |
| Realtime never connects | Verify the `stocksense_realtime` publication exists: `select * from pg_publication;` |
| RLS denies a read | The schema creates `for select using (true)` policies. If you altered them, restore from `supabase/schema.sql`. |
