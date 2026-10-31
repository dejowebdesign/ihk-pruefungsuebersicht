"use client";
// Result / post-exam review of a completed oral exam.
//
// Shown only for COMPLETED exams. Every one of the 13 questions that were
// actually asked is rendered as a collapsible card so the candidate can work
// through the exam afterwards:
//
//   theme + Frage-ID, full question wording, own documented answer, rating,
//   examiner comment (only when one exists) and a "Musterlösung anzeigen"
//   section that starts collapsed.
//
// The Musterlösung is rendered ONLY here. During a running exam the taker view
// (page.tsx) shows the "Erwartungshorizont" for the examiner, but this
// component — and therefore the solution accordion — is never mounted until
// status === "completed".

import type { OralExam, OralExamQuestion, OralThemeBreakdown } from "@/lib/api";
import { api } from "@/lib/api";
import { formatPercent, formatOverallPercent } from "@/lib/format";

/** Per-theme values: 13.5 → "13,5", 76 → "76" (identical to the PDF). */
const fmtPercent = formatPercent;

const RATING_LABEL: Record<string, string> = {
  richtig: "Richtig",
  "teilweise richtig": "Teilweise richtig",
  falsch: "Falsch",
};

/** CSS modifier per rating. A single token, so no class needs an escaped space. */
const RATING_CLASS: Record<string, string> = {
  richtig: "richtig",
  "teilweise richtig": "partial",
  falsch: "falsch",
};

/** Share of a question's value each rating yields (100 / 50 / 0 %). */
function ratingShare(rating: string | null): number {
  if (rating === "richtig") return 100;
  if (rating === "teilweise richtig") return 50;
  return 0;
}

export interface ResultViewProps {
  exam: OralExam;
  onCopy: () => void;
  copied: boolean;
  items: OralExamQuestion[];
}

export function ResultView({ exam, onCopy, copied, items }: ResultViewProps) {
  // Per-theme breakdown is computed and served by the backend from the stored
  // ratings; this component only formats it.
  const breakdown: OralThemeBreakdown[] = exam.breakdown ?? [];
  const overall = formatOverallPercent(exam.percent);
  const ordered = items.slice().sort((a, b) => a.orderKey - b.orderKey);

  return (
    <div className="oral-card oral-result">
      <h2>Gesamtergebnis</h2>
      <div className="oral-result__big" data-testid="oral-overall-percent">
        {overall} %
      </div>
      <p>
        <span
          className={`oral-status oral-status--${exam.result === "Bestanden" ? "pass" : "fail"}`}
        >
          {exam.result}
        </span>{" "}
        · Bestehensgrenze 50 %
      </p>
      <div className="oral-result__actions">
        <button className="btn btn--primary oral-result__copy" onClick={onCopy}>
          {copied ? "Kopiert ✓" : "Gesamtwert kopieren"}
        </button>
        <a
          className="btn btn--ghost"
          href={api.oralExamPdfUrl(exam.id)}
          target="_blank"
          rel="noopener noreferrer"
        >
          PDF öffnen
        </a>
        <a className="btn btn--ghost" href={api.oralExamPdfUrl(exam.id, true)}>
          PDF-Auswertung herunterladen
        </a>
      </div>

      <details open className="oral-section">
        <summary className="oral-section__summary">Auswertung nach Themengebiet</summary>
        <div className="table-scroll" style={{ marginTop: 12 }}>
          <table className="oral-table">
            <thead>
              <tr>
                <th>Themengebiet</th>
                <th>Ergebnis</th>
                <th>Gewichtung</th>
                <th>Beitrag zum Gesamtergebnis</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.map((b) => (
                <tr key={b.themeName}>
                  <td>{b.themeName}</td>
                  <td>{fmtPercent(b.percent)} %</td>
                  <td>{fmtPercent(b.weight)} %</td>
                  <td>{fmtPercent(b.contribution)} %</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700 }}>
                <td>Gesamtergebnis</td>
                <td>{overall} %</td>
                <td>{fmtPercent(breakdown.reduce((s, b) => s + b.weight, 0))} %</td>
                <td>{overall} %</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>

      <details open className="oral-section">
        <summary className="oral-section__summary">
          Gestellte Prüfungsfragen ({ordered.length})
        </summary>
        <p className="oral-hint">
          Alle {ordered.length} Fragen in der Reihenfolge der Prüfung. Die Musterlösung
          lässt sich je Frage aufklappen.
        </p>
        <ol className="oral-qcards">
          {ordered.map((it) => (
            <QuestionCard key={it.id} item={it} />
          ))}
        </ol>
      </details>
    </div>
  );
}

function QuestionCard({ item }: { item: OralExamQuestion }) {
  const ratingLabel = item.rating ? (RATING_LABEL[item.rating] ?? item.rating) : "Nicht bewertet";
  const share = ratingShare(item.rating);
  const note = (item.note ?? "").trim();
  const ownAnswer = (item.candidateAnswer ?? "").trim();

  return (
    <li className="oral-qcard" data-testid={`oral-qcard-${item.orderKey}`}>
      <details>
        <summary className="oral-qcard__summary">
          <span className="oral-qcard__num">Frage {item.orderKey}</span>
          <span className="oral-qcard__meta">
            <span className="oral-qcard__theme">{item.themeName}</span>
            <span className="oral-qcard__id">{item.question.excelId}</span>
          </span>
          <span
            className={`oral-qcard__rating oral-qcard__rating--${
              item.rating ? (RATING_CLASS[item.rating] ?? "none") : "none"
            }`}
            data-testid={`oral-qcard-rating-${item.orderKey}`}
          >
            {ratingLabel}
          </span>
        </summary>

        <div className="oral-qcard__body">
          <div className="oral-qcard__field">
            <span className="oral-qcard__label">Fragestellung</span>
            <p className="oral-qcard__text">{item.question.question}</p>
          </div>

          <div className="oral-qcard__field">
            <span className="oral-qcard__label">Bewertung</span>
            <p className="oral-qcard__text">
              <strong>{ratingLabel}</strong>{" "}
              <span className="oral-qcard__share">({formatPercent(share)} %)</span>
            </p>
          </div>

          <div className="oral-qcard__field">
            <span className="oral-qcard__label">Antwort des Prüflings</span>
            {ownAnswer ? (
              <p className="oral-qcard__text">{ownAnswer}</p>
            ) : (
              <p className="oral-qcard__text oral-qcard__text--muted">
                Keine Antwort dokumentiert.
              </p>
            )}
          </div>

          {/* Only rendered when a comment was actually stored. */}
          {note && (
            <div className="oral-qcard__field" data-testid={`oral-qcard-note-${item.orderKey}`}>
              <span className="oral-qcard__label">Prüferkommentar</span>
              <p className="oral-qcard__text">{note}</p>
            </div>
          )}

          {/* Starts collapsed: the solution is for post-exam review. */}
          <details className="oral-qcard__solution" data-testid={`oral-solution-${item.orderKey}`}>
            <summary className="oral-qcard__solution-summary">Musterlösung anzeigen</summary>
            <p className="oral-qcard__text oral-qcard__text--pre">
              {item.question.answer?.trim() || "Keine Musterlösung gespeichert."}
            </p>
          </details>
        </div>
      </details>
    </li>
  );
}
