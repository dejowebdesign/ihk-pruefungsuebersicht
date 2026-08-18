"use client";
import { useCallback, useEffect, useState } from "react";
import { api, ApiClientError, type Paginated, type CaseExample } from "@/lib/api";
import { SearchBar } from "@/components/SearchBar";
import { Pagination } from "@/components/Pagination";
import { SkeletonGrid } from "@/components/Skeleton";
import { EmptyState, ErrorState } from "@/components/States";
import { DisplayValue } from "@/components/display";

const LIMIT = 20;

export default function FallbeispielePage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<CaseExample> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = search.trim() || undefined;
      setData(await api.caseExamples(page, LIMIT, q));
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
        <h1 className="section-h__title">Fallbeispiele</h1>
      </div>
      <p style={{ color: "var(--text-muted)", marginBottom: 20 }}>
        Aus dem Katalog „Master_TOP_Fallbeispiele" — {data?.pagination.total ?? 0} Fallbeispiele.
      </p>

      <div style={{ maxWidth: 560, marginBottom: 20 }}>
        <SearchBar value={search} onChange={setSearch} placeholder="Fallbeispiele durchsuchen …" />
      </div>

      {loading ? (
        <SkeletonGrid count={5} />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !data || data.data.length === 0 ? (
        <EmptyState title="Keine Fallbeispiele gefunden" onReset={() => setSearch("")} resetLabel="Suche löschen" />
      ) : (
        <>
          {data.data.map((ce) => (
            <article key={ce.id} className="qa-item">
              <div className="qa-item__head">
                {ce.category && <span className="qa-item__cat">{ce.category}</span>}
                {ce.difficulty && <span className="qa-item__diff">Schwierigkeit: {ce.difficulty}</span>}
                {ce.cluster && <span className="qa-item__diff">Cluster: {ce.cluster}</span>}
              </div>
              <h3 className="qa-item__q">{ce.scenario}</h3>
              {ce.perfectAnswer && <p className="qa-item__a">{ce.perfectAnswer}</p>}
              {ce.legalBasis && (
                <p className="qa-item__a" style={{ marginTop: 8, fontStyle: "italic" }}>
                  Rechtslehre: {ce.legalBasis}
                </p>
              )}
              {(ce.followUp1 || ce.followUp2) && (
                <p className="qa-item__a" style={{ marginTop: 8 }}>
                  {ce.followUp1 && <>Folgefrage 1: <DisplayValue value={ce.followUp1} /></>}
                  {ce.followUp1 && ce.answer1 && (
                    <>
                      {" — "}
                      {ce.answer1}
                    </>
                  )}
                  {ce.followUp1 && ce.followUp2 && <br />}
                  {ce.followUp2 && <>Folgefrage 2: <DisplayValue value={ce.followUp2} /></>}
                  {ce.followUp2 && ce.answer2 && (
                    <>
                      {" — "}
                      {ce.answer2}
                    </>
                  )}
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
