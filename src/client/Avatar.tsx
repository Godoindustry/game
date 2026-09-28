import type { CSSProperties } from "react";
import { CLASSIC_ICON, SPRITE, avatarName, creatureAvatar } from "@/shared/avatars";

/** Caixa comum: quadrada, cantos suaves, não encolhe em listas flex. */
const BOX: CSSProperties = {
  display: "inline-grid",
  placeItems: "center",
  flexShrink: 0,
  overflow: "hidden",
  borderRadius: 8,
  backgroundColor: "#151013",
  boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, .08)",
  lineHeight: 1,
};

/** Ícone de perfil: criatura (recorte do sprite) ou um dos emojis clássicos. */
export function Avatar({ id, size = 32, title }: { id: string; size?: number; title?: string }) {
  const creature = creatureAvatar(id);
  const label = title ?? avatarName(id);
  if (creature) {
    const col = creature.index % SPRITE.cols;
    const row = Math.floor(creature.index / SPRITE.cols);
    const style: CSSProperties = {
      ...BOX,
      width: size,
      height: size,
      backgroundImage: `url("${SPRITE.url}")`,
      backgroundSize: `${SPRITE.cols * size}px ${SPRITE.rows * size}px`,
      backgroundPosition: `${-col * size}px ${-row * size}px`,
    };
    return <span style={style} role="img" aria-label={label} title={label} />;
  }
  return (
    <span style={{ ...BOX, width: size, height: size, fontSize: size * 0.56 }} role="img" aria-label={label} title={label}>
      {CLASSIC_ICON[id] ?? "•"}
    </span>
  );
}
