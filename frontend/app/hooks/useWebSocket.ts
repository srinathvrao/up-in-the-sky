"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export type WsStatus = "connected" | "reconnecting" | "disconnected";

export interface AircraftData {
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

interface AircraftUpdateEvent {
  type: "aircraft_update";
  data: AircraftData;
}

interface UseWebSocketReturn {
  aircraft: Map<string, AircraftData>;
  status: WsStatus;
}

const BACKOFF_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000];

export function useWebSocket(url: string | undefined): UseWebSocketReturn {
  const [aircraft, setAircraft] = useState<Map<string, AircraftData>>(new Map());
  const [status, setStatus] = useState<WsStatus>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);

  const connect = useCallback(() => {
    if (!url || unmountedRef.current) return;

    setStatus("reconnecting");
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (unmountedRef.current) { ws.close(); return; }
      attemptRef.current = 0;
      setStatus("connected");
    };

    ws.onmessage = (event) => {
      try {
        const msg: AircraftUpdateEvent = JSON.parse(event.data);
        if (msg.type === "aircraft_update") {
          setAircraft((prev) => {
            const next = new Map(prev);
            next.set(msg.data.icao24, msg.data);
            return next;
          });
        }
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      if (unmountedRef.current) return;
      setStatus("reconnecting");
      const delay = BACKOFF_DELAYS[Math.min(attemptRef.current, BACKOFF_DELAYS.length - 1)];
      attemptRef.current += 1;
      timerRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [url]);

  useEffect(() => {
    unmountedRef.current = false;
    if (url) connect();
    return () => {
      unmountedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, [url, connect]);

  return { aircraft, status };
}
