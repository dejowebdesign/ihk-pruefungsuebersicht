"use client";
import { useCallback, useEffect, useState } from "react";
import { api, ApiClientError, type Paginated, type Question } from "@/lib/api";
import { SearchBar } from "@/components/SearchBar";
import { Pagination } from "@/components/Pagination";
import { SkeletonGrid } from "@/components/Skeleton";
import { EmptyState, ErrorState } from "@/components/States";
import { DisplayValue } from "@/components/display";

const LIMIT = 20;

export default function FragenPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<Question> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = search.trim() || undefined;
      setData(await api.questions(page, LIMIT, q));
    } catch (e: unknown) {
      setError(e instanceof ApiClientError ? e.message : null);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [search, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  return (
    <div className="container" style={{ maxWidth: 820 }}>
      <div className="section-h">
        <h1 className="section-h__title">Fragen (mündlich)</h1>
      </div>
      <p style={{ color: "var(--text-muted)", marginBottom: 20 }}>
        Aus dem Katalog „Master_Fragen_Muendlich" — {data?.pagination.total ?? 0} Fragen.
      </p>

      <div style={{ maxWidth: 560, marginBottom: 20 }}>
        <SearchBar value={search} onChange={setSearch} placeholder="Fragen durchsuchen …" />
      </div>

      {loading ? (
        <SkeletonGrid count={5} />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !data || data.data.length === 0 ? (
        <EmptyState title="Keine Fragen gefunden" onReset={() => setSearch("")} resetLabel="Suche löschen" />
      ) : (
        <>
          {data.data.map((q) => (
            <article key={q.id} className="qa-item">
              <div className="qa-item__head">
                {q.category && <span className="qa-item__cat">{q.category}</span>}
                {q.difficulty && <span className="qa-item__diff">Schwierigkeit: {q.difficulty}</span>}
                {q.cluster && <span className="qa-item__diff">Cluster: {q.cluster}</span>}
              </div>
              <h3 className="qa-item__q">{q.question}</h3>
              {q.answer && <p className="qa-item__a">{q.answer}</p>}
              {q.legalBasis && (
                <p className="qa-item__a" style={{ marginTop: 8, fontStyle: "italic" }}>
                  Rechtslehre: {q.legalBasis}
                </p>
              )}
              {(q.followUp1 || q.followUp2) && (
                <p className="qa-item__a" style={{ marginTop: 8 }}>
                  {q.followUp1 && <>Folgefrage 1: <DisplayValue value={q.followUp1} /></>}
                  {q.followUp1 && q.followUp2 && <br />}
                  {q.followUp2 && <>Folgefrage 2: <DisplayValue value={q.followUp2} /></>}
                </p>
              )}
            </article>
          ))}
          <Pagination
            page={data.pagination.page}
            totalPages={data.pagination.totalPages}
            total={data.pagination.total}
            limit={data.pagination.limit}
            onPage={setPage}
          />
        </>
      )}
    </div>
  );
}
