"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiClientError, type OralExam, type OralExamQuestion, type OralRating } from "@/lib/api";
import { getStoredToken } from "@/lib/oral-auth";
import { ErrorState } from "@/components/States";

const RATINGS: OralRating[] = ["richtig", "teilweise richtig", "falsch"];
const RATING_LABEL: Record<OralRating, string> = {
  richtig: "Richtig",
  "teilweise richtig": "Teilweise richtig",
  falsch: "Falsch",
};

function pointsFor(weight: number, rating: OralRating | null): number {
  if (rating === "richtig") return weight;
  if (rating === "teilweise richtig") return weight / 2;
  return 0;
}

export default function OralExamPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [exam, setExam] = useState<OralExam | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(0); // index into items (0..7)
  const [noteDraft, setNoteDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [needToken, setNeedToken] = useState(false);
  const [copied, setCopied] = useState(false);
  const [completing, setCompleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const e = await api.oralExam(id);
      setExam(e);
      const item = e.items?.[current];
      if (item) setNoteDraft(item.note ?? "");
    } catch (e: unknown) {
      setError(e instanceof ApiClientError ? e.message : null);
      setExam(null);
    } finally {
      setLoading(false);
    }
  }, [id, current]);

  useEffect(() => {
    load();
  }, [load]);

  // when navigating to another question, sync the note draft
  useEffect(() => {
    const item = exam?.items?.[current];
    if (item) setNoteDraft(item.note ?? "");
  }, [current, exam]);

  async function rate(rating: OralRating | null) {
    const token = getStoredToken();
    if (!token) {
      setNeedToken(true);
      return;
    }
    const item = exam?.items?.[current];
    if (!item) return;
    setSaving(true);
    try {
      await api.oralRateQuestion(token, id, item.orderKey, { rating });
      await load();
    } catch (e: unknown) {
      if (e instanceof ApiClientError && e.status === 401) setNeedToken(true);
      else setError(e instanceof ApiClientError ? e.message : "Bewertung konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  async function saveNote() {
    const token = getStoredToken();
    if (!token) {
      setNeedToken(true);
      return;
    }
    const item = exam?.items?.[current];
    if (!item) return;
    setSaving(true);
    try {
      await api.oralRateQuestion(token, id, item.orderKey, { note: noteDraft });
      await load();
    } catch (e: unknown) {
      if (e instanceof ApiClientError && e.status === 401) setNeedToken(true);
    } finally {
      setSaving(false);
    }
  }

  async function completeExam() {
    const token = getStoredToken();
    if (!token) {
      setNeedToken(true);
      return;
    }
    setCompleting(true);
    try {
      await api.oralCompleteExam(token, id);
      await load();
    } catch (e: unknown) {
      if (e instanceof ApiClientError && e.status === 401) setNeedToken(true);
      else setError(e instanceof ApiClientError ? e.message : "Abschluss fehlgeschlagen.");
    } finally {
      setCompleting(false);
    }
  }

  async function copyOverall() {
    if (!exam) return;
    const text = `${Math.round(exam.percent)} %`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  if (loading) {
    return <div className="oral-page"><div className="oral-card">Lade Prüfung …</div></div>;
  }
  if (error && !exam) {
    return (
      <div className="oral-page">
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }
  if (!exam) return null;

  const items = (exam.items ?? []).slice().sort((a, b) => a.orderKey - b.orderKey);
  const isCompleted = exam.status === "completed";
  const item = items[current];

  // live total (from cached values on items)
  const liveTotal = items.reduce((s, it) => s + pointsFor(it.weight, it.rating), 0);
  const livePercent = Math.round(exam.percent);

  return (
    <div className="oral-page">
      <div className="oral-hero">
        <h1>Prüfung: {exam.candidate.name}</h1>
        <p>
          {exam.examiner ? `Prüfer/in: ${exam.examiner} · ` : ""}
          {exam.examDate ? new Date(exam.examDate).toLocaleDateString("de-DE") : "Kein Datum"}
          {" · "}
          <span className={`oral-status oral-status--${exam.status}`}>
            {isCompleted ? "Abgeschlossen" : exam.status === "in_progress" ? "In Prüfung" : "Entwurf"}
          </span>
        </p>
      </div>

      <p style={{ marginBottom: 16 }}>
        <Link className="btn btn--ghost btn--sm" href="/muendliche-pruefung">← Zurück zur Übersicht</Link>
      </p>

      {needToken && (
        <p className="state" role="alert" style={{ padding: 12 }}>
          Schreibzugriff benötigt einen Administrator-Token. Hinterlege ihn unter <Link href="/admin">Admin</Link>.
        </p>
      )}
      {error && <p className="state" role="alert" style={{ padding: 12 }}>{error}</p>}

      {isCompleted ? (
        <ResultView exam={exam} onCopy={copyOverall} copied={copied} items={items} />
      ) : item ? (
        <ExamTaker
          item={item}
          index={current}
          total={items.length}
          noteDraft={noteDraft}
          setNoteDraft={setNoteDraft}
          saving={saving}
          onRate={rate}
          onSaveNote={saveNote}
          onPrev={() => setCurrent((c) => Math.max(0, c - 1))}
          onNext={() => setCurrent((c) => Math.min(items.length - 1, c + 1))}
          onComplete={completeExam}
          completing={completing}
          liveTotal={liveTotal}
          maxPoints={exam.maxPoints}
        />
      ) : (
        <div className="oral-card">Diese Prüfung hat keine Fragen.</div>
      )}

      {!isCompleted && (
        <details className="oral-card" style={{ marginTop: 16 }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Fragenübersicht ({items.length})</summary>
          <table className="oral-table" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>#</th>
                <th>Themenbereich</th>
                <th>Frage-ID</th>
                <th>Bewertung</th>
                <th>Punkte</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={it.id} style={{ cursor: "pointer", fontWeight: i === current ? 700 : 400 }} onClick={() => setCurrent(i)}>
                  <td>{it.orderKey}</td>
                  <td>{it.themeName}</td>
                  <td>{it.question.excelId}</td>
                  <td>{it.rating ? RATING_LABEL[it.rating] : "—"}</td>
                  <td>{pointsFor(it.weight, it.rating)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

function ExamTaker(props: {
  item: OralExamQuestion;
  index: number;
  total: number;
  noteDraft: string;
  setNoteDraft: (v: string) => void;
  saving: boolean;
  onRate: (r: OralRating | null) => void;
  onSaveNote: () => void;
  onPrev: () => void;
  onNext: () => void;
  onComplete: () => void;
  completing: boolean;
  liveTotal: number;
  maxPoints: number;
}) {
  const { item, index, total, onPrev, onNext, onComplete, completing, liveTotal, maxPoints } = props;
  const progress = Math.round(((index + 1) / total) * 100);
  return (
    <div className="oral-take">
      <div className="oral-progress">
        <span>Frage {index + 1} von {total}</span>
        <div className="oral-progress__bar"><div className="oral-progress__fill" style={{ width: `${progress}%` }} /></div>
        <span>{Math.round((liveTotal / maxPoints) * 100)} %</span>
      </div>

      <div className="oral-card oral-take__card">
        <div>
          <span className="oral-take__theme">{item.themeName}</span>
          <span className="oral-take__weight">Gewichtung: {item.weight} Pkt.</span>
        </div>
        <div className="oral-take__question">{item.question.question}</div>

        {item.question.answer && (
          <div className="oral-take__answer">
            <span className="oral-take__answer-label">Erwartungshorizont / Antwortstichpunkte</span>
            {item.question.answer}
          </div>
        )}

        <div className="oral-ratings">
          {RATINGS.map((r) => (
            <button
              key={r}
              className={`oral-rating-btn${item.rating === r ? " oral-rating-btn--active" : ""}`}
              data-rate={r}
              onClick={() => props.onRate(r)}
              disabled={props.saving}
              aria-pressed={item.rating === r}
            >
              {RATING_LABEL[r]}
              <br />
              <small>{r === "richtig" ? item.weight : r === "teilweise richtig" ? item.weight / 2 : 0} Pkt.</small>
            </button>
          ))}
        </div>

        <label className="oral-take__answer-label" htmlFor="oral-note">Prüfernotiz</label>
        <textarea
          id="oral-note"
          className="oral-note"
          value={props.noteDraft}
          onChange={(e) => props.setNoteDraft(e.target.value)}
          onBlur={props.onSaveNote}
          placeholder="Optional …"
        />

        <div className="oral-take__score">
          Aktuell: <strong>{liveTotal}</strong> / {maxPoints} Punkte
        </div>

        <div className="oral-take__nav">
          <button className="btn btn--ghost" onClick={onPrev} disabled={index === 0}>← Vorherige</button>
          {index < total - 1 ? (
            <button className="btn btn--primary" onClick={onNext}>Nächste →</button>
          ) : (
            <button className="btn btn--primary" onClick={onComplete} disabled={completing}>
              {completing ? "Schließe ab …" : "Prüfung abschließen"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultView(props: {
  exam: OralExam;
  onCopy: () => void;
  copied: boolean;
  items: OralExamQuestion[];
}) {
  const { exam, onCopy, copied, items } = props;

  // Download the PDF evaluation as a file attachment.
  async function downloadPdf() {
    try {
      const res = await fetch(api.oralExamPdfUrl(exam.id, true));
      if (!res.ok) throw new Error("PDF konnte nicht erzeugt werden.");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safe = exam.candidate.name.replace(/[^\p{L}\p{N} _-]/gu, "_").trim() || "Pruefling";
      a.download = `Auswertung_${safe}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // fallback: open inline in a new tab
      window.open(api.oralExamPdfUrl(exam.id, false), "_blank");
    }
  }

  // Open the PDF inline in a new tab (browser preview).
  function openPdf() {
    window.open(api.oralExamPdfUrl(exam.id, false), "_blank");
  }

  return (
    <div className="oral-card oral-result">
      <h2>Gesamtergebnis</h2>
      <div className="oral-result__big">{Math.round(exam.percent)} %</div>
      <p>
        {exam.totalPoints} / {exam.maxPoints} Punkte —{" "}
        <span className={`oral-status oral-status--${exam.result === "Bestanden" ? "pass" : "fail"}`}>{exam.result}</span>
      </p>
      <div className="oral-result__actions">
        <button className="btn btn--primary oral-result__copy" onClick={onCopy}>
          {copied ? "Kopiert ✓" : "Gesamtwert kopieren"}
        </button>
        <button className="btn btn--ghost" onClick={downloadPdf} data-testid="oral-pdf-download">
          PDF-Auswertung
        </button>
        <button className="btn btn--ghost" onClick={openPdf} data-testid="oral-pdf-open">
          PDF öffnen
        </button>
      </div>

      <details style={{ marginTop: 24, textAlign: "left" }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Detaillierte Auswertung</summary>
        <table className="oral-table" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>#</th>
              <th>Themenbereich</th>
              <th>Frage-ID</th>
              <th>Bewertung</th>
              <th>Punkte</th>
              <th>Notiz</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td>{it.orderKey}</td>
                <td>{it.themeName}</td>
                <td>{it.question.excelId}</td>
                <td>{it.rating ? RATING_LABEL[it.rating] : "—"}</td>
                <td>{it.points}</td>
                <td>{it.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
