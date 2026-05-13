"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Sku = { sku_id: string; name: string; lead_time_days: number };

export function InventoryForm({ skus }: { skus: Sku[] }) {
  const [sku, setSku] = useState(skus[0]?.sku_id ?? "");
  const [segment, setSegment] = useState<"food_service" | "healthcare">("food_service");
  const [onHand, setOnHand] = useState("1000");
  const [leadTime, setLeadTime] = useState(String(skus[0]?.lead_time_days ?? 14));
  const [reorderPoint, setReorderPoint] = useState("500");
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/inventory/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku,
          segment,
          on_hand: Number(onHand),
          lead_time_days: Number(leadTime),
          reorder_point: Number(reorderPoint),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Update failed");
      if (json.reorder_alert) {
        toast.warning("Reorder alert", { description: json.message });
      } else {
        toast.success("Inventory updated", { description: `${sku} · ${segment.replace("_", " ")}` });
      }
    } catch (err: unknown) {
      toast.error("Failed to update inventory", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="inv_sku">SKU</Label>
          <Select
            value={sku}
            onValueChange={(v) => {
              if (v === null) return;
              setSku(v);
              const meta = skus.find((s) => s.sku_id === v);
              if (meta) setLeadTime(String(meta.lead_time_days));
            }}
          >
            <SelectTrigger id="inv_sku" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {skus.map((s) => (
                <SelectItem key={s.sku_id} value={s.sku_id}>
                  <span className="font-mono text-xs mr-2">{s.sku_id}</span>
                  <span className="text-zinc-400">{s.name}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inv_segment">Segment</Label>
          <Select value={segment} onValueChange={(v) => v && setSegment(v as "food_service" | "healthcare")}>
            <SelectTrigger id="inv_segment" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="food_service">food service</SelectItem>
              <SelectItem value="healthcare">healthcare</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="on_hand">On hand</Label>
          <Input
            id="on_hand"
            type="number"
            min="0"
            value={onHand}
            onChange={(e) => setOnHand(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lead_time">Lead time (days)</Label>
          <Input
            id="lead_time"
            type="number"
            min="0"
            value={leadTime}
            onChange={(e) => setLeadTime(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reorder_point">Reorder point</Label>
          <Input
            id="reorder_point"
            type="number"
            min="0"
            value={reorderPoint}
            onChange={(e) => setReorderPoint(e.target.value)}
            required
          />
        </div>
      </div>
      <Button type="submit" disabled={submitting || !sku} className="w-full sm:w-auto">
        {submitting ? "Saving…" : "Save inventory"}
      </Button>
    </form>
  );
}
