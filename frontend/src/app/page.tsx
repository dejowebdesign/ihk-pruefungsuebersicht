"use client";
import { useCallback, useEffect, useState } from "react";
import {
  api,
  ApiClientError,
  type IhkLocation,
  type Paginated,
} from "@/lib/api";
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

  const hasFilter = bundesland !== "";

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

  function resetFilters() {
    setBundesland("");
    setSearch("");
    setPage(1);
  }

  const items = data?.data ?? [];

  return (
    <>
      <section className="hero">
        <div className="container">
          <h1 className="hero__title">IHK Prüfungsübersicht</h1>
          <p className="hero__subtitle">Sachkundeprüfung §34a – Prüfungsinformationen</p>
          <SearchBar value={search} onChange={setSearch} />
          <p className="hero__note">
            Prüfungsbedingungen und Informationen der verschiedenen IHK-Standorte.
          </p>
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
                <IhkCard key={ihk.id} ihk={ihk} />
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
