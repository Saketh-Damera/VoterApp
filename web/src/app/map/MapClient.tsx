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

  // Geographic clusters (DBSCAN)
  const [showClusters, setShowClusters] = useState(false);
  const [clusterEps, setClusterEps] = useState(150);
  const [clusters, setClusters] = useState<
    Array<{
      cluster_id: number;
      people_count: number;
      centroid_lat: number;
      centroid_lng: number;
      members: Array<{
        ncid: string;
        first_name: string | null;
        last_name: string | null;
        address: string | null;
        city: string | null;
        party: string | null;
        sentiment: string | null;
        lat: number;
        lng: number;
      }>;
    }> | null
  >(null);
  const [loadingClusters, setLoadingClusters] = useState(false);
  const clusterLayerRef = useRef<import("leaflet").LayerGroup | null>(null);

  // Keep a live ref to radiusMode so the Leaflet click handler sees the
  // current value rather than the initial closure.
  const radiusModeRef = useRef(radiusMode);
  useEffect(() => {
    radiusModeRef.current = radiusMode;
  }, [radiusMode]);

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

      // Default center (Durham NC). If we have voters, we fit to them after.
      const map = L.map(mapDivRef.current).setView([35.994, -78.898], 13);
      if (initialVoters.length > 0) {
        const bounds = L.latLngBounds(initialVoters.map((v) => L.latLng(v.lat, v.lng)));
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
      }
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);

      mapRef.current = map;
      layerRef.current = L.layerGroup().addTo(map);
      radiusLayerRef.current = L.layerGroup().addTo(map);
      clusterLayerRef.current = L.layerGroup().addTo(map);

      map.on("click", (e: import("leaflet").LeafletMouseEvent) => {
        if (!radiusModeRef.current) return;
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

  // Render markers — teardrop-style divIcon pins so they read at any zoom.
  useEffect(() => {
    if (!leafletReady) return;
    (async () => {
      const L = await import("leaflet");
      if (!layerRef.current) return;
      layerRef.current.clearLayers();
      for (const v of visibleVoters) {
        const color = sentimentColor(v.last_sentiment);
        const icon = L.divIcon({
          className: "jed-pin",
          html: `<div style="
            width:22px;height:28px;position:relative;
            filter:drop-shadow(0 2px 3px rgba(15,23,42,.35));
          ">
            <div style="
              width:22px;height:22px;border-radius:50%;
              background:${color};border:3px solid #fff;
            "></div>
            <div style="
              position:absolute;top:17px;left:7px;
              width:0;height:0;
              border-left:4px solid transparent;
              border-right:4px solid transparent;
              border-top:8px solid ${color};
            "></div>
          </div>`,
          iconSize: [22, 28],
          iconAnchor: [11, 28],
          popupAnchor: [0, -24],
        });
        const m = L.marker([v.lat, v.lng], { icon, title: [v.first_name, v.last_name].filter(Boolean).join(" ") });
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

  async function fitToContacted() {
    if (!mapRef.current || visibleVoters.length === 0) return;
    const L = await import("leaflet");
    const latlngs = visibleVoters.map((v) => L.latLng(v.lat, v.lng));
    const bounds = L.latLngBounds(latlngs);
    mapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
  }

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

  async function loadClusters() {
    setLoadingClusters(true);
    const res = await fetch(`/api/map/clusters?eps=${clusterEps}`);
    const json = await res.json();
    setLoadingClusters(false);
    setClusters(json.clusters ?? []);
  }

  // Render cluster polygons + centroids
  useEffect(() => {
    if (!leafletReady) return;
    (async () => {
      const L = await import("leaflet");
      if (!clusterLayerRef.current) return;
      clusterLayerRef.current.clearLayers();
      if (!showClusters || !clusters) return;

      const palette = ["#2563EB", "#B45309", "#047857", "#B91C1C", "#7C3AED", "#DB2777", "#0891B2"];

      for (const c of clusters) {
        const color = palette[c.cluster_id % palette.length];
        // Draw each member as a filled circle; draw centroid as a number badge
        for (const m of c.members) {
          L.circleMarker([m.lat, m.lng], {
            radius: 7,
            color: "#fff",
            weight: 2,
            fillColor: color,
            fillOpacity: 0.9,
          })
            .bindPopup(`
              <div style="font-family: inherit;">
                <a href="/people/${m.ncid}" style="color: #1E3A8A; font-weight: 600;">
                  ${escapeHtml([m.first_name, m.last_name].filter(Boolean).join(" "))}
                </a>
                <div style="font-size: 11px; color: #64748B;">${escapeHtml(m.address ?? "")}${m.city ? ", " + escapeHtml(m.city) : ""}</div>
                <div style="font-size: 11px; color: ${color}; font-weight: 600;">Cluster ${c.cluster_id + 1} · ${c.people_count} people</div>
              </div>
            `)
            .addTo(clusterLayerRef.current!);
        }
        // Centroid badge
        const badge = L.divIcon({
          className: "jed-cluster-badge",
          html: `<div style="background:${color};color:#fff;font-weight:700;font-size:12px;border-radius:12px;padding:2px 7px;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.25);">${c.people_count}</div>`,
          iconSize: [24, 20],
          iconAnchor: [12, 10],
        });
        L.marker([c.centroid_lat, c.centroid_lng], { icon: badge }).addTo(clusterLayerRef.current!);
      }
    })();
  }, [leafletReady, showClusters, clusters]);

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
            {geocoding ? "Geocoding..." : "Geocode next 25"}
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
        <button
          onClick={fitToContacted}
          disabled={visibleVoters.length === 0}
          className="btn-secondary text-xs"
          title="Zoom to the voters you've contacted"
        >
          Zoom to my voters
        </button>

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

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={showClusters}
            onChange={(e) => {
              setShowClusters(e.target.checked);
              if (e.target.checked && !clusters) loadClusters();
            }}
          />
          <span className="text-sm">Proximity clusters</span>
        </label>
        {showClusters && (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-[0.6875rem] uppercase tracking-wide text-[var(--color-ink-subtle)]">
                Max distance (m)
              </span>
              <input
                type="number"
                min={30}
                max={2000}
                step={10}
                value={clusterEps}
                onChange={(e) => setClusterEps(parseInt(e.target.value || "150", 10))}
                onBlur={loadClusters}
                className="input !py-2 w-24"
              />
            </label>
            <button onClick={loadClusters} disabled={loadingClusters} className="btn-secondary text-xs">
              {loadingClusters ? "Loading..." : clusters ? "Recompute" : "Load"}
            </button>
          </>
        )}
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
            {loadingRadius ? "Searching..." : radiusCenter ? "Search" : "Click map to place center"}
          </button>
          {radiusResults && (
            <span className="text-sm text-[var(--color-ink-muted)]">
              {radiusResults.length} within {radiusMiles} mi
            </span>
          )}
        </div>
      )}

      <div ref={mapDivRef} className="h-[calc(100dvh-360px)] min-h-[400px] w-full overflow-hidden rounded-md border border-[var(--color-border)]" />

      {showClusters && clusters && clusters.length > 0 && (
        <details open className="card p-3 text-sm">
          <summary className="cursor-pointer font-medium">
            {clusters.length} proximity clusters · {clusters.reduce((a, c) => a + c.people_count, 0)} voters within {clusterEps}m of a neighbor
          </summary>
          <ul className="mt-3 space-y-3">
            {clusters.map((c) => (
              <li key={c.cluster_id} className="rounded-md border border-[var(--color-border)] p-3">
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="font-medium">Cluster {c.cluster_id + 1}</span>
                  <span className="chip chip-primary">{c.people_count} voters</span>
                </div>
                <ul className="space-y-1">
                  {c.members.map((m) => (
                    <li key={m.ncid} className="flex items-baseline justify-between gap-3 text-xs">
                      <a href={`/people/${m.ncid}`} className="hover:text-[var(--color-primary)]">
                        {[m.first_name, m.last_name].filter(Boolean).join(" ")}
                        <span className="ml-2 text-[var(--color-ink-subtle)]">
                          {m.address}{m.city ? ", " + m.city : ""}
                        </span>
                      </a>
                      <span className="shrink-0 text-[var(--color-ink-subtle)]">
                        {m.party ?? ""}{m.sentiment ? " · " + m.sentiment.replace(/_/g, " ") : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </details>
      )}

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
