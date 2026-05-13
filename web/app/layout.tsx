import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "StockSense — demand forecasting & inventory health",
  description:
    "Demand forecasting and inventory health for a disposable-products distributor.",
};

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/forecasts", label: "Forecasts" },
  { href: "/inventory", label: "Inventory" },
  { href: "/anomalies", label: "Anomalies" },
  { href: "/leaderboard", label: "Models" },
  { href: "/data-quality", label: "Data Quality" },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
        <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-6">
            <Link href="/" className="font-semibold tracking-tight text-lg flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />
              StockSense
            </Link>
            <nav className="flex items-center gap-1 text-sm overflow-x-auto">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="px-3 py-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60 transition-colors whitespace-nowrap"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>
        <footer className="border-t border-zinc-800 mt-16">
          <div className="max-w-7xl mx-auto px-6 py-6 text-xs text-zinc-500">
            Synthetic data. Built end-to-end with Python (Pandas, scikit-learn, statsmodels,
            PySpark) and Next.js + Recharts.
          </div>
        </footer>
      </body>
    </html>
  );
}
