"use client";

import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, useMapEvents } from "react-leaflet";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { AircraftData } from "@/app/hooks/useWebSocket";

// ── plane SVG icon, pointed in direction of travel ────────────────────────────
function planeIcon(track: number, onGround: boolean): L.DivIcon {
  const color = onGround ? "#6b7280" : "#60a5fa";
  // SVG drawn nose-up (0°), CSS rotate aligns it to track heading
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20"
    style="transform:rotate(${track}deg);filter:drop-shadow(0 1px 3px rgba(0,0,0,.7))">
    <path fill="${color}" d="M12 2L8.5 10H3l2 2 4-.5V17l-3 1.5V20l6-1.5 6 1.5v-1.5L18 17v-5.5l4 .5 2-2h-5.5L12 2z"/>
  </svg>`;
  return L.divIcon({ html: svg, className: "", iconSize: [20, 20], iconAnchor: [10, 10] });
}

// ── imperative marker layer — no React component per aircraft ─────────────────
function MarkersLayer({ aircraft, bounds }: { aircraft: Map<string, AircraftData>; bounds: L.LatLngBounds | null }) {
  const map = useMapEvents({});
  const markers = useRef<Map<string, L.Marker>>(new Map());

  useEffect(() => {
    const visible = new Set<string>();
    aircraft.forEach((ac) => {
      if (bounds && !bounds.contains([ac.lat, ac.lon])) return;
      visible.add(ac.icao24);

      const latlng: L.LatLngTuple = [ac.lat, ac.lon];
      const icon = planeIcon(ac.track, ac.onGround);
      const popupHtml = `
        <div style="font:12px/1.7 monospace;min-width:140px">
          <b style="font-size:13px">${ac.callsign || ac.icao24}</b><br>
          ${ac.onGround ? "<em>On ground</em>" : `${ac.altitude.toLocaleString()} ft`}<br>
          ${ac.groundSpeed} kts &nbsp;·&nbsp; ${ac.track}°<br>
          <span style="color:#9ca3af;font-size:11px">${ac.icao24}</span>
        </div>`;

      const existing = markers.current.get(ac.icao24);
      if (existing) {
        existing.setLatLng(latlng).setIcon(icon);
        existing.getPopup()?.setContent(popupHtml);
      } else {
        const m = L.marker(latlng, { icon })
          .bindPopup(popupHtml, { closeButton: false, maxWidth: 220 })
          .addTo(map);
        markers.current.set(ac.icao24, m);
      }
    });

    // remove markers that left bounds or disappeared
    markers.current.forEach((m, id) => {
      if (!visible.has(id)) { m.remove(); markers.current.delete(id); }
    });
  }, [aircraft, bounds, map]);

  useEffect(() => () => { markers.current.forEach((m) => m.remove()); }, []);

  return null;
}

// ── fires onBoundsChange whenever the map is moved or zoomed ──────────────────
function BoundsTracker({ onChange }: { onChange: (b: L.LatLngBounds) => void }) {
  const map = useMapEvents({
    moveend: () => onChange(map.getBounds()),
    zoomend: () => onChange(map.getBounds()),
  });
  useEffect(() => { onChange(map.getBounds()); }, [map, onChange]);
  return null;
}

// ── top-left status pill ──────────────────────────────────────────────────────
function StatusPill({ status, count }: { status: string; count: number }) {
  const cls =
    status === "connected"   ? "bg-green-950/90 text-green-300 border-green-800" :
    status === "reconnecting"? "bg-yellow-950/90 text-yellow-300 border-yellow-800" :
                               "bg-gray-900/90 text-gray-400 border-gray-700";
  return (
    <div className={`absolute top-3 left-3 z-[1000] flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${status === "connected" ? "bg-green-400 animate-pulse" : status === "reconnecting" ? "bg-yellow-400 animate-pulse" : "bg-gray-500"}`} />
      {status === "connected" ? `${count} aircraft in view` : status === "reconnecting" ? "Reconnecting…" : "Disconnected"}
    </div>
  );
}

// ── root export ───────────────────────────────────────────────────────────────
const NYC: L.LatLngTuple = [40.7128, -74.006];

export default function FlightMapInner({ aircraft, status }: { aircraft: Map<string, AircraftData>; status: string }) {
  const [bounds, setBounds] = useState<L.LatLngBounds | null>(null);

  const visibleCount = bounds
    ? Array.from(aircraft.values()).filter((ac) => bounds.contains([ac.lat, ac.lon])).length
    : aircraft.size;

  return (
    <div className="relative w-full h-full">
      <StatusPill status={status} count={visibleCount} />
      <MapContainer center={NYC} zoom={10} className="w-full h-full" zoomControl={false}>
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com">CARTO</a>'
          maxZoom={19}
        />
        <BoundsTracker onChange={setBounds} />
        <MarkersLayer aircraft={aircraft} bounds={bounds} />
      </MapContainer>
    </div>
  );
}
