import { ReactNode } from "react";

export function Section({
  title,
  description,
  children,
  right,
}: {
  title: string;
  description?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-12">
      <div className="flex items-end justify-between mb-4 gap-4">
        <div>
          <h2 className="text-xl font-semibold">{title}</h2>
          {description && <p className="text-sm text-zinc-400 mt-1">{description}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}
