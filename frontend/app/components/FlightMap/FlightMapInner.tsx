"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { MapContainer, TileLayer, useMapEvents } from "react-leaflet";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";

interface AircraftData {
  icao24: string;
  callsign: string;
  lat: number;
  lon: number;
  altitude: number;
  groundSpeed: number;
  track: number;
  onGround: boolean;
  updatedAt: string;
}

// ── plane icon, pointed in direction of travel ────────────────────────────────
function altitudeColor(altitude: number, onGround: boolean): string {
  if (onGround) return "#9ca3af";
  if (altitude < 5000)  return "#fbbf24";
  if (altitude < 15000) return "#fb923c";
  if (altitude < 30000) return "#60a5fa";
  return "#c084fc";
}

function planeIcon(track: number, onGround: boolean, altitude: number): L.DivIcon {
  const color = altitudeColor(altitude, onGround);
  // single cohesive top-down silhouette: swept wings + integrated tail fins
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"
    style="transform:rotate(${track}deg);filter:drop-shadow(0 1px 3px rgba(0,0,0,.8))">
    <path fill="${color}" d="M12 1 L13.5 9 L22 12 L13.5 14 L13 18 L17 23 L13 21 L12 22 L11 21 L7 23 L11 18 L10.5 14 L2 12 L10.5 9 Z"/>
  </svg>`;
  return L.divIcon({ html: svg, className: "", iconSize: [24, 24], iconAnchor: [12, 12] });
}

// ── fetch aircraft for a bounding box ────────────────────────────────────────
async function fetchAircraft(
  apiUrl: string,
  bounds: L.LatLngBounds,
): Promise<AircraftData[]> {
  const params = new URLSearchParams({
    min_lat: bounds.getSouth().toFixed(6),
    max_lat: bounds.getNorth().toFixed(6),
    min_lon: bounds.getWest().toFixed(6),
    max_lon: bounds.getEast().toFixed(6),
  });
  const res = await fetch(`${apiUrl}/aircraft?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json.aircraft as AircraftData[];
}

// ── imperative marker layer ───────────────────────────────────────────────────
function MarkersLayer({ aircraft }: { aircraft: Map<string, AircraftData> }) {
  const map = useMapEvents({});
  const markers = useRef<Map<string, L.Marker>>(new Map());

  useEffect(() => {
    const visible = new Set(aircraft.keys());

    // remove departed aircraft
    markers.current.forEach((m, id) => {
      if (!visible.has(id)) { m.remove(); markers.current.delete(id); }
    });

    // add / update
    aircraft.forEach((ac) => {
      const latlng: L.LatLngTuple = [ac.lat, ac.lon];
      const icon = planeIcon(ac.track, ac.onGround, ac.altitude);
      const popup = `
        <div style="font:12px/1.7 monospace;min-width:160px">
          <b style="font-size:13px">${ac.callsign || ac.icao24}</b><br>
          ${ac.onGround ? "<em>On ground</em>" : `${(ac.altitude ?? 0).toLocaleString()} ft`}<br>
          ${ac.groundSpeed ?? 0} kts &nbsp;·&nbsp; ${ac.track ?? 0}°<br>
          <span style="color:#9ca3af;font-size:11px">${ac.icao24}</span>
        </div>`;

      const existing = markers.current.get(ac.icao24);
      if (existing) {
        existing.setLatLng(latlng).setIcon(icon);
        existing.getPopup()?.setContent(popup);
      } else {
        const m = L.marker(latlng, { icon })
          .bindPopup(popup, { closeButton: false, maxWidth: 220 })
          .addTo(map);
        markers.current.set(ac.icao24, m);
      }
    });
  }, [aircraft, map]);

  useEffect(() => () => { markers.current.forEach((m) => m.remove()); }, []);

  return null;
}

// ── fires fetch on pan/zoom end ───────────────────────────────────────────────
function BoundsWatcher({ onBoundsChange }: { onBoundsChange: (b: L.LatLngBounds) => void }) {
  const map = useMapEvents({
    moveend: () => onBoundsChange(map.getBounds()),
    zoomend: () => onBoundsChange(map.getBounds()),
  });
  // fire once on mount to load initial view
  useEffect(() => { onBoundsChange(map.getBounds()); }, [map, onBoundsChange]);
  return null;
}

// ── status bar ────────────────────────────────────────────────────────────────
type LoadState = "idle" | "loading" | "error";

function StatusBar({ count, state }: { count: number; state: LoadState }) {
  const cls =
    state === "loading" ? "bg-blue-950/90 text-blue-300 border-blue-800" :
    state === "error"   ? "bg-red-950/90 text-red-300 border-red-800" :
                          "bg-gray-900/90 text-gray-300 border-gray-700";
  return (
    <div className={`absolute top-3 left-3 z-[1000] flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium ${cls}`}>
      {state === "loading" && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />}
      {state === "idle"    && <span className="w-1.5 h-1.5 rounded-full bg-green-400" />}
      {state === "error"   && <span className="w-1.5 h-1.5 rounded-full bg-red-400" />}
      {state === "loading" ? "Loading…" : state === "error" ? "Fetch error" : `${count} aircraft in view`}
    </div>
  );
}

// ── root ──────────────────────────────────────────────────────────────────────
const NYC: L.LatLngTuple = [40.7128, -74.006];
const REFRESH_MS = 8000;

export default function FlightMapInner({ apiUrl }: { apiUrl: string }) {
  const [aircraft, setAircraft] = useState<Map<string, AircraftData>>(new Map());
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const boundsRef = useRef<L.LatLngBounds | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (bounds: L.LatLngBounds) => {
    if (!apiUrl) return;
    setLoadState("loading");
    try {
      const data = await fetchAircraft(apiUrl, bounds);
      const map = new Map<string, AircraftData>();
      data.forEach((ac) => map.set(ac.icao24, ac));
      setAircraft(map);
      setLoadState("idle");
    } catch (e) {
      console.error("aircraft fetch:", e);
      setLoadState("error");
    }
  }, [apiUrl]);

  const onBoundsChange = useCallback((bounds: L.LatLngBounds) => {
    boundsRef.current = bounds;
    if (timerRef.current) clearTimeout(timerRef.current);
    load(bounds);
    // schedule periodic refresh for the current view
    const schedule = () => {
      timerRef.current = setTimeout(async () => {
        if (boundsRef.current) await load(boundsRef.current);
        schedule();
      }, REFRESH_MS);
    };
    schedule();
  }, [load]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <div className="relative w-full h-full">
      <StatusBar count={aircraft.size} state={loadState} />
      <MapContainer center={NYC} zoom={10} className="w-full h-full" zoomControl={false}>
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com">CARTO</a>'
          maxZoom={19}
        />
        <BoundsWatcher onBoundsChange={onBoundsChange} />
        <MarkersLayer aircraft={aircraft} />
      </MapContainer>
    </div>
  );
}
