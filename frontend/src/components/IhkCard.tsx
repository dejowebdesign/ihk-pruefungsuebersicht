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

/**
 * The whole card is one link to the IHK detail page.
 *
 * An `<a>` is natively reachable by mouse, keyboard (Tab + Enter) and touch, so
 * making the card itself the anchor gives every input method the same, full-size
 * target. There is deliberately no nested button and no expand toggle: the card
 * has exactly one action, and a single link is also what keeps the markup valid
 * (no interactive content nested inside an anchor).
 */
export function IhkCard({ ihk }: { ihk: IhkLocation }) {
  const name = ihk.ihkShortName ?? "IHK-Standort";
  return (
    <Link href={`/ihk/${ihk.id}`} className="ihk-card" aria-label={`${name} – Details anzeigen`}>
      <div className="ihk-card__head">
        <h3 className="ihk-card__name">{name}</h3>
        <p className="ihk-card__region">
          <DisplayValue value={ihk.bundesland} />
        </p>
      </div>

      <SkpBadge value={ihk.skp} />

      <div className="ihk-card__attrs">
        <Attr label="Schriftlich" value={ihk.writtenForm} />
        <Attr label="Ergebnis" value={ihk.writtenResultImmediate === "ja" ? "sofort" : ihk.writtenResultImmediate} />
        <Attr label="Gleicher Tag" value={ihk.sameDay} />
        <Attr label="Abstand" value={ihk.intervalWrittenOral} />
        <Attr label="Mündlich" value={ihk.groupFormat} />
      </div>
    </Link>
  );
}
