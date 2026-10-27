"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiClientError, type Paginated, type OralExam } from "@/lib/api";
import { ErrorState } from "@/components/States";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useIdentity } from "@/lib/use-identity";
import { canManageExams } from "@/lib/auth";

function statusLabel(s: string): string {
  if (s === "completed") return "Abgeschlossen";
  if (s === "in_progress") return "In Prüfung";
  return "Entwurf";
}

export default function OralExamsPage() {
  const router = useRouter();
  const { user } = useIdentity();
  // Both roles run exams; `canManageExams` is the shared presentation mirror of
  // the server-side `requireStaff` guard.
  const canManage = canManageExams(user?.role);

  const [data, setData] = useState<Paginated<OralExam> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [examiner, setExaminer] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Pending deletion, held until the user confirms in the dialog.
  const [pendingDelete, setPendingDelete] = useState<OralExam | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.oralExams(1, 50));
    } catch (e: unknown) {
      setError(e instanceof ApiClientError ? e.message : "Prüfungen konnten nicht geladen werden.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createExam(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError("Bitte einen Prüflingsnamen eingeben.");
      return;
    }
    setCreating(true);
    try {
      const res = await api.oralCreateExam({
        candidateName: trimmed,
        examDate: date || null,
        examiner: examiner.trim() || null,
        status: "in_progress",
      });
      router.push(`/muendliche-pruefung/${res.examId}`);
    } catch (e: unknown) {
      setFormError(
        e instanceof ApiClientError ? e.message : "Prüfung konnte nicht erstellt werden.",
      );
    } finally {
      setCreating(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await api.oralDeleteExam(pendingDelete.id);
      setPendingDelete(null);
      setNotice(
        `Prüfung von ${pendingDelete.candidate.name} wurde gelöscht (${res.deletedItems} Einträge).`,
      );
      // Refresh the overview so the removed row disappears.
      await load();
    } catch (e: unknown) {
      setDeleteError(
        e instanceof ApiClientError ? e.message : "Die Prüfung konnte nicht gelöscht werden.",
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="oral-page">
      <div className="oral-hero">
        <h1>Mündliche Prüfung</h1>
        <p>
          Digitale Durchführung, Bewertung und Auswertung einer mündlichen
          §34a-Sachkundeprüfung.
        </p>
      </div>

      {canManage && (
        <form className="oral-card oral-toolbar" onSubmit={createExam} aria-label="Neue Prüfung erstellen">
          <div className="oral-field">
            <label htmlFor="oral-name">Prüfling (Name) *</label>
            <input id="oral-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Max Mustermann" required />
          </div>
          <div className="oral-field">
            <label htmlFor="oral-date">Prüfungsdatum</label>
            <input id="oral-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="oral-field">
            <label htmlFor="oral-examiner">Prüfer/in</label>
            <input id="oral-examiner" value={examiner} onChange={(e) => setExaminer(e.target.value)} placeholder="optional" />
          </div>
          <button className="btn btn--primary" type="submit" disabled={creating}>
            {creating ? "Erstelle …" : "+ Neue Prüfung"}
          </button>
        </form>
      )}

      {formError && (
        <p className="state" role="alert" style={{ padding: 12 }}>
          {formError}
        </p>
      )}
      {notice && (
        <p className="inline-notice" role="status">
          {notice}
        </p>
      )}
      {deleteError && (
        <p className="state" role="alert" style={{ padding: 12 }}>
          {deleteError}
        </p>
      )}

      <h2 style={{ marginTop: 28, marginBottom: 12 }}>Letzte Prüfungen</h2>

      {loading ? (
        <div className="oral-card">Lade Prüfungen …</div>
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !data || data.data.length === 0 ? (
        <div className="oral-card">
          Noch keine Prüfungen vorhanden. Erstelle die erste Prüfung oben.
        </div>
      ) : (
        <div className="oral-card" style={{ padding: 0 }}>
          <table className="oral-table">
            <thead>
              <tr>
                <th>Prüfling</th>
                <th>Datum</th>
                <th>Ergebnis</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((exam) => (
                <tr key={exam.id}>
                  <td>{exam.candidate.name}</td>
                  <td>{exam.examDate ? new Date(exam.examDate).toLocaleDateString("de-DE") : "—"}</td>
                  <td>
                    {exam.status === "completed" && exam.result ? (
                      <>
                        <strong>{Math.round(exam.percent)} %</strong>{" "}
                        <span className={`oral-status oral-status--${exam.result === "Bestanden" ? "pass" : "fail"}`}>
                          {exam.result}
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <span className={`oral-status oral-status--${exam.status}`}>{statusLabel(exam.status)}</span>
                  </td>
                  <td>
                    <div className="oral-row-actions">
                      <Link className="btn btn--ghost btn--sm" href={`/muendliche-pruefung/${exam.id}`}>
                        {exam.status === "completed" ? "Ansehen" : "Fortsetzen"}
                      </Link>
                      {exam.status === "completed" && (
                        <>
                          <a
                            className="btn btn--ghost btn--sm"
                            href={api.oralExamPdfUrl(exam.id)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            PDF öffnen
                          </a>
                          <a className="btn btn--ghost btn--sm" href={api.oralExamPdfUrl(exam.id, true)}>
                            PDF herunterladen
                          </a>
                        </>
                      )}
                      {canManage && (
                        <button
                          type="button"
                          className="btn btn--danger-ghost btn--sm"
                          onClick={() => {
                            setDeleteError(null);
                            setNotice(null);
                            setPendingDelete(exam);
                          }}
                        >
                          Löschen
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        danger
        busy={deleting}
        title="Prüfung löschen?"
        confirmLabel="Löschen"
        cancelLabel="Abbrechen"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
        message={
          <>
            <p>
              Die Prüfung von <strong>{pendingDelete?.candidate.name}</strong> und alle zugehörigen
              Bewertungen werden endgültig entfernt.
            </p>
            <p className="modal__hint">
              Der Fragenpool bleibt unverändert. Diese Aktion kann nicht rückgängig gemacht werden.
            </p>
          </>
        }
      />
    </div>
  );
}
