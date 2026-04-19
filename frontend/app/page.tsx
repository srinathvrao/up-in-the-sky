import { FlightMap } from "@/app/components/FlightMap/FlightMap";
import { ChatPanel } from "@/app/components/Chat/ChatPanel";

export default function Home() {
  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-gray-800 bg-gray-900 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xl">✈</span>
          <span className="font-bold text-lg tracking-tight">FlightTracker</span>
          <span className="text-gray-600 text-xs ml-1 hidden sm:inline">Live ADS-B</span>
        </div>
        <div className="text-xs text-gray-600">Up in the Sky</div>
      </header>

      {/* Main split panel */}
      <main className="flex flex-1 overflow-hidden">
        {/* Flight Map — left panel */}
        <section className="flex-1 border-r border-gray-800 overflow-hidden">
          <FlightMap />
        </section>

        {/* Chat — right panel */}
        <section className="w-[420px] flex-shrink-0 overflow-hidden">
          <ChatPanel />
        </section>
      </main>
    </div>
  );
}
