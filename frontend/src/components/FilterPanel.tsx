"use client";

// The IHK overview keeps ONLY a single "Bundesland" filter. The available
// Bundesländer are NOT hardcoded — they are derived from the IHK data and
// passed in as `options` by the page. The backend `/api/ihk?bundesland=…`
// filter (already supported) does the actual filtering; this component only
// drives that one parameter.

export function BundeslandFilter({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (next: string) => void;
}) {
  return (
    <div className="filter-panel filter-panel--single">
      <label className="filter-group__label" htmlFor="bundesland-filter">
        Bundesland
      </label>
      <div className="bundesland-filter">
        <select
          id="bundesland-filter"
          className="bundesland-select sort-select"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Bundesland filtern"
        >
          <option value="">Alle Bundesländer</option>
          {options.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
