"use client";
import { useState } from "react";
import { Drawer, Meter, Modal } from "../ui";
import { CATEGORY_ICON, CONTAINER_LABEL, SLOT_LABEL } from "../labels";
import type { GameState } from "./useGame";

type Me = NonNullable<GameState["me"]>;
type Item = Me["inventory"][number];
type Ground = GameState["here"]["ground"][number];

const ORDER = ["equipped", "pockets", "backpack_side", "backpack_main", "hands"] as const;

function ItemSheet({ item, onClose, onAct, busy }: { item: Item; onClose: () => void; onAct: (t: string, p: Record<string, unknown>) => void; busy: boolean }) {
  return (
    <Modal label={item.name} onClose={onClose}>
      <div className="modal-body stack">
        <div className="row-between" style={{ flexWrap: "nowrap" }}>
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <div className="item-icon" style={{ width: 44, height: 44, fontSize: 22 }}>{CATEGORY_ICON[item.category] ?? "•"}</div>
            <div>
              <div className="h2">{item.name}</div>
              <div className="tiny muted">{CONTAINER_LABEL[item.container]}</div>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Fechar">✕</button>
        </div>
        <p className="small" style={{ margin: 0 }}>{item.description}</p>
        <div className="row">
          <span className="chip mono">{(item.weightG * item.quantity / 1000).toFixed(2)} kg</span>
          <span className="chip mono">{(item.volumeMl * item.quantity / 1000).toFixed(1)} L</span>
          {item.quantity > 1 && <span className="chip mono">×{item.quantity}</span>}
          {item.contaminated && <span className="chip chip-red">Água não tratada</span>}
          {item.wetness > 50 && <span className="chip chip-blue">Molhado</span>}
          {item.essential && <span className="chip chip-amber">Essencial</span>}
          {item.clothing && <span className="chip">{SLOT_LABEL[item.clothing.slot]} · calor {item.clothing.warmth} · imperm. {item.clothing.waterResistance}%</span>}
        </div>
        {item.maxDurability !== null && item.durability !== null && <Meter label="Durabilidade" value={item.durability} max={item.maxDurability} />}
        {item.batteryCapacity !== null && item.battery !== null && <Meter label="Bateria" value={item.battery} max={item.batteryCapacity} display={`${item.battery}%`} />}
        {item.usesLeft !== null && <span className="small muted">Usos restantes: <span className="mono">{item.usesLeft}</span></span>}
        {item.readable && (
          <blockquote className="msg msg-event" style={{ margin: 0, fontFamily: "var(--font-mono)", fontSize: 13 }}>{item.readable}</blockquote>
        )}
        <div className="stack" style={{ gap: 6 }}>
          {item.actions.length === 0 && <span className="small muted">Nenhuma ação disponível agora.</span>}
          {item.actions.map((a) => (
            <button
              key={`${a.type}-${JSON.stringify(a.params)}`}
              className="btn btn-sm"
              style={{ justifyContent: "space-between" }}
              disabled={busy || !a.available}
              title={a.reason ?? undefined}
              onClick={() => {
                onAct(a.type, a.params);
                onClose();
              }}
            >
              <span>{a.label}</span>
              <span className="mono tiny">{a.available ? `${a.minutes} min` : a.reason ?? ""}</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

export function Inventory({
  me,
  ground,
  onClose,
  onAct,
  busy,
}: {
  me: Me;
  ground: Ground[];
  onClose: () => void;
  onAct: (t: string, p: Record<string, unknown>) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const item = me.inventory.find((i) => i.id === open);
  const cap = Object.fromEntries(me.load.containers.map((c) => [c.container, c]));

  return (
    <Drawer title="Mochila" onClose={onClose}>
      <div className="stack">
        <Meter label="Peso" value={me.load.weightKg} max={me.load.maxKg} display={`${me.load.weightKg}/${me.load.maxKg}kg`} invert
          color={me.load.weightKg > me.load.comfortableKg ? "var(--red)" : "var(--amber)"} />
        <span className="tiny muted">
          Acima de {me.load.comfortableKg} kg você anda mais devagar e cansa mais (ritmo atual ×{me.load.encumbrance}).
        </span>
        {ORDER.map((c) => {
          const items = me.inventory.filter((i) => i.container === c);
          const info = cap[c];
          if (c !== "equipped" && info && info.capacityMl === 0 && items.length === 0) return null;
          return (
            <div key={c} className="bag-section">
              <div className="bag-head">
                <span className="label" style={{ color: "var(--text)" }}>{CONTAINER_LABEL[c]}</span>
                {info && <span className="mono tiny muted">{(info.usedMl / 1000).toFixed(1)} / {(info.capacityMl / 1000).toFixed(1)} L</span>}
              </div>
              {info && info.capacityMl > 0 && (
                <div className="progress" style={{ margin: 0, borderRadius: 0, border: 0, height: 3 }}>
                  <div style={{ width: `${Math.min(100, (info.usedMl / info.capacityMl) * 100)}%` }} />
                </div>
              )}
              {items.length === 0 && <div className="small faint" style={{ padding: "8px 10px" }}>Vazio</div>}
              {items.map((i) => (
                <button key={i.id} className="item-row" onClick={() => setOpen(i.id)}>
                  <span className="item-icon">{CATEGORY_ICON[i.category] ?? "•"}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="small" style={{ fontWeight: 600 }}>{i.name}{i.quantity > 1 && ` ×${i.quantity}`}</span>
                    <span className="tiny muted" style={{ display: "block" }}>
                      {(i.weightG * i.quantity / 1000).toFixed(2)} kg
                      {i.battery !== null && ` · bateria ${i.battery}%`}
                      {i.usesLeft !== null && ` · ${i.usesLeft} usos`}
                      {i.contaminated && " · não tratada"}
                    </span>
                  </span>
                  <span className="faint">›</span>
                </button>
              ))}
            </div>
          );
        })}
        {ground.length > 0 && (
          <div className="bag-section">
            <div className="bag-head"><span className="label" style={{ color: "var(--text)" }}>No chão, aqui</span></div>
            {ground.map((g) => (
              <div key={g.id} className="item-row" style={{ cursor: "default" }}>
                <span className="item-icon">📦</span>
                <span style={{ flex: 1 }} className="small">
                  {g.name} ×{g.quantity}
                  <span className="tiny muted" style={{ display: "block" }}>{(g.weightG / 1000).toFixed(2)} kg · {(g.volumeMl / 1000).toFixed(1)} L</span>
                </span>
                <button className="btn btn-sm" disabled={busy || !g.available} title={g.reason ?? undefined} onClick={() => onAct("pegar_item", { groundItemId: g.id })}>
                  Pegar
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      {item && <ItemSheet item={item} busy={busy} onClose={() => setOpen(null)} onAct={onAct} />}
    </Drawer>
  );
}
