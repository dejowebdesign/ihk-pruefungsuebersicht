"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiClientError, type IhkLocation } from "@/lib/api";
import {
  loadCompareIds,
  saveCompareIds,
  clearCompareIds,
} from "@/lib/compare";
import { ComparisonTable } from "@/components/ComparisonTable";
import { SkeletonGrid } from "@/components/Skeleton";
import { ErrorState, EmptyState } from "@/components/States";

export default function VergleichPage() {
  const [ids, setIds] = useState<string[]>([]);
  const [ihks, setIhks] = useState<IhkLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load selected IDs from localStorage on mount (shared with the overview).
  useEffect(() => {
    setIds(loadCompareIds());
  }, []);

  const load = useCallback(async () => {
    if (!ids.length) {
      setIhks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Fetch each IHK detail (ihkDetail returns IhkDetail which extends
      // IhkLocation, so it works for the table).
      const fetched = await Promise.all(
        ids.map((id) =>
          api.ihkDetail(id).then(
            (d) => d as unknown as IhkLocation,
            () => null,
          ),
        ),
      );
      setIhks(fetched.filter(Boolean) as IhkLocation[]);
    } catch (e: unknown) {
      setError(e instanceof ApiClientError ? e.message : null);
    } finally {
      setLoading(false);
    }
  }, [ids]);

  useEffect(() => {
    load();
  }, [load]);

  function remove(id: string) {
    setIds((prev) => {
      const next = prev.filter((x) => x !== id);
      saveCompareIds(next);
      return next;
    });
  }

  function clearAll() {
    setIds([]);
    clearCompareIds();
  }

  return (
    <div className="container">
      <div className="section-h">
        <h1 className="section-h__title">IHKs vergleichen</h1>
        {ids.length > 0 && (
          <button className="btn btn--sm" onClick={clearAll}>
            Alle entfernen
          </button>
        )}
      </div>

      {ids.length === 0 && !loading ? (
        <EmptyState
          title="Keine IHKs zum Vergleichen ausgewählt"
          text="Gehe zur Übersicht und wähle bis zu 4 IHKs über das ‹+› Symbol aus."
          onReset={undefined}
          resetLabel=""
        />
      ) : loading ? (
        <SkeletonGrid count={3} />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
        <>
          <div style={{ marginBottom: 16 }}>
            {ihks.map((i) => (
              <span
                key={i.id}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  background: "var(--primary-soft)",
                  border: "1px solid var(--primary)",
                  borderRadius: 999,
                  padding: "4px 8px 4px 12px",
                  marginRight: 8,
                  marginBottom: 8,
                  fontSize: "0.9rem",
                  color: "var(--primary)",
                  fontWeight: 500,
                }}
              >
                {i.ihkShortName}
                <button
                  onClick={() => remove(i.id)}
                  aria-label={`${i.ihkShortName} entfernen`}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--primary)",
                    cursor: "pointer",
                    fontWeight: 700,
                    fontSize: "0.9rem",
                  }}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
          <ComparisonTable ihks={ihks} />
        </>
      )}

      <p style={{ marginTop: 20 }}>
        <Link href="/">← Zurück zur Übersicht</Link>
      </p>
    </div>
  );
}
