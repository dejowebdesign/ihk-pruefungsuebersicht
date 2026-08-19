"use client";
import { useCallback, useEffect, useState } from "react";
import {
  api,
  ApiClientError,
  type IhkLocation,
  type Paginated,
} from "@/lib/api";
import {
  loadCompareIds,
  saveCompareIds,
  toggleCompareId,
  MAX_COMPARE,
} from "@/lib/compare";
import { SearchBar } from "@/components/SearchBar";
import { BundeslandFilter } from "@/components/FilterPanel";
import { IhkCard } from "@/components/IhkCard";
import { Pagination } from "@/components/Pagination";
import { SkeletonGrid } from "@/components/Skeleton";
import { EmptyState, ErrorState } from "@/components/States";

const LIMIT = 12;
// One-shot fetch size to derive the distinct Bundesländer from the IHK data
// (not hardcoded). The IHK dataset is small (~80–150 rows), so a single
// high-limit list call is cheap and avoids any backend change.
const BUNDESLAND_FETCH_LIMIT = 500;
type Sort = "name" | "bundesland";

export default function HomePage() {
  const [search, setSearch] = useState("");
  // The ONLY remaining filter on the overview is the Bundesland dropdown.
  // "" means "Alle Bundesländer".
  const [bundesland, setBundesland] = useState("");
  const [bundeslaender, setBundeslaender] = useState<string[]>([]);
  const [sort, setSort] = useState<Sort>("name");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<IhkLocation> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Compare selection lives in localStorage (shared with /vergleich) so it
  // survives navigation and refresh. State mirrors storage for the UI; the
  // empty initial value avoids SSR/hydration mismatches, then mounts from
  // storage.
  const [compare, setCompare] = useState<string[]>([]);
  // `mounted` gates the persist effect so the initial mount run (compare=[])
  // never wipes a stored selection before the restore effect has read it.
  const [mounted, setMounted] = useState(false);

  const hasFilter = bundesland !== "";

  // Restore selection from storage on mount (client only), then allow persist.
  useEffect(() => {
    setCompare(loadCompareIds());
    setMounted(true);
  }, []);

  // Derive the distinct Bundesländer from the IHK data (once, on mount) so the
  // dropdown options are never hardcoded.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.ihkList({ page: 1, limit: BUNDESLAND_FETCH_LIMIT });
        if (cancelled) return;
        const distinct = Array.from(
          new Set(res.data.map((i) => i.bundesland).filter(Boolean) as string[]),
        ).sort();
        setBundeslaender(distinct);
      } catch {
        // Non-fatal: dropdown just shows "Alle Bundesländer".
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist selection whenever it changes — but only after the restore has
  // happened, so we never overwrite stored ids with the initial empty state.
  useEffect(() => {
    if (!mounted) return;
    saveCompareIds(compare);
  }, [compare, mounted]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let res: Paginated<IhkLocation>;
      const q = search.trim();
      if (q.length >= 2 && !hasFilter) {
        res = await api.ihkSearch(q, page, LIMIT);
      } else {
        res = await api.ihkList({
          page,
          limit: LIMIT,
          bundesland,
        });
      }
      setData(res);
    } catch (e: unknown) {
      const msg = e instanceof ApiClientError ? e.message : null;
      setError(msg);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [search, page, bundesland, hasFilter]);

  useEffect(() => {
    load();
  }, [load]);

  // Reset to page 1 when search/filter/sort change.
  useEffect(() => {
    setPage(1);
  }, [search, bundesland, sort]);

  function toggleCompare(id: string) {
    setCompare((prev) => toggleCompareId(prev, id));
  }

  function resetFilters() {
    setBundesland("");
    setSearch("");
    setPage(1);
  }

  const items = data?.data ?? [];
  const compareFull = compare.length >= MAX_COMPARE;

  return (
    <>
      <section className="hero">
        <div className="container">
          <h1 className="hero__title">IHK Prüfungsübersicht</h1>
          <p className="hero__subtitle">Sachkundeprüfung §34a – Prüfungsinformationen</p>
          <SearchBar value={search} onChange={setSearch} />
          <p style={{ marginTop: 14, color: "var(--text-muted)", fontSize: "0.95rem" }}>
            Vergleiche Prüfungsbedingungen und Informationen der verschiedenen IHK-Standorte.
          </p>
          {compare.length > 0 && (
            <div
              style={{
                marginTop: 16,
                display: "inline-flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 14px",
                background: "var(--primary-soft)",
                border: "1px solid var(--primary)",
                borderRadius: "var(--radius-sm)",
              }}
            >
              <span style={{ fontWeight: 600, color: "var(--primary)" }}>
                {compare.length} zum Vergleich ausgewählt
              </span>
              <a className="btn btn--sm btn--primary" href="/vergleich">
                Vergleichen →
              </a>
              <button className="btn btn--sm btn--ghost" onClick={() => setCompare([])}>
                Leeren
              </button>
            </div>
          )}
        </div>
      </section>

      <div className="container">
        <div className="toolbar">
          <div className="toolbar__left">
            <label className="filter-trigger" style={{ gap: 8 }}>
              <span>Sortierung:</span>
              <select
                className="sort-select"
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
                style={{ border: "none", background: "transparent", fontWeight: 500 }}
                aria-label="Sortierung"
              >
                <option value="name">Name (A–Z)</option>
                <option value="bundesland">Bundesland</option>
              </select>
            </label>
          </div>
          {data && <span className="toolbar__count">{data.pagination.total} IHK-Standorte</span>}
        </div>

        <BundeslandFilter value={bundesland} options={bundeslaender} onChange={setBundesland} />

        {loading ? (
          <SkeletonGrid count={6} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : items.length === 0 ? (
          <EmptyState onReset={resetFilters} />
        ) : (
          <>
            <div className="ihk-grid">
              {items.map((ihk) => (
                <IhkCard
                  key={ihk.id}
                  ihk={ihk}
                  selected={compare.includes(ihk.id)}
                  onToggleSelect={compareFull ? undefined : toggleCompare}
                />
              ))}
            </div>
            <Pagination
              page={data!.pagination.page}
              totalPages={data!.pagination.totalPages}
              total={data!.pagination.total}
              limit={data!.pagination.limit}
              onPage={setPage}
            />
          </>
        )}
      </div>
    </>
  );
}
