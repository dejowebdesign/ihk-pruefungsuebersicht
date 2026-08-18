import type { IhkLocation } from "@/lib/api";
import { DisplayCell } from "./display";

const FEATURES: { key: keyof IhkLocation; label: string }[] = [
  { key: "skp", label: "SKP" },
  { key: "writtenForm", label: "Schriftlich" },
  { key: "writtenResultImmediate", label: "Ergebnis" },
  { key: "sameDay", label: "Gleicher Tag" },
  { key: "intervalWrittenOral", label: "Abstand" },
  { key: "groupFormat", label: "Mündlich" },
  { key: "examinerCount", label: "Prüferanzahl" },
  { key: "vorbereitung", label: "Vorbereitung" },
  { key: "punktesystem", label: "Punktesystem" },
  { key: "bundesland", label: "Bundesland" },
];

export function ComparisonTable({ ihks }: { ihks: IhkLocation[] }) {
  if (!ihks.length) {
    return (
      <div className="cmp-empty">
        Wähle IHKs über die Karten (‹+›) zum Vergleichen aus — maximal 4 gleichzeitig.
      </div>
    );
  }

  return (
    <div className="cmp-scroll">
      <table className="cmp-table">
        <thead>
          <tr>
            <th className="cmp-table__feature">Merkmal</th>
            {ihks.map((i) => (
              <th key={i.id}>{i.ihkShortName}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {FEATURES.map((f) => (
            <tr key={f.key}>
              <td className="cmp-table__feature">{f.label}</td>
              {ihks.map((i) => (
                <td key={i.id}>
                  <DisplayCell value={i[f.key] as string | null} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
