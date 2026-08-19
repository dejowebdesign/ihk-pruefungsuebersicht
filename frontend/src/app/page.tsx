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
import { FilterPanel, EMPTY_FILTERS, type FilterValues, hasActiveFilters } from "@/components/FilterPanel";
import { IhkCard } from "@/components/IhkCard";
import { Pagination } from "@/components/Pagination";
import { SkeletonGrid } from "@/components/Skeleton";
import { EmptyState, ErrorState } from "@/components/States";

const LIMIT = 12;
type Sort = "name" | "bundesland";

export default function HomePage() {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<FilterValues>(EMPTY_FILTERS);
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

  const hasFilters = hasActiveFilters(filters);

  // Restore selection from storage on mount (client only), then allow persist.
  useEffect(() => {
    setCompare(loadCompareIds());
    setMounted(true);
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
      if (q.length >= 2 && !hasFilters) {
        res = await api.ihkSearch(q, page, LIMIT);
      } else {
        res = await api.ihkList({
          page,
          limit: LIMIT,
          bundesland: filters.bundesland,
          skp: filters.skp,
          writtenForm: filters.writtenForm,
          writtenResultImmediate: filters.writtenResultImmediate,
          sameDay: filters.sameDay,
          intervalWrittenOral: filters.intervalWrittenOral,
          groupFormat: filters.groupFormat,
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
  }, [search, page, filters, hasFilters]);

  useEffect(() => {
    load();
  }, [load]);

  // Reset to page 1 when search/filters/sort change.
  useEffect(() => {
    setPage(1);
  }, [search, filters, sort]);

  function toggleCompare(id: string) {
    setCompare((prev) => toggleCompareId(prev, id));
  }

  function resetFilters() {
    setFilters(EMPTY_FILTERS);
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
            <button
              className={`filter-trigger${hasFilters ? " filter-trigger--active" : ""}`}
              onClick={() => {
                const p = document.getElementById("filter-panel");
                if (p) p.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 4h18l-7 8v6l-4 2v-8L3 4z" strokeLinejoin="round" />
              </svg>
              Filter {hasFilters && `(${Object.values(filters).filter(Boolean).length})`}
            </button>
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

        <div id="filter-panel">
          <FilterPanel values={filters} onChange={setFilters} onReset={resetFilters} />
        </div>

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
