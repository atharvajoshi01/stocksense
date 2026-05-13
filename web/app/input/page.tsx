import { CsvUpload } from "@/components/forms/CsvUpload";
import { InventoryForm } from "@/components/forms/InventoryForm";
import { OrderForm } from "@/components/forms/OrderForm";
import { Section } from "@/components/Section";
import { getServerClient, isSupabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function InputPage() {
  const configured = isSupabaseConfigured();
  const client = getServerClient();

  let skus: Array<{ sku_id: string; name: string; lead_time_days: number }> = [];
  if (client) {
    const { data } = await client.from("skus").select("sku_id,name,lead_time_days").order("sku_id");
    skus = data ?? [];
  }

  if (!configured) {
    return (
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-4">Input</h1>
        <div className="rounded-xl border border-amber-700/40 bg-amber-500/5 p-6 text-sm text-amber-200/80">
          Supabase isn&apos;t configured on this deployment. Live order entry, inventory updates, and
          CSV upload are disabled. Set <code className="text-amber-100">NEXT_PUBLIC_SUPABASE_URL</code>,{" "}
          <code className="text-amber-100">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, and{" "}
          <code className="text-amber-100">SUPABASE_SERVICE_ROLE_KEY</code> to enable.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Input</h1>
        <p className="text-zinc-400 mt-1">
          Record orders, update inventory, or bulk-upload a CSV. Every write hits Supabase and
          shows up live on the Overview page within a second.
        </p>
      </div>

      <div className="grid lg:grid-cols-2 gap-8">
        <Section title="New order" description="Single-order entry. Anomaly check runs automatically.">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-5">
            <OrderForm skus={skus} />
          </div>
        </Section>

        <Section title="Inventory update" description="Upsert on (sku, segment). Reorder alert fires when on_hand drops below reorder_point.">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-5">
            <InventoryForm skus={skus} />
          </div>
        </Section>
      </div>

      <Section
        title="Bulk CSV upload"
        description="For backfills or batched imports. Validates client-side before sending."
      >
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-5">
          <CsvUpload />
        </div>
      </Section>
    </div>
  );
}
