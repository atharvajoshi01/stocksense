"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { getBrowserClient } from "@/lib/supabase";

type Status = "connecting" | "live" | "offline" | "disabled";

export function LiveIndicator() {
  const [status, setStatus] = useState<Status>("connecting");

  useEffect(() => {
    const client = getBrowserClient();
    if (!client) {
      setStatus("disabled");
      return;
    }
    const channel = client
      .channel("stocksense-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders" }, (payload) => {
        const row = payload.new as { sku: string; segment: string; quantity: number };
        toast.success("New order", {
          description: `${row.sku} · ${row.segment.replace("_", " ")} · ${row.quantity} units`,
        });
      })
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "anomalies" },
        (payload) => {
          const row = payload.new as {
            sku: string;
            segment: string;
            anomaly_type: string;
            severity: number;
          };
          toast.warning(`Anomaly: ${row.anomaly_type}`, {
            description: `${row.sku} · ${row.segment.replace("_", " ")} · z=${Number(
              row.severity,
            ).toFixed(2)}`,
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inventory" },
        () => {
          /* inventory pages re-fetch on their own; no toast needed */
        },
      )
      .subscribe((s) => {
        if (s === "SUBSCRIBED") setStatus("live");
        else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") setStatus("offline");
      });

    return () => {
      client.removeChannel(channel);
    };
  }, []);

  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs"
      title={`Realtime: ${status}`}
    >
      <span
        className={
          "inline-block w-2 h-2 rounded-full " +
          (status === "live"
            ? "bg-emerald-400 animate-pulse"
            : status === "connecting"
              ? "bg-amber-400 animate-pulse"
              : status === "disabled"
                ? "bg-zinc-600"
                : "bg-rose-500")
        }
      />
      <span className="text-zinc-400">{status}</span>
    </span>
  );
}
