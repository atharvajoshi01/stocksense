-- StockSense schema
-- Paste this into Supabase SQL Editor (one shot) on a fresh project.
-- Safe to re-run: drops in dependency order before creating.

-- ---------- clean slate ----------
drop publication if exists stocksense_realtime;
drop trigger if exists trg_orders_anomaly on public.orders;
drop function if exists public.detect_order_anomaly() cascade;
drop function if exists public.set_updated_at() cascade;
drop table if exists public.anomalies cascade;
drop table if exists public.forecasts cascade;
drop table if exists public.inventory cascade;
drop table if exists public.orders cascade;
drop table if exists public.skus cascade;

-- ---------- reference table ----------
create table public.skus (
  sku_id text primary key,
  name text not null,
  product_family text not null,
  primary_segment text not null check (primary_segment in ('food_service','healthcare')),
  unit_cost numeric(10,2) not null,
  case_pack integer not null,
  lead_time_days integer not null default 14,
  demand_scale numeric(6,3) not null default 1.0,
  created_at timestamptz not null default now()
);

-- ---------- transactional tables ----------
create table public.orders (
  id bigserial primary key,
  sku text not null references public.skus(sku_id) on update cascade,
  segment text not null check (segment in ('food_service','healthcare')),
  quantity numeric(12,2) not null check (quantity >= 0),
  unit_price numeric(10,2) not null check (unit_price >= 0),
  order_date date not null,
  shipped_date date,
  created_at timestamptz not null default now()
);

create index orders_sku_segment_date_idx
  on public.orders (sku, segment, order_date desc);
create index orders_order_date_idx on public.orders (order_date desc);

create table public.inventory (
  id bigserial primary key,
  sku text not null references public.skus(sku_id) on update cascade,
  segment text not null check (segment in ('food_service','healthcare')),
  on_hand numeric(12,2) not null check (on_hand >= 0),
  lead_time_days integer not null check (lead_time_days >= 0),
  reorder_point numeric(12,2) not null default 0,
  last_updated timestamptz not null default now(),
  unique (sku, segment)
);

create table public.forecasts (
  id bigserial primary key,
  sku text not null references public.skus(sku_id) on update cascade,
  segment text not null check (segment in ('food_service','healthcare')),
  forecast_date date not null,
  predicted_qty numeric(12,2) not null,
  lower_ci numeric(12,2),
  upper_ci numeric(12,2),
  model_name text not null,
  created_at timestamptz not null default now()
);
create index forecasts_panel_date_idx
  on public.forecasts (sku, segment, forecast_date);

create table public.anomalies (
  id bigserial primary key,
  sku text not null references public.skus(sku_id) on update cascade,
  segment text not null check (segment in ('food_service','healthcare')),
  detected_at timestamptz not null default now(),
  order_date date not null,
  anomaly_type text not null check (anomaly_type in ('surge','shortfall')),
  severity numeric(6,3) not null,
  description text
);
create index anomalies_recent_idx on public.anomalies (detected_at desc);

-- ---------- updated_at trigger ----------
create function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.last_updated := now();
  return new;
end;
$$;

create trigger trg_inventory_updated_at
  before update on public.inventory
  for each row execute function public.set_updated_at();

-- ---------- anomaly trigger on order insert ----------
create function public.detect_order_anomaly() returns trigger
language plpgsql as $$
declare
  m numeric;
  s numeric;
  z numeric;
begin
  select avg(quantity), stddev_samp(quantity)
    into m, s
  from public.orders
  where sku = new.sku
    and segment = new.segment
    and order_date >= (new.order_date - interval '14 days')
    and order_date <  new.order_date;

  if s is null or s = 0 then
    return new;
  end if;

  z := (new.quantity - m) / s;

  if z >= 2.5 then
    insert into public.anomalies(sku, segment, order_date, anomaly_type, severity, description)
    values (new.sku, new.segment, new.order_date, 'surge', z,
            format('Order quantity %s vs rolling-14d mean %s (σ=%s)',
                   round(new.quantity,1), round(m,1), round(s,1)));
  elsif z <= -2.5 then
    insert into public.anomalies(sku, segment, order_date, anomaly_type, severity, description)
    values (new.sku, new.segment, new.order_date, 'shortfall', z,
            format('Order quantity %s vs rolling-14d mean %s (σ=%s)',
                   round(new.quantity,1), round(m,1), round(s,1)));
  end if;

  return new;
end;
$$;

create trigger trg_orders_anomaly
  after insert on public.orders
  for each row execute function public.detect_order_anomaly();

-- ---------- RLS: read-only for anon, full access for service_role ----------
alter table public.skus       enable row level security;
alter table public.orders     enable row level security;
alter table public.inventory  enable row level security;
alter table public.forecasts  enable row level security;
alter table public.anomalies  enable row level security;

create policy "anon read skus"       on public.skus       for select using (true);
create policy "anon read orders"     on public.orders     for select using (true);
create policy "anon read inventory"  on public.inventory  for select using (true);
create policy "anon read forecasts"  on public.forecasts  for select using (true);
create policy "anon read anomalies"  on public.anomalies  for select using (true);

-- service_role bypasses RLS automatically — no policy needed.

-- ---------- realtime ----------
create publication stocksense_realtime
  for table public.orders, public.inventory, public.anomalies;

-- ---------- catalog seed (12 SKUs from original synthetic generator) ----------
insert into public.skus values
  ('GLV-NIT-M',  'Nitrile Glove M (case 1000)',     'gloves',     'healthcare',   32.50, 1000,  7, 1.4, now()),
  ('GLV-NIT-L',  'Nitrile Glove L (case 1000)',     'gloves',     'healthcare',   32.50, 1000,  7, 1.2, now()),
  ('GLV-VIN-M',  'Vinyl Glove M (case 1000)',       'gloves',     'food_service', 21.00, 1000, 10, 1.6, now()),
  ('GLV-POL-L',  'Poly Glove L (case 10000)',       'gloves',     'food_service',  8.40,10000, 14, 1.0, now()),
  ('WRP-FOIL-18','Foil Roll 18in x 500ft',          'wraps',      'food_service', 18.20,    6, 14, 0.9, now()),
  ('WRP-PLAS-12','Plastic Wrap 12in x 2000ft',      'wraps',      'food_service', 12.95,    6, 14, 0.8, now()),
  ('CTR-8OZ',    '8oz Soup Container',              'containers', 'food_service', 28.00,  500, 14, 1.1, now()),
  ('CTR-32OZ',   '32oz Bowl with Lid',              'containers', 'food_service', 64.00,  250, 14, 0.7, now()),
  ('CUT-FRK',    'Fork (case 1000)',                'cutlery',    'food_service', 14.50, 1000, 21, 1.3, now()),
  ('CUT-KIT',    'Cutlery Kit (case 250)',          'cutlery',    'food_service', 32.75,  250, 21, 0.6, now()),
  ('PRT-2OZ',    '2oz Portion Cup (case 2500)',     'portion',    'food_service', 22.00, 2500, 14, 1.0, now()),
  ('MED-GAU-4',  'Gauze Pad 4x4 (case 200)',        'medical',    'healthcare',   18.50,  200, 10, 0.5, now())
on conflict (sku_id) do nothing;
