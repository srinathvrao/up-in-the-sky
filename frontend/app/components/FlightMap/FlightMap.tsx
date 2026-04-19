"use client";

import dynamic from "next/dynamic";
import { useWebSocket } from "@/app/hooks/useWebSocket";

const FlightMapInner = dynamic(() => import("./FlightMapInner"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center w-full h-full bg-gray-950 text-gray-600 text-sm">
      Loading map…
    </div>
  ),
});

const WS_URL = process.env.NEXT_PUBLIC_API_WS_URL;

export function FlightMap() {
  const { aircraft, status } = useWebSocket(WS_URL);
  return <FlightMapInner aircraft={aircraft} status={status} />;
}
