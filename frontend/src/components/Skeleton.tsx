export function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <div className="skeleton skeleton__line skeleton__line--w60" style={{ height: 18 }} />
      <div className="skeleton skeleton__line skeleton__line--w40" />
      <div style={{ marginTop: 24 }}>
        <div className="skeleton skeleton__line skeleton__line--w80" />
        <div className="skeleton skeleton__line skeleton__line--w40" />
      </div>
    </div>
  );
}

export function SkeletonGrid({ count = 9 }: { count?: number }) {
  return (
    <div className="skeleton-grid" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export function SkeletonLine({ width = "100%" }: { width?: string }) {
  return <div className="skeleton" style={{ height: 12, width, marginBottom: 8 }} />;
}
