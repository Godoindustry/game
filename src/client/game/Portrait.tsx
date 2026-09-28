"use client";

const POSITIONS = ["0% 0%", "100% 0%", "0% 100%", "100% 100%"];

function portraitIndex(id: string) {
  let hash = 17;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % POSITIONS.length;
}

export function SurvivorPortrait({ id, name, className = "" }: { id: string; name: string; className?: string }) {
  return (
    <span
      className={`survivor-portrait ${className}`}
      role="img"
      aria-label={`Retrato de ${name}`}
      style={{ backgroundPosition: POSITIONS[portraitIndex(id)] }}
    />
  );
}

