"use client";

import dynamic from "next/dynamic";

const FlightMapInner = dynamic(() => import("./FlightMapInner"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center w-full h-full bg-gray-950 text-gray-600 text-sm">
      Loading map…
    </div>
  ),
});

const API_URL = process.env.NEXT_PUBLIC_API_HTTP_URL ?? "";

export function FlightMap() {
  return <FlightMapInner apiUrl={API_URL} />;
}
