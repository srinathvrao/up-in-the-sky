"use client";

import { useEffect, useRef, useState } from "react";
import type { AircraftData } from "@/app/hooks/useWebSocket";
import { AltitudeBadge } from "./AltitudeBadge";

interface Props {
  aircraft: AircraftData;
}

function trackArrow(track: number): string {
  const dirs = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];
  return dirs[Math.round(track / 45) % 8];
}

export function AircraftRow({ aircraft }: Props) {
  const [flash, setFlash] = useState(false);
  const prevRef = useRef<AircraftData | null>(null);

  useEffect(() => {
    if (prevRef.current && prevRef.current.updatedAt !== aircraft.updatedAt) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 800);
      return () => clearTimeout(t);
    }
    prevRef.current = aircraft;
  }, [aircraft]);

  return (
    <tr
      className={`border-b border-gray-700 transition-colors duration-700 ${
        flash ? "bg-blue-950" : "bg-transparent"
      } hover:bg-gray-800`}
    >
      <td className="px-4 py-2 font-mono font-semibold text-white">
        {aircraft.callsign || aircraft.icao24}
      </td>
      <td className="px-4 py-2">
        <AltitudeBadge altitude={aircraft.altitude} onGround={aircraft.onGround} />
      </td>
      <td className="px-4 py-2 text-gray-300 text-sm">
        {aircraft.onGround ? "—" : `${aircraft.groundSpeed} kts`}
      </td>
      <td className="px-4 py-2 text-gray-400 text-sm">
        {aircraft.onGround ? "—" : (
          <span title={`${aircraft.track}°`}>
            {trackArrow(aircraft.track)} {aircraft.track}°
          </span>
        )}
      </td>
      <td className="px-4 py-2 text-gray-500 text-xs">
        {aircraft.lat.toFixed(2)}, {aircraft.lon.toFixed(2)}
      </td>
    </tr>
  );
}
