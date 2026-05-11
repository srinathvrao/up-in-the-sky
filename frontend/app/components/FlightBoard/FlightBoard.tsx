"use client";

import { useWebSocket } from "@/app/hooks/useWebSocket";
import { AircraftRow } from "./AircraftRow";

const WS_URL = process.env.NEXT_PUBLIC_API_WS_URL;

export function FlightBoard() {
  const { aircraft, status } = useWebSocket(WS_URL);

  const sorted = Array.from(aircraft.values()).sort((a, b) => b.altitude - a.altitude);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <h2 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">
          Live Aircraft
        </h2>
        <StatusPill status={status} count={sorted.length} />
      </div>

      {status === "reconnecting" && (
        <div className="bg-yellow-900/50 border-b border-yellow-700 px-4 py-2 text-yellow-300 text-xs flex items-center gap-2">
          <span className="animate-pulse">●</span> Reconnecting to live feed…
        </div>
      )}

      {!WS_URL && (
        <div className="bg-orange-900/40 border-b border-orange-700 px-4 py-2 text-orange-300 text-xs">
          NEXT_PUBLIC_API_WS_URL not set — showing mock data
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <EmptyState status={status} hasUrl={!!WS_URL} />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase tracking-wider border-b border-gray-700">
                <th className="px-4 py-2">Callsign</th>
                <th className="px-4 py-2">Altitude</th>
                <th className="px-4 py-2">Speed</th>
                <th className="px-4 py-2">Heading</th>
                <th className="px-4 py-2">Position</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((ac) => (
                <AircraftRow key={ac.icao24} aircraft={ac} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status, count }: { status: string; count: number }) {
  const colors = {
    connected: "bg-green-900 text-green-300",
    reconnecting: "bg-yellow-900 text-yellow-300",
    disconnected: "bg-gray-800 text-gray-400",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[status as keyof typeof colors]}`}>
      {status === "connected" ? `${count} aircraft` : status}
    </span>
  );
}

function EmptyState({ status, hasUrl }: { status: string; hasUrl: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2 p-8">
      <span className="text-4xl">✈</span>
      {!hasUrl ? (
        <p className="text-sm text-center">Configure NEXT_PUBLIC_API_WS_URL to see live aircraft</p>
      ) : status === "connected" ? (
        <p className="text-sm">Waiting for aircraft data…</p>
      ) : (
        <p className="text-sm">Connecting to live feed…</p>
      )}
    </div>
  );
}
