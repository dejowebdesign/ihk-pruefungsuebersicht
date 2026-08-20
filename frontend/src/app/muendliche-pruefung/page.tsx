"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiClientError, type Paginated, type OralExam } from "@/lib/api";
import { getStoredToken } from "@/lib/oral-auth";
import { ErrorState } from "@/components/States";

function statusLabel(s: string): string {
  if (s === "completed") return "Abgeschlossen";
  if (s === "in_progress") return "In Prüfung";
  return "Entwurf";
}

export default function OralExamsPage() {
  const router = useRouter();
  const [data, setData] = useState<Paginated<OralExam> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [examiner, setExaminer] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [needToken, setNeedToken] = useState(false);

  // Delete flow state.
  const [pendingDelete, setPendingDelete] = useState<OralExam | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.oralExams(1, 50));
    } catch (e: unknown) {
      setError(e instanceof ApiClientError ? e.message : null);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createExam(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setNeedToken(false);
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError("Bitte einen Prüflingsnamen eingeben.");
      return;
    }
    const token = getStoredToken();
    if (!token) {
      setNeedToken(true);
      return;
    }
    setCreating(true);
    try {
      const res = await api.oralCreateExam(token, {
        candidateName: trimmed,
        examDate: date || null,
        examiner: examiner.trim() || null,
        status: "in_progress",
      });
      router.push(`/muendliche-pruefung/${res.examId}`);
    } catch (e: unknown) {
      const msg = e instanceof ApiClientError ? e.message : "Prüfung konnte nicht erstellt werden.";
      setFormError(msg);
      if (e instanceof ApiClientError && e.status === 401) setNeedToken(true);
    } finally {
      setCreating(false);
    }
  }

  async function deleteExam(exam: OralExam) {
    setDeleting(true);
    setDeleteError(null);
    const token = getStoredToken();
    if (!token) {
      setNeedToken(true);
      setDeleting(false);
      setPendingDelete(null);
      return;
    }
    try {
      await api.oralDeleteExam(token, exam.id);
      setPendingDelete(null);
      await load();
    } catch (e: unknown) {
      const msg = e instanceof ApiClientError ? e.message : "Prüfung konnte nicht gelöscht werden.";
      setDeleteError(msg);
      if (e instanceof ApiClientError && e.status === 401) setNeedToken(true);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="oral-page">
      <div className="oral-hero">
        <h1>Mündliche Prüfung</h1>
        <p>Digitale Durchführung, Bewertung und Auswertung einer mündlichen §34a-Sachkundeprüfung.</p>
      </div>

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

      {needToken && (
        <p className="state" role="alert" style={{ padding: 12 }}>
          Für die Durchführung ist ein Administrator-Token nötig. Hinterlege es unter{" "}
          <Link href="/admin">Admin</Link>.
        </p>
      )}
      {formError && <p className="state" role="alert" style={{ padding: 12 }}>{formError}</p>}

      <h2 style={{ marginTop: 28, marginBottom: 12 }}>Letzte Prüfungen</h2>

      {loading ? (
        <div className="oral-card">Lade Prüfungen …</div>
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !data || data.data.length === 0 ? (
        <div className="oral-card">Noch keine Prüfungen vorhanden. Erstelle die erste Prüfung oben.</div>
      ) : (
        <div className="oral-card" style={{ padding: 0 }}>
          <table className="oral-table">
            <thead>
              <tr>
                <th>Prüfling</th>
                <th>Datum</th>
                <th>Ergebnis</th>
                <th>Status</th>
                <th>Aktion</th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((exam) => (
                <tr key={exam.id} data-testid={`oral-exam-row-${exam.id}`}>
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
                    <Link className="btn btn--ghost btn--sm" href={`/muendliche-pruefung/${exam.id}`}>
                      {exam.status === "completed" ? "Ansehen" : "Fortsetzen"}
                    </Link>{" "}
                    <button
                      className="btn btn--ghost btn--sm oral-delete-btn"
                      onClick={() => {
                        setDeleteError(null);
                        setPendingDelete(exam);
                      }}
                      aria-label={`Prüfung ${exam.candidate.name} löschen`}
                      data-testid={`oral-delete-btn-${exam.id}`}
                    >
                      Löschen
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pendingDelete && (
        <div className="oral-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="oral-delete-title" data-testid="oral-delete-dialog">
          <div className="oral-modal">
            <h3 id="oral-delete-title">Prüfung wirklich löschen?</h3>
            <p>
              Die Prüfung von <strong>{pendingDelete.candidate.name}</strong>
              {pendingDelete.examDate ? ` vom ${new Date(pendingDelete.examDate).toLocaleDateString("de-DE")}` : ""} wird
              unwiderruflich gelöscht, inkl. aller gespeicherten Bewertungen und Notizen. Der Fragenpool bleibt
              unangetastet.
            </p>
            {deleteError && <p className="state" role="alert" style={{ padding: 12 }}>{deleteError}</p>}
            {needToken && (
              <p className="state" role="alert" style={{ padding: 12 }}>
                Für das Löschen ist ein Administrator-Token nötig. Hinterlege es unter <Link href="/admin">Admin</Link>.
              </p>
            )}
            <div className="oral-modal__actions">
              <button
                className="btn btn--ghost"
                onClick={() => { setPendingDelete(null); setDeleteError(null); }}
                disabled={deleting}
                data-testid="oral-delete-cancel"
              >
                Abbrechen
              </button>
              <button
                className="btn btn--danger"
                onClick={() => deleteExam(pendingDelete)}
                disabled={deleting}
                data-testid="oral-delete-confirm"
              >
                {deleting ? "Lösche …" : "Löschen"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
