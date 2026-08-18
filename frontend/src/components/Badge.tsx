import type { ReactNode } from "react";

type Variant = "success" | "neutral" | "warning" | "danger";

export function Badge({
  variant = "neutral",
  children,
}: {
  variant?: Variant;
  children: ReactNode;
}) {
  return <span className={`badge badge--${variant}`}>{children}</span>;
}

/** SKP badge: ✅ -> success, otherwise neutral with the raw value. */
export function SkpBadge({ value }: { value: string | null }) {
  if (!value) return <Badge variant="neutral">Keine Angabe</Badge>;
  if (value.includes("✅")) return <Badge variant="success">{value}</Badge>;
  if (/nein|n\/a|❌/i.test(value)) return <Badge variant="neutral">{value}</Badge>;
  return <Badge variant="warning">{value}</Badge>;
}
