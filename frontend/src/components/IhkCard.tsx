import Link from "next/link";
import type { IhkLocation } from "@/lib/api";
import { SkpBadge } from "./Badge";
import { DisplayValue } from "./display";

function Attr({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="attr">
      <span className="attr__label">{label}</span>
      <span className="attr__value">
        <DisplayValue value={value} />
      </span>
    </div>
  );
}

export function IhkCard({
  ihk,
  selected,
  onToggleSelect,
}: {
  ihk: IhkLocation;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  return (
    <article className="ihk-card">
      <div className="ihk-card__head">
        <Link href={`/ihk/${ihk.id}`} style={{ textDecoration: "none", color: "inherit", flex: 1 }}>
          <h3 className="ihk-card__name">{ihk.ihkShortName}</h3>
          <p className="ihk-card__region">
            <DisplayValue value={ihk.bundesland} />
          </p>
        </Link>
        {onToggleSelect && (
          <button
            className={`ihk-card__select${selected ? " ihk-card__select--selected" : ""}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleSelect(ihk.id);
            }}
            aria-pressed={selected}
            aria-label={selected ? "Vom Vergleich entfernen" : "Zum Vergleich hinzufügen"}
            title={selected ? "Vom Vergleich entfernen" : "Zum Vergleich hinzufügen"}
          >
            {selected ? "✓" : "+"}
          </button>
        )}
      </div>

      <SkpBadge value={ihk.skp} />

      <div className="ihk-card__attrs">
        <Attr label="Schriftlich" value={ihk.writtenForm} />
        <Attr label="Ergebnis" value={ihk.writtenResultImmediate === "ja" ? "sofort" : ihk.writtenResultImmediate} />
        <Attr label="Gleicher Tag" value={ihk.sameDay} />
        <Attr label="Abstand" value={ihk.intervalWrittenOral} />
        <Attr label="Mündlich" value={ihk.groupFormat} />
      </div>
    </article>
  );
}
