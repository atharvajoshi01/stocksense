"use client";

import { useState } from "react";
import Papa from "papaparse";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ParsedOrder = {
  sku: string;
  segment: string;
  quantity: number;
  unit_price: number;
  order_date: string;
};

const REQUIRED_COLS = ["sku", "segment", "quantity", "unit_price", "order_date"];

export function CsvUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ParsedOrder[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  function parse(f: File) {
    setErrors([]);
    setPreview([]);
    Papa.parse<Record<string, string>>(f, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const missing = REQUIRED_COLS.filter((c) => !(results.meta.fields ?? []).includes(c));
        if (missing.length) {
          setErrors([`CSV missing required columns: ${missing.join(", ")}`]);
          return;
        }
        const rows: ParsedOrder[] = [];
        const errs: string[] = [];
        results.data.forEach((row, i) => {
          const sku = (row.sku ?? "").trim();
          const segment = (row.segment ?? "").trim();
          const quantity = Number(row.quantity);
          const unit_price = Number(row.unit_price);
          const order_date = (row.order_date ?? "").trim();
          if (!sku || !segment || !order_date) {
            errs.push(`row ${i + 2}: missing required fields`);
            return;
          }
          if (!Number.isFinite(quantity) || quantity < 0) {
            errs.push(`row ${i + 2}: invalid quantity`);
            return;
          }
          if (!Number.isFinite(unit_price) || unit_price < 0) {
            errs.push(`row ${i + 2}: invalid unit_price`);
            return;
          }
          rows.push({ sku, segment, quantity, unit_price, order_date });
        });
        setPreview(rows);
        setErrors(errs);
      },
    });
  }

  async function submit() {
    if (!preview.length) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/orders/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preview),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? json.errors?.[0] ?? "Ingest failed");
      toast.success(`Inserted ${json.inserted} orders`, {
        description: json.errors?.length ? `${json.errors.length} rows skipped` : undefined,
      });
      setPreview([]);
      setFile(null);
    } catch (err: unknown) {
      toast.error("Bulk insert failed", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="csv">CSV file</Label>
        <Input
          id="csv"
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            if (f) parse(f);
          }}
        />
        <p className="text-xs text-zinc-500">
          Required columns: <code className="text-zinc-300">sku, segment, quantity, unit_price, order_date</code>{" "}
          (date format <code className="text-zinc-300">YYYY-MM-DD</code>).
        </p>
      </div>

      {errors.length > 0 && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 p-3 text-sm">
          <div className="font-medium text-rose-300 mb-1">{errors.length} row error(s)</div>
          <ul className="list-disc list-inside text-xs text-rose-200/80 space-y-0.5 max-h-40 overflow-auto">
            {errors.slice(0, 10).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
            {errors.length > 10 && <li>…and {errors.length - 10} more</li>}
          </ul>
        </div>
      )}

      {preview.length > 0 && (
        <div className="rounded-md border border-zinc-800 p-3">
          <div className="text-sm mb-2">
            <span className="font-medium">{preview.length}</span> rows ready to upload
            {file && <span className="text-zinc-500"> · {file.name}</span>}
          </div>
          <table className="w-full text-xs">
            <thead className="text-zinc-400">
              <tr>
                <th className="text-left p-1">sku</th>
                <th className="text-left p-1">segment</th>
                <th className="text-right p-1">qty</th>
                <th className="text-right p-1">price</th>
                <th className="text-left p-1">date</th>
              </tr>
            </thead>
            <tbody>
              {preview.slice(0, 5).map((r, i) => (
                <tr key={i} className="border-t border-zinc-800/60">
                  <td className="p-1 font-mono">{r.sku}</td>
                  <td className="p-1">{r.segment}</td>
                  <td className="p-1 text-right tabular-nums">{r.quantity}</td>
                  <td className="p-1 text-right tabular-nums">{r.unit_price.toFixed(2)}</td>
                  <td className="p-1">{r.order_date}</td>
                </tr>
              ))}
              {preview.length > 5 && (
                <tr>
                  <td colSpan={5} className="p-1 text-zinc-500">
                    …{preview.length - 5} more rows
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Button onClick={submit} disabled={!preview.length || submitting}>
        {submitting ? "Uploading…" : `Upload ${preview.length || ""} orders`}
      </Button>
    </div>
  );
}
