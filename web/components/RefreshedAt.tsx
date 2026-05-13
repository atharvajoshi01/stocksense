"use client";

import { useEffect, useState } from "react";

export function RefreshedAt({ iso }: { iso: string }) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => {
      setSeconds(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [iso]);

  return (
    <span className="text-xs text-zinc-500" suppressHydrationWarning>
      Last refreshed {seconds}s ago
    </span>
  );
}
