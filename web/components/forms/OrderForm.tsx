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

type Sku = { sku_id: string; name: string };

export function OrderForm({ skus }: { skus: Sku[] }) {
  const [sku, setSku] = useState<string>(skus[0]?.sku_id ?? "");
  const [segment, setSegment] = useState<"food_service" | "healthcare">("food_service");
  const [quantity, setQuantity] = useState<string>("100");
  const [unitPrice, setUnitPrice] = useState<string>("25.00");
  const [orderDate, setOrderDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/orders/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          {
            sku,
            segment,
            quantity: Number(quantity),
            unit_price: Number(unitPrice),
            order_date: orderDate,
          },
        ]),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? json.errors?.[0] ?? "Insert failed");
      toast.success(`Order recorded`, {
        description: `${sku} · ${segment.replace("_", " ")} · ${quantity} units`,
      });
      setQuantity("100");
    } catch (err: unknown) {
      toast.error("Failed to record order", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="sku">SKU</Label>
          <Select value={sku} onValueChange={(v) => v && setSku(v)}>
            <SelectTrigger id="sku" className="w-full">
              <SelectValue placeholder="Choose SKU" />
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
          <Label htmlFor="segment">Segment</Label>
          <Select value={segment} onValueChange={(v) => v && setSegment(v as "food_service" | "healthcare")}>
            <SelectTrigger id="segment" className="w-full">
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
          <Label htmlFor="quantity">Quantity</Label>
          <Input
            id="quantity"
            type="number"
            min="0"
            step="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="unit_price">Unit price ($)</Label>
          <Input
            id="unit_price"
            type="number"
            min="0"
            step="0.01"
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="order_date">Order date</Label>
          <Input
            id="order_date"
            type="date"
            value={orderDate}
            onChange={(e) => setOrderDate(e.target.value)}
            required
          />
        </div>
      </div>
      <Button type="submit" disabled={submitting || !sku} className="w-full sm:w-auto">
        {submitting ? "Recording…" : "Record order"}
      </Button>
    </form>
  );
}
