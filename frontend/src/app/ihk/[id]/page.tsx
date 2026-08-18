"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiClientError, type IhkDetail } from "@/lib/api";
import { SkpBadge } from "@/components/Badge";
import { DisplayValue } from "@/components/display";
import { SkeletonGrid, SkeletonLine } from "@/components/Skeleton";
import { ErrorState } from "@/components/States";

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function InfoTile({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="info-tile">
      <div className="info-tile__label">{label}</div>
      <div className="info-tile__value">
        <DisplayValue value={value} />
      </div>
    </div>
  );
}

export default function IhkDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [ihk, setIhk] = useState<IhkDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setIhk(await api.ihkDetail(id));
    } catch (e: unknown) {
      const msg = e instanceof ApiClientError ? e.message : null;
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="container">
        <SkeletonLine width="30%" />
        <div style={{ height: 24 }} />
        <SkeletonLine width="60%" />
        <SkeletonLine width="40%" />
        <div style={{ height: 24 }} />
        <SkeletonGrid count={6} />
      </div>
    );
  }

  if (error || !ihk) {
    return (
      <div className="container">
        <ErrorState message={error ?? "IHK nicht gefunden."} onRetry={load} />
      </div>
    );
  }

  return (
    <div className="container" style={{ maxWidth: 900 }}>
      <Link href="/" className="detail-head__back">
        ← Zurück zur Übersicht
      </Link>

      <header className="detail-head">
        <h1 className="detail-head__name">{ihk.ihkShortName}</h1>
        <p className="detail-head__official">
          <DisplayValue value={ihk.officialName} />
        </p>
        <p className="detail-head__region">
          <DisplayValue value={ihk.bundesland} />
        </p>
        <div className="detail-meta">
          <SkpBadge value={ihk.skp} />
          <span>·</span>
          <span>Datenstand: <DisplayValue value={ihk.dataState} /></span>
          {ihk.lastUpdatedRaw && (
            <>
              <span>·</span>
              <span>Quelle aktualisiert: {ihk.lastUpdatedRaw}</span>
            </>
          )}
        </div>
      </header>

      <div className="section-h">
        <h2 className="section-h__title">Sachkundeprüfung</h2>
      </div>
      <div className="info-grid">
        <InfoTile label="SKP möglich" value={ihk.skp} />
        <InfoTile label="Schriftliche Prüfung" value={ihk.writtenForm} />
        <InfoTile label="Ergebnis sofort" value={ihk.writtenResultImmediate} />
        <InfoTile label="Gleicher Tag" value={ihk.sameDay} />
        <InfoTile label="Abstand schriftlich/mündlich" value={ihk.intervalWrittenOral} />
        <InfoTile label="Mündliche Prüfung" value={ihk.groupFormat} />
        <InfoTile label="Prüferanzahl" value={ihk.examinerCount} />
        <InfoTile label="Vorbereitung" value={ihk.vorbereitung} />
        <InfoTile label="Punktesystem" value={ihk.punktesystem} />
        <InfoTile label="Fallbeispiel" value={ihk.fallbeispiel} />
        <InfoTile label="Ko-Fallbeispiel" value={ihk.koFallbeispiel} />
        <InfoTile label="Notizen erlaubt" value={ihk.notizen} />
      </div>

      <div className="section-h" style={{ marginTop: 28 }}>
        <h2 className="section-h__title">Kontakt</h2>
      </div>
      <div className="info-grid">
        <InfoTile label="Bezirk" value={ihk.bezirk} />
        <InfoTile label="Adresse" value={ihk.adresse} />
        <InfoTile label="Telefon" value={ihk.telefon} />
        <InfoTile label="E-Mail" value={ihk.email} />
        <InfoTile label="Ansprechpartner" value={ihk.ansprechpartner} />
        <InfoTile label="Durchwahl" value={ihk.durchwahl} />
        {ihk.website && (
          <div className="info-tile">
            <div className="info-tile__label">Website</div>
            <div className="info-tile__value">
              <a href={ihk.website} target="_blank" rel="noopener noreferrer">
                {ihk.website.replace(/^https?:\/\//, "")}
              </a>
            </div>
          </div>
        )}
        {ihk.routeUrl && (
          <div className="info-tile">
            <div className="info-tile__label">Route</div>
            <div className="info-tile__value">
              <a href={ihk.routeUrl} target="_blank" rel="noopener noreferrer">
                Route planen →
              </a>
            </div>
          </div>
        )}
      </div>

      <p style={{ marginTop: 28, color: "var(--text-muted)", fontSize: "0.88rem" }}>
        Letzte Aktualisierung: {formatDateTime(ihk.importRun.startedAt)} Uhr
      </p>
    </div>
  );
}
