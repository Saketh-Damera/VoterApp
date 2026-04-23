"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MapVoter } from "./page";

type RadiusResult = MapVoter & { distance_mi: number; has_interaction: boolean };

export default function MapClient({
  initialVoters,
  ungeocoded,
}: {
  initialVoters: MapVoter[];
  ungeocoded: number;
}) {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const layerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const radiusLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const [leafletReady, setLeafletReady] = useState(false);

  const [party, setParty] = useState("");
  const [sentimentFilter, setSentimentFilter] = useState("");

  const [radiusMode, setRadiusMode] = useState(false);
  const [radiusMiles, setRadiusMiles] = useState(0.25);
  const [radiusResults, setRadiusResults] = useState<RadiusResult[] | null>(null);
  const [radiusCenter, setRadiusCenter] = useState<[number, number] | null>(null);
  const [radiusParty, setRadiusParty] = useState("");
  const [radiusContactedOnly, setRadiusContactedOnly] = useState(false);
  const [loadingRadius, setLoadingRadius] = useState(false);

  const [geocoding, setGeocoding] = useState(false);

  const parties = useMemo(() => {
    return Array.from(new Set(initialVoters.map((v) => v.party_cd).filter(Boolean))) as string[];
  }, [initialVoters]);

  const visibleVoters = useMemo(() => {
    return initialVoters.filter((v) => {
      if (party && v.party_cd !== party) return false;
      if (sentimentFilter && v.last_sentiment !== sentimentFilter) return false;
      return true;
    });
  }, [initialVoters, party, sentimentFilter]);

  // Dynamically load leaflet (avoids SSR issues)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = await import("leaflet");
      await import("leaflet/dist/leaflet.css");
      if (cancelled || !mapDivRef.current || mapRef.current) return;

      // Initial center: median of voters if any, else Durham NC default
      let center: [number, number] = [35.994, -78.898];
      if (initialVoters.length > 0) {
        const lats = initialVoters.map((v) => v.lat).sort((a, b) => a - b);
        const lngs = initialVoters.map((v) => v.lng).sort((a, b) => a - b);
        const mid = Math.floor(initialVoters.length / 2);
        center = [lats[mid], lngs[mid]];
      }

      const map = L.map(mapDivRef.current).setView(center, 13);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);

      mapRef.current = map;
      layerRef.current = L.layerGroup().addTo(map);
      radiusLayerRef.current = L.layerGroup().addTo(map);

      map.on("click", (e: import("leaflet").LeafletMouseEvent) => {
        // radiusMode is stale in closure; read via ref-like state
        setRadiusCenter([e.latlng.lat, e.latlng.lng]);
      });

      setLeafletReady(true);
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [initialVoters]);

  // Render markers
  useEffect(() => {
    if (!leafletReady) return;
    (async () => {
      const L = await import("leaflet");
      if (!layerRef.current) return;
      layerRef.current.clearLayers();
      for (const v of visibleVoters) {
        const color = sentimentColor(v.last_sentiment);
        const m = L.circleMarker([v.lat, v.lng], {
          radius: 7,
          color: "#fff",
          weight: 1.5,
          fillColor: color,
          fillOpacity: 0.85,
        });
        const name = [v.first_name, v.last_name].filter(Boolean).join(" ") || "(no name)";
        const popup = `
          <div style="font-family: inherit;">
            <a href="/people/${v.ncid}" style="color: #1E3A8A; font-weight: 600;">${escapeHtml(name)}</a>
            <div style="font-size: 11px; color: #64748B;">${escapeHtml(v.res_street_address ?? "")}${v.res_city ? ", " + escapeHtml(v.res_city) : ""}</div>
            <div style="font-size: 11px; color: #64748B;">${v.party_cd ?? ""}${v.last_sentiment ? " · " + v.last_sentiment.replace(/_/g, " ") : ""}</div>
          </div>
        `;
        m.bindPopup(popup);
        m.addTo(layerRef.current);
      }
    })();
  }, [leafletReady, visibleVoters]);

  // Radius circle + results
  useEffect(() => {
    if (!leafletReady) return;
    (async () => {
      const L = await import("leaflet");
      if (!radiusLayerRef.current) return;
      radiusLayerRef.current.clearLayers();
      if (radiusCenter) {
        const [lat, lng] = radiusCenter;
        L.circleMarker([lat, lng], {
          radius: 6,
          color: "#DC2626",
          fillColor: "#DC2626",
          fillOpacity: 1,
        }).addTo(radiusLayerRef.current);
        L.circle([lat, lng], {
          radius: radiusMiles * 1609.344,
          color: "#DC2626",
          fillColor: "#DC2626",
          fillOpacity: 0.05,
          weight: 1,
        }).addTo(radiusLayerRef.current);
        if (radiusResults) {
          for (const r of radiusResults) {
            L.circleMarker([r.lat, r.lng], {
              radius: 5,
              color: r.has_interaction ? "#047857" : "#64748B",
              fillColor: r.has_interaction ? "#047857" : "#CBD5E1",
              fillOpacity: 0.9,
              weight: 1,
            }).addTo(radiusLayerRef.current);
          }
        }
      }
    })();
  }, [leafletReady, radiusCenter, radiusMiles, radiusResults]);

  async function runRadius() {
    if (!radiusCenter) return;
    setLoadingRadius(true);
    setRadiusResults(null);
    const [lat, lng] = radiusCenter;
    const res = await fetch("/api/map/radius", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lat,
        lng,
        miles: radiusMiles,
        party: radiusParty || null,
        contacted_only: radiusContactedOnly,
      }),
    });
    const json = await res.json();
    setLoadingRadius(false);
    setRadiusResults(json.voters ?? []);
  }

  async function geocodeMore() {
    setGeocoding(true);
    await fetch("/api/geocode/contacted?limit=25", { method: "POST" });
    setGeocoding(false);
    window.location.reload();
  }

  return (
    <div className="space-y-3">
      {ungeocoded > 0 && (
        <div className="card flex flex-wrap items-center justify-between gap-2 bg-[var(--color-surface-muted)] p-3 text-sm">
          <span className="text-[var(--color-ink-muted)]">
            {ungeocoded} contacted voters don't have coordinates yet.
          </span>
          <button onClick={geocodeMore} disabled={geocoding} className="btn-secondary text-xs">
            {geocoding ? "Geocoding…" : "Geocode next 25"}
          </button>
        </div>
      )}

      <div className="card flex flex-wrap items-end gap-3 p-3">
        <label className="flex flex-col gap-1">
          <span className="text-[0.6875rem] uppercase tracking-wide text-[var(--color-ink-subtle)]">Party</span>
          <select value={party} onChange={(e) => setParty(e.target.value)} className="input !py-2">
            <option value="">All</option>
            {parties.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[0.6875rem] uppercase tracking-wide text-[var(--color-ink-subtle)]">Sentiment</span>
          <select value={sentimentFilter} onChange={(e) => setSentimentFilter(e.target.value)} className="input !py-2">
            <option value="">All</option>
            <option value="supportive">Supportive</option>
            <option value="leaning_supportive">Leaning supportive</option>
            <option value="undecided">Undecided</option>
            <option value="leaning_opposed">Leaning opposed</option>
            <option value="opposed">Opposed</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={radiusMode} onChange={(e) => {
            setRadiusMode(e.target.checked);
            if (!e.target.checked) {
              setRadiusCenter(null);
              setRadiusResults(null);
            }
          }} />
          <span className="text-sm">Radius search (click map to set center)</span>
        </label>
      </div>

      {radiusMode && (
        <div className="card flex flex-wrap items-end gap-3 p-3">
          <label className="flex flex-col gap-1">
            <span className="text-[0.6875rem] uppercase tracking-wide text-[var(--color-ink-subtle)]">Miles</span>
            <input
              type="number"
              step="0.05"
              min="0.05"
              max="10"
              value={radiusMiles}
              onChange={(e) => setRadiusMiles(parseFloat(e.target.value))}
              className="input !py-2 w-24"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[0.6875rem] uppercase tracking-wide text-[var(--color-ink-subtle)]">Party filter</span>
            <select value={radiusParty} onChange={(e) => setRadiusParty(e.target.value)} className="input !py-2">
              <option value="">All</option>
              {parties.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={radiusContactedOnly} onChange={(e) => setRadiusContactedOnly(e.target.checked)} />
            <span className="text-sm">Only contacted</span>
          </label>
          <button onClick={runRadius} disabled={!radiusCenter || loadingRadius} className="btn-primary">
            {loadingRadius ? "Searching…" : radiusCenter ? "Search" : "Click map to place center"}
          </button>
          {radiusResults && (
            <span className="text-sm text-[var(--color-ink-muted)]">
              {radiusResults.length} within {radiusMiles} mi
            </span>
          )}
        </div>
      )}

      <div ref={mapDivRef} className="h-[calc(100dvh-360px)] min-h-[400px] w-full overflow-hidden rounded-md border border-[var(--color-border)]" />

      {radiusResults && radiusResults.length > 0 && (
        <details className="card p-3 text-sm">
          <summary className="cursor-pointer font-medium">
            {radiusResults.length} voters within {radiusMiles} mi
          </summary>
          <ul className="mt-2 divide-y divide-[var(--color-border)]">
            {radiusResults.slice(0, 100).map((r) => (
              <li key={r.ncid} className="flex items-baseline justify-between gap-3 py-1.5">
                <a href={`/people/${r.ncid}`} className="truncate hover:text-[var(--color-primary)]">
                  {[r.first_name, r.last_name].filter(Boolean).join(" ")}
                  <span className="ml-2 text-xs text-[var(--color-ink-subtle)]">
                    {r.res_street_address}
                  </span>
                </a>
                <span className="shrink-0 text-xs text-[var(--color-ink-subtle)]">
                  {r.distance_mi.toFixed(2)} mi · {r.party_cd ?? "—"}{r.has_interaction ? " · talked" : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function sentimentColor(s: string | null): string {
  switch (s) {
    case "supportive":
    case "leaning_supportive":
      return "#047857";
    case "opposed":
    case "leaning_opposed":
      return "#B91C1C";
    case "undecided":
      return "#B45309";
    default:
      return "#64748B";
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return map[c];
  });
}
