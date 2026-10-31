"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  api,
  ApiClientError,
  type OralExam,
  type OralExamQuestion,
  type OralRating,
  type OralThemeBreakdown,
} from "@/lib/api";
import { ErrorState } from "@/components/States";
import { useIdentity } from "@/lib/use-identity";
import { canManageExams } from "@/lib/auth";
import { formatPercent, formatOverallPercent } from "@/lib/format";
import { ResultView } from "@/components/OralResultView";

const RATINGS: OralRating[] = ["richtig", "teilweise richtig", "falsch"];
const RATING_LABEL: Record<OralRating, string> = {
  richtig: "Richtig",
  "teilweise richtig": "Teilweise richtig",
  falsch: "Falsch",
};
// Share of a question's value each rating yields (B1: 100 / 50 / 0 %).
const RATING_SHARE: Record<OralRating, string> = {
  richtig: "100 %",
  "teilweise richtig": "50 %",
  falsch: "0 %",
};

/** Per-theme values: 13.5 → "13,5", 76 → "76" (shared with the PDF). */
const fmtPercent = formatPercent;

export default function OralExamPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const { user } = useIdentity();
  // Rating, completing and the question overview belong to both staff roles.
  // The server enforces this too (requireStaff) — this only avoids offering
  // buttons that would be rejected.
  const canManage = canManageExams(user?.role);
  const [exam, setExam] = useState<OralExam | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  const [noteDraft, setNoteDraft] = useState("");
  const [answerDraft, setAnswerDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [completing, setCompleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const e = await api.oralExam(id);
      setExam(e);
      const item = e.items?.[current];
      if (item) {
        setNoteDraft(item.note ?? "");
        setAnswerDraft(item.candidateAnswer ?? "");
      }
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

  useEffect(() => {
    const item = exam?.items?.[current];
    if (item) {
      setNoteDraft(item.note ?? "");
      setAnswerDraft(item.candidateAnswer ?? "");
    }
  }, [current, exam]);

  async function rate(rating: OralRating | null) {
    const item = exam?.items?.[current];
    if (!item) return;
    setSaving(true);
    setError(null);
    try {
      await api.oralRateQuestion(id, item.orderKey, { rating });
      await load();
    } catch (e: unknown) {
      setError(
        e instanceof ApiClientError ? e.message : "Bewertung konnte nicht gespeichert werden.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function saveNote() {
    const item = exam?.items?.[current];
    if (!item) return;
    setSaving(true);
    try {
      await api.oralRateQuestion(id, item.orderKey, {
        note: noteDraft,
        candidateAnswer: answerDraft,
      });
      await load();
    } catch (e: unknown) {
      setError(e instanceof ApiClientError ? e.message : "Notiz konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  async function completeExam() {
    setCompleting(true);
    setError(null);
    try {
      await api.oralCompleteExam(id);
      await load();
    } catch (e: unknown) {
      setError(e instanceof ApiClientError ? e.message : "Abschluss fehlgeschlagen.");
    } finally {
      setCompleting(false);
    }
  }

  async function copyOverall() {
    if (!exam) return;
    // Luna transfer: only the single overall percent, nothing else.
    const text = `${Math.round(exam.percent)} %`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
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

      {error && <p className="state" role="alert" style={{ padding: 12 }}>{error}</p>}

      {isCompleted ? (
        <ResultView exam={exam} onCopy={copyOverall} copied={copied} items={items} />
      ) : !canManage ? (
        <div className="oral-card">Diese Prüfung ist noch nicht abgeschlossen.</div>
      ) : item ? (
        <ExamTaker
          item={item}
          index={current}
          total={items.length}
          noteDraft={noteDraft}
          setNoteDraft={setNoteDraft}
          answerDraft={answerDraft}
          setAnswerDraft={setAnswerDraft}
          saving={saving}
          onRate={rate}
          onSaveNote={saveNote}
          onPrev={() => setCurrent((c) => Math.max(0, c - 1))}
          onNext={() => setCurrent((c) => Math.min(items.length - 1, c + 1))}
          onComplete={completeExam}
          completing={completing}
          livePercent={livePercent}
        />
      ) : (
        <div className="oral-card">Diese Prüfung hat keine Fragen.</div>
      )}

      {!isCompleted && canManage && (
        <details className="oral-card" style={{ marginTop: 16 }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Fragenübersicht ({items.length})</summary>
          <div className="table-scroll" style={{ marginTop: 12 }}>
            <table className="oral-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Themenbereich</th>
                  <th>Frage-ID</th>
                  <th>Bewertung</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={it.id} style={{ cursor: "pointer", fontWeight: i === current ? 700 : 400 }} onClick={() => setCurrent(i)}>
                    <td>{it.orderKey}</td>
                    <td>{it.themeName}</td>
                    <td>{it.question.excelId}</td>
                    <td>{it.rating ? RATING_LABEL[it.rating] : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
  answerDraft: string;
  setAnswerDraft: (v: string) => void;
  saving: boolean;
  onRate: (r: OralRating | null) => void;
  onSaveNote: () => void;
  onPrev: () => void;
  onNext: () => void;
  onComplete: () => void;
  completing: boolean;
  livePercent: number;
}) {
  const { item, index, total, onPrev, onNext, onComplete, completing, livePercent } = props;
  const progress = Math.round(((index + 1) / total) * 100);
  return (
    <div className="oral-take">
      <div className="oral-progress">
        <span>Frage {index + 1} von {total}</span>
        <div className="oral-progress__bar"><div className="oral-progress__fill" style={{ width: `${progress}%` }} /></div>
        <span>{livePercent} %</span>
      </div>

      <div className="oral-card oral-take__card">
        <div>
          <span className="oral-take__theme">{item.themeName}</span>
          <span className="oral-take__weight">Gewichtung: {item.weight} %</span>
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
              <small>{RATING_SHARE[r]}</small>
            </button>
          ))}
        </div>

        <label className="oral-take__answer-label" htmlFor="oral-candidate-answer">
          Antwort des Prüflings
        </label>
        <textarea
          id="oral-candidate-answer"
          className="oral-note"
          value={props.answerDraft}
          onChange={(e) => props.setAnswerDraft(e.target.value)}
          onBlur={props.onSaveNote}
          placeholder="Optional: dokumentierte Antwort des Prüflings …"
        />

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
          Aktuell: <strong>{livePercent} %</strong>
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
