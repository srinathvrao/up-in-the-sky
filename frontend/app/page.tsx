"use client";

import { useState } from "react";
import { FlightMap } from "@/app/components/FlightMap/FlightMap";
import { ChatPanel } from "@/app/components/Chat/ChatPanel";

export default function Home() {
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-gray-800 bg-gray-900 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xl">✈</span>
          <span className="font-bold text-lg tracking-tight">FlightTracker</span>
          <span className="text-gray-600 text-xs ml-1 hidden sm:inline">Live ADS-B</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-xs text-gray-600 hidden sm:block">Up in the Sky</div>
          {/* Chat toggle — mobile only */}
          <button
            className="md:hidden flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium transition-colors"
            onClick={() => setChatOpen((o) => !o)}
            aria-label="Toggle chat"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.77 9.77 0 01-4-.84L3 20l1.09-3.27A7.93 7.93 0 013 12C3 7.582 7.03 4 12 4s9 3.582 9 8z" />
            </svg>
            {chatOpen ? "Map" : "Chat"}
          </button>
        </div>
      </header>

      {/* Main split panel */}
      <main className="flex flex-1 overflow-hidden relative">
        {/* Flight Map — always visible, full width on mobile */}
        <section className="flex-1 md:border-r md:border-gray-800 overflow-hidden">
          <FlightMap />
        </section>

        {/* Chat — sidebar on desktop, slide-over on mobile */}
        <section
          className={[
            "overflow-hidden flex-shrink-0",
            // desktop: static sidebar
            "md:w-[420px] md:relative md:translate-x-0",
            // mobile: fixed full-width slide-over from right
            "max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:w-full max-md:z-50 max-md:transition-transform max-md:duration-300",
            chatOpen ? "max-md:translate-x-0" : "max-md:translate-x-full",
          ].join(" ")}
        >
          {/* Mobile close strip — tap anywhere outside closes the panel */}
          {chatOpen && (
            <div
              className="md:hidden absolute inset-0 -left-8 w-8 cursor-pointer"
              onClick={() => setChatOpen(false)}
            />
          )}
          <ChatPanel />
        </section>
      </main>
    </div>
  );
}
