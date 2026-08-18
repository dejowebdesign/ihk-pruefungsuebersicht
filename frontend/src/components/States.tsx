export function EmptyState({
  title = "Keine IHKs gefunden",
  text = "Versuche andere Filter oder Suchbegriffe.",
  onReset,
  resetLabel = "Filter zurücksetzen",
}: {
  title?: string;
  text?: string;
  onReset?: () => void;
  resetLabel?: string;
}) {
  return (
    <div className="state" role="status">
      <div className="state__icon" aria-hidden="true">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" strokeLinecap="round" />
        </svg>
      </div>
      <p className="state__title">{title}</p>
      <p className="state__text">{text}</p>
      {onReset && (
        <button className="btn" onClick={onReset}>
          {resetLabel}
        </button>
      )}
    </div>
  );
}

export function ErrorState({
  message = "Die Daten konnten momentan nicht geladen werden.",
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="state" role="alert">
      <div className="state__icon" aria-hidden="true">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M12 9v4M12 17h.01M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.42 0z" strokeLinejoin="round" />
        </svg>
      </div>
      <p className="state__title">Etwas ist schiefgelaufen</p>
      <p className="state__text">{message}</p>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          Erneut versuchen
        </button>
      )}
    </div>
  );
}
