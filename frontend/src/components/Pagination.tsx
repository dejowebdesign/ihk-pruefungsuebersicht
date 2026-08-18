export function Pagination({
  page,
  totalPages,
  total,
  limit,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  onPage: (p: number) => void;
}) {
  if (totalPages <= 1) {
    return (
      <p className="toolbar__count" style={{ margin: "24px auto 0", textAlign: "center" }}>
        {total === 0 ? "0 Ergebnisse" : `1–${total} von ${total}`}
      </p>
    );
  }
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  // Compact page list with ellipsis.
  const pages: (number | "...")[] = [];
  const push = (n: number | "...") => pages.push(n);
  push(1);
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);
  if (start > 2) push("...");
  for (let i = start; i <= end; i++) push(i);
  if (end < totalPages - 1) push("...");
  if (totalPages > 1) push(totalPages);

  return (
    <div className="pagination" role="navigation" aria-label="Seiten navigation">
      <button
        className="pagination__btn"
        onClick={() => onPage(page - 1)}
        disabled={page <= 1}
        aria-label="Zurück"
      >
        ←
      </button>
      {pages.map((p, i) =>
        p === "..." ? (
          <span key={`e${i}`} className="pagination__ellipsis">
            …
          </span>
        ) : (
          <button
            key={p}
            className={`pagination__btn${p === page ? " pagination__btn--active" : ""}`}
            onClick={() => onPage(p)}
            aria-label={`Seite ${p}`}
            aria-current={p === page ? "page" : undefined}
          >
            {p}
          </button>
        ),
      )}
      <button
        className="pagination__btn"
        onClick={() => onPage(page + 1)}
        disabled={page >= totalPages}
        aria-label="Weiter"
      >
        →
      </button>
      <span className="toolbar__count" style={{ marginLeft: 12, whiteSpace: "nowrap" }}>
        {from}–{to} von {total}
      </span>
    </div>
  );
}
