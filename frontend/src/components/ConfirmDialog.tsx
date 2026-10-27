"use client";
import { useEffect, useRef } from "react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Accessible modal confirmation.
 *
 * Deliberately requires an explicit click on "Löschen" — pressing Escape, the
 * backdrop, or "Abbrechen" all cancel, so a destructive action can never happen
 * by accident or by an Enter keypress that was meant for something else.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Bestätigen",
  cancelLabel = "Abbrechen",
  busy = false,
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // Focus the safe option, so a stray Enter cancels instead of deleting.
    cancelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
      >
        <h2 className="modal__title" id="confirm-title">
          {title}
        </h2>
        <div className="modal__body" id="confirm-message">
          {message}
        </div>
        <div className="modal__actions">
          <button
            ref={cancelRef}
            type="button"
            className="btn btn--ghost"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${danger ? "btn--danger" : "btn--primary"}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Lösche …" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
