import { cn } from "@/lib/utils";

export interface DataTableColumn<T> {
  key: keyof T | string;
  header: string;
  align?: "left" | "right";
  accent?: (row: T) => boolean;
  render?: (row: T) => React.ReactNode;
}

interface DataTableProps<T> {
  rows: T[];
  columns: DataTableColumn<T>[];
  className?: string;
  caption?: string;
}

export function DataTable<T extends Record<string, unknown>>({
  rows,
  columns,
  className,
  caption,
}: DataTableProps<T>) {
  if (!rows.length) {
    return (
      <p className={cn("font-mono text-[10px] uppercase tracked text-foreground/40", className)}>
        — NO DATA RETURNED —
      </p>
    );
  }
  return (
    <table className={cn("w-full border-collapse font-mono text-sm tabular", className)}>
      {caption && (
        <caption className="pb-2 text-left font-mono text-[10px] uppercase tracked text-foreground/55">
          {caption}
        </caption>
      )}
      <thead>
        <tr className="border-b border-foreground/40">
          {columns.map((col) => (
            <th
              key={String(col.key)}
              scope="col"
              className={cn(
                "py-2 text-[10px] font-medium uppercase tracked text-foreground/55",
                col.align === "right" ? "text-right" : "text-left",
                "first:pl-0 last:pr-0",
              )}
            >
              {col.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr
            key={i}
            className="border-b border-foreground/[var(--rule-alpha,0.18)] last:border-b-0"
          >
            {columns.map((col) => {
              const accent = col.accent?.(row);
              const value = col.render ? col.render(row) : (row[col.key as keyof T] as React.ReactNode);
              return (
                <td
                  key={String(col.key)}
                  className={cn(
                    "py-2.5",
                    col.align === "right" ? "text-right" : "text-left",
                    accent ? "text-court" : "text-foreground",
                  )}
                >
                  {value}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
