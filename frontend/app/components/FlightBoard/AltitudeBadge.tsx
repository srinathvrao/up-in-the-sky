interface Props {
  altitude: number;
  onGround: boolean;
}

export function AltitudeBadge({ altitude, onGround }: Props) {
  if (onGround) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-700 text-gray-300">
        GND
      </span>
    );
  }

  const { bg, text } =
    altitude >= 35000
      ? { bg: "bg-blue-900", text: "text-blue-300" }
      : altitude >= 20000
      ? { bg: "bg-indigo-900", text: "text-indigo-300" }
      : altitude >= 10000
      ? { bg: "bg-purple-900", text: "text-purple-300" }
      : { bg: "bg-orange-900", text: "text-orange-300" };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${bg} ${text}`}>
      {altitude.toLocaleString()} ft
    </span>
  );
}
