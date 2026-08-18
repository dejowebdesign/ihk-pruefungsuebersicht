"use client";
import { useState } from "react";

export interface FilterValues {
  bundesland: string;
  skp: string;
  writtenForm: string;
  writtenResultImmediate: string;
  sameDay: string;
  intervalWrittenOral: string;
  groupFormat: string;
}

export const EMPTY_FILTERS: FilterValues = {
  bundesland: "",
  skp: "",
  writtenForm: "",
  writtenResultImmediate: "",
  sameDay: "",
  intervalWrittenOral: "",
  groupFormat: "",
};

export function hasActiveFilters(f: FilterValues): boolean {
  return Object.values(f).some((v) => v !== "");
}

// Distinct filter options — derived client-side from known data shape. These
// are presented as suggestions; the API accepts any matching string value.
const BUNDESLAENDER = [
  "Baden-Württemberg",
  "Bayern",
  "Berlin",
  "Brandenburg",
  "Bremen",
  "Hamburg",
  "Hessen",
  "Mecklenburg-Vorpommern",
  "Niedersachsen",
  "Nordrhein-Westfalen",
  "Rheinland-Pfalz",
  "Saarland",
  "Sachsen",
  "Sachsen-Anhalt",
  "Schleswig-Holstein",
  "Thüringen",
];

const SKP_OPTS = ["✅", "nein", "n/a"];
const WRITTEN_FORM_OPTS = ["Tablet", "Laptop/PC", "PC", "Papier"];
const IMMEDIATE_OPTS = ["ja", "nein", "n/a"];
const SAME_DAY_OPTS = ["ja", "nein", "n/a"];
const GROUP_OPTS = ["3er Gruppe", "4er Gruppe", "2er Gruppe", "Einzel"];

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`filter-chip${active ? " filter-chip--active" : ""}`}
      onClick={onClick}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}

export function FilterPanel({
  values,
  onChange,
  onReset,
}: {
  values: FilterValues;
  onChange: (next: FilterValues) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(true);

  function set(key: keyof FilterValues, val: string) {
    onChange({ ...values, [key]: val });
  }

  function toggle(key: keyof FilterValues, val: string) {
    set(key, values[key] === val ? "" : val);
  }

  return (
    <div className="filter-panel">
      <div className="filter-panel__title">
        <span>Filter</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
          >
            {open ? "Verbergen" : "Anzeigen"}
          </button>
          {hasActiveFilters(values) && (
            <button type="button" className="btn btn--sm" onClick={onReset}>
              Zurücksetzen
            </button>
          )}
        </div>
      </div>

      {open && (
        <>
          <div className="filter-group">
            <span className="filter-group__label">Bundesland</span>
            <div className="filter-options">
              {BUNDESLAENDER.map((b) => (
                <Chip
                  key={b}
                  label={b}
                  active={values.bundesland === b}
                  onClick={() => toggle("bundesland", b)}
                />
              ))}
            </div>
          </div>

          <div className="filter-group">
            <span className="filter-group__label">SKP verfügbar</span>
            <div className="filter-options">
              {SKP_OPTS.map((o) => (
                <Chip
                  key={o}
                  label={o === "✅" ? "Ja (✅)" : o}
                  active={values.skp === o}
                  onClick={() => toggle("skp", o)}
                />
              ))}
            </div>
          </div>

          <div className="filter-group">
            <span className="filter-group__label">Schriftliche Prüfungsform</span>
            <div className="filter-options">
              {WRITTEN_FORM_OPTS.map((o) => (
                <Chip
                  key={o}
                  label={o}
                  active={values.writtenForm === o}
                  onClick={() => toggle("writtenForm", o)}
                />
              ))}
            </div>
          </div>

          <div className="filter-group">
            <span className="filter-group__label">Ergebnis sofort</span>
            <div className="filter-options">
              {IMMEDIATE_OPTS.map((o) => (
                <Chip
                  key={o}
                  label={o}
                  active={values.writtenResultImmediate === o}
                  onClick={() => toggle("writtenResultImmediate", o)}
                />
              ))}
            </div>
          </div>

          <div className="filter-group">
            <span className="filter-group__label">Gleicher Tag</span>
            <div className="filter-options">
              {SAME_DAY_OPTS.map((o) => (
                <Chip key={o} label={o} active={values.sameDay === o} onClick={() => toggle("sameDay", o)} />
              ))}
            </div>
          </div>

          <div className="filter-group">
            <span className="filter-group__label">Gruppenformat</span>
            <div className="filter-options">
              {GROUP_OPTS.map((o) => (
                <Chip key={o} label={o} active={values.groupFormat === o} onClick={() => toggle("groupFormat", o)} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
