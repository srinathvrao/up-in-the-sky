interface Props {
  toolName: string;
}

const TOOL_LABELS: Record<string, string> = {
  get_aircraft_position: "Looking up aircraft position…",
  get_aircraft_nearby: "Scanning nearby aircraft…",
};

export function ToolIndicator({ toolName }: Props) {
  const label = TOOL_LABELS[toolName] ?? "Looking up aircraft data…";
  return (
    <div className="flex items-center gap-2 text-xs text-blue-400 px-3 py-1.5 bg-blue-950/40 rounded-md w-fit">
      <span className="flex gap-0.5">
        <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce [animation-delay:0ms]" />
        <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce [animation-delay:150ms]" />
        <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce [animation-delay:300ms]" />
      </span>
      {label}
    </div>
  );
}
