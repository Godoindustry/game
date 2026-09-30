"use client";
import { useState } from "react";
import { Drawer, Meter, Modal } from "../ui";
import { CONTAINER_LABEL, SLOT_LABEL } from "../labels";
import type { GameState } from "./useGame";

type Me = NonNullable<GameState["me"]>;
type Item = Me["inventory"][number];
type Ground = GameState["here"]["ground"][number];

const ORDER = ["equipped", "pockets", "backpack_side", "backpack_main", "hands"] as const;

const CATEGORY_LABEL: Record<string, string> = {
  comida: "Comida",
  agua: "Água",
  ferramenta: "Ferramentas",
  medico: "Cuidados",
  roupa: "Roupas",
  mochila: "Mochilas",
  luz: "Iluminação",
  combustivel: "Combustível",
  documento: "Documentos",
  essencial: "Essenciais",
};

const CONTAINER_MARK: Record<string, string> = {
  equipped: "E",
  pockets: "B",
  backpack_side: "L",
  backpack_main: "M",
  hands: "▲",
};

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function ItemGlyph({ category }: { category: string }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {category === "agua" ? (
        <path {...common} d="M12 2.8S6.6 9.3 6.6 14a5.4 5.4 0 0 0 10.8 0C17.4 9.3 12 2.8 12 2.8Z M9.3 15.1c.4 1.3 1.3 2 2.7 2.2" />
      ) : category === "medico" ? (
        <path {...common} d="M9.3 3.5h5.4v5.8h5.8v5.4h-5.8v5.8H9.3v-5.8H3.5V9.3h5.8Z" />
      ) : category === "ferramenta" ? (
        <path {...common} d="M14.8 5.2a4.4 4.4 0 0 0-5.4 5.5L3.8 16.3a2.5 2.5 0 1 0 3.5 3.5l5.6-5.6a4.4 4.4 0 0 0 5.6-5.4l-2.9 2-2.5-2.5 1.7-3.1Z" />
      ) : category === "roupa" ? (
        <path {...common} d="m8.2 4.4-4.6 2.8 2.1 4 2.2-1.1v9.5h8.2v-9.5l2.2 1.1 2.1-4-4.6-2.8a4.8 4.8 0 0 1-7.6 0Z" />
      ) : category === "mochila" ? (
        <path {...common} d="M8.2 7V5.7A3.8 3.8 0 0 1 12 2a3.8 3.8 0 0 1 3.8 3.7V7 M6.2 7h11.6c1 0 1.7.8 1.7 1.7V20H4.5V8.7C4.5 7.7 5.3 7 6.2 7Z M8 13h8v4H8z" />
      ) : category === "luz" ? (
        <path {...common} d="M8.5 3h7l1 5-3 3v9h-3v-9l-3-3 1-5Z M8 7.5h8 M10.5 14h3" />
      ) : category === "combustivel" ? (
        <path {...common} d="M13.7 2.8c.4 4-3.8 5.3-3 8.7 1-1.7 2.5-2.4 3.8-3.7 2.7 2.5 3.8 4.5 3.3 7.4-.5 3.2-3 5.4-6.1 5.4-3.4 0-5.8-2.4-5.6-5.7.2-2.7 2-4.7 4.4-7 .1 2.2.6 3.2 1.3 4 .5-3.4 4.2-4.7 1.9-9.1Z" />
      ) : category === "documento" ? (
        <path {...common} d="M6 2.8h8l4 4V21H6V2.8Z M14 2.8V7h4 M9 11h6 M9 14.5h6 M9 18h4" />
      ) : category === "essencial" ? (
        <path {...common} d="m13.5 2.8-7 10.5h5L10.6 21l7-11h-5.1l1-7.2Z" />
      ) : category === "comida" ? (
        <path {...common} d="M7 5h10l-1 16H8L7 5Z M6.5 5h11 M8 2.8h8 M9.2 10.5h5.6 M9.5 14h5" />
      ) : (
        <path {...common} d="m4 8 8-4.5L20 8v9l-8 4.5L4 17V8Z M4 8l8 4.5L20 8 M12 12.5v9" />
      )}
    </svg>
  );
}

type Act = (t: string, p: Record<string, unknown>) => void;
type Friend = Item["friends"][number];

/** Ações que contam como "usar" o item em si (as de organizar a mochila ficam só na ficha). */
const USE_TYPES = ["comer", "beber", "tratar_ferimento", "tomar_analgesico", "purificar_agua", "ferver_agua", "coletar_agua", "equipar", "desequipar"];

function useActions(item: Item) {
  return item.actions.filter((a) => USE_TYPES.includes(a.type));
}

/** Escolher o amigo: quem está junto pode receber; quem está longe aparece com o motivo. */
function FriendPicker({ item, mode, onAct, onClose, busy }: { item: Item; mode: "give" | "use"; onAct: Act; onClose: () => void; busy: boolean }) {
  return (
    <Modal label={mode === "give" ? `Passar ${item.name}` : `Usar ${item.name} em um amigo`} onClose={onClose}>
      <div className="modal-body stack">
        <div className="row-between">
          <div className="h2">{mode === "give" ? "Passar para quem?" : "Usar em quem?"}</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Fechar">✕</button>
        </div>
        <span className="small muted">{item.name}{mode === "give" && item.quantity > 1 ? " · passa 1 por vez" : ""}</span>
        {item.friends.map((f: Friend) => {
          const give = f.give;
          const useOn = f.useOn;
          const opt = mode === "give" ? give : useOn;
          if (!opt) return null;
          const label = mode === "give" ? `Passar para ${f.name}` : `${useOn?.label ?? "Usar"} · ${f.name}`;
          return (
            <button
              key={f.characterId}
              className="btn btn-sm"
              style={{ justifyContent: "space-between" }}
              disabled={busy || !opt.available}
              title={opt.reason ?? undefined}
              onClick={() => {
                onAct(mode === "give" ? "dar_item" : "usar_em_amigo", { inventoryItemId: item.id, targetCharacterId: f.characterId });
                onClose();
              }}
            >
              <span>{label}</span>
              <span className="mono tiny">{opt.available ? `${opt.minutes} min` : f.nearby ? opt.reason ?? "" : "longe"}</span>
            </button>
          );
        })}
        <span className="tiny muted">Só dá para passar ou cuidar de quem está no mesmo lugar que você.</span>
      </div>
    </Modal>
  );
}

/** Usar · Usar em amigo · Passar — ao lado de cada item. */
function ItemButtons({ item, busy, onAct, onOpen, onFriend }: { item: Item; busy: boolean; onAct: Act; onOpen: () => void; onFriend: (mode: "give" | "use") => void }) {
  const uses = useActions(item);
  const ready = uses.filter((a) => a.available);
  const canUseOn = item.friends.some((f) => f.useOn);
  const canGive = item.friends.some((f) => f.give);
  if (!uses.length && !canUseOn && !canGive) return null;
  return (
    <div className="item-actions">
      {uses.length > 0 && (
        <button
          className="btn btn-sm"
          disabled={busy || !ready.length}
          title={ready.length ? ready.map((a) => a.label).join(" / ") : uses[0].reason ?? undefined}
          onClick={() => (ready.length === 1 ? onAct(ready[0].type, ready[0].params) : onOpen())}
        >
          {ready.length === 1 ? ready[0].label : "Usar"}
        </button>
      )}
      {canUseOn && (
        <button className="btn btn-sm" disabled={busy} onClick={() => onFriend("use")}>Usar em amigo</button>
      )}
      {canGive && (
        <button className="btn btn-sm" disabled={busy} onClick={() => onFriend("give")}>Passar</button>
      )}
    </div>
  );
}

function ItemSheet({ item, onClose, onAct, busy, onFriend }: { item: Item; onClose: () => void; onAct: (t: string, p: Record<string, unknown>) => void; busy: boolean; onFriend: (mode: "give" | "use") => void }) {
  const availableActions = item.actions.filter((action) => action.available).length;
  return (
    <Modal label={item.name} onClose={onClose}>
      <div className="modal-body item-sheet">
        <div className="item-sheet-hero" data-category={item.category}>
          <div className="item-sheet-icon"><ItemGlyph category={item.category} /></div>
          <div className="item-sheet-title">
            <span>{CATEGORY_LABEL[item.category] ?? item.category} · {CONTAINER_LABEL[item.container]}</span>
            <h2>{item.name}</h2>
            <small>{availableActions > 0 ? `${availableActions} ${availableActions === 1 ? "ação disponível" : "ações disponíveis"}` : "Sem ações disponíveis agora"}</small>
          </div>
          <button className="item-sheet-close" onClick={onClose} aria-label="Fechar">×</button>
        </div>
        <p className="item-sheet-description">{item.description}</p>
        <div className="item-sheet-stats">
          <span><small>PESO</small><b>{(item.weightG * item.quantity / 1000).toFixed(2)} kg</b></span>
          <span><small>VOLUME</small><b>{(item.volumeMl * item.quantity / 1000).toFixed(1)} L</b></span>
          <span><small>QTD.</small><b>×{item.quantity}</b></span>
        </div>
        <div className="item-sheet-flags">
          {item.contaminated && <span className="chip chip-red">Água não tratada</span>}
          {item.wetness > 50 && <span className="chip chip-blue">Molhado</span>}
          {item.essential && <span className="chip chip-amber">Essencial</span>}
          {item.clothing && <span className="chip">{SLOT_LABEL[item.clothing.slot]} · calor {item.clothing.warmth} · imperm. {item.clothing.waterResistance}%</span>}
        </div>
        <div className="item-sheet-condition">
          {item.maxDurability !== null && item.durability !== null && <Meter label="Durabilidade" value={item.durability} max={item.maxDurability} />}
          {item.batteryCapacity !== null && item.battery !== null && <Meter label="Bateria" value={item.battery} max={item.batteryCapacity} display={`${item.battery}%`} />}
          {item.usesLeft !== null && <span className="item-uses"><small>USOS RESTANTES</small><b>{item.usesLeft}</b></span>}
        </div>
        {item.readable && (
          <blockquote className="item-readable">{item.readable}</blockquote>
        )}
        <div className="item-action-list">
          <span className="item-action-heading">O QUE FAZER</span>
          {item.actions.length === 0 && !item.friends.length && <span className="item-action-empty">Nenhuma ação disponível agora.</span>}
          {item.friends.some((f) => f.useOn) && (
            <button className="item-action" disabled={busy} onClick={() => onFriend("use")}>
              <span className="item-action-mark" aria-hidden="true">＋</span>
              <span><b>Usar em um amigo</b><small>ESCOLHER QUEM ESTÁ PERTO</small></span><i>›</i>
            </button>
          )}
          {item.friends.some((f) => f.give) && (
            <button className="item-action" disabled={busy} onClick={() => onFriend("give")}>
              <span className="item-action-mark" aria-hidden="true">↗</span>
              <span><b>Passar para um amigo</b><small>ENTREGAR 1 UNIDADE</small></span><i>›</i>
            </button>
          )}
          {item.actions.map((a) => (
            <button
              key={`${a.type}-${JSON.stringify(a.params)}`}
              className="item-action"
              disabled={busy || !a.available}
              title={a.reason ?? undefined}
              onClick={() => {
                onAct(a.type, a.params);
                onClose();
              }}
            >
              <span className="item-action-mark" aria-hidden="true">{a.available ? "→" : "×"}</span>
              <span><b>{a.label}</b><small>{a.available ? "AÇÃO DISPONÍVEL" : a.reason ?? "INDISPONÍVEL"}</small></span>
              <i>{a.available ? `${a.minutes} MIN` : "—"}</i>
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
  const [friendFor, setFriendFor] = useState<{ id: string; mode: "give" | "use" } | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const item = me.inventory.find((i) => i.id === open);
  const friendItem = friendFor ? me.inventory.find((i) => i.id === friendFor.id) : undefined;
  const cap = Object.fromEntries(me.load.containers.map((c) => [c.container, c]));
  const categories = Array.from(new Set(me.inventory.map((entry) => entry.category)));
  const search = normalize(query.trim());
  const matches = (entry: Item) => (
    (category === "all" || entry.category === category) &&
    (!search || normalize(`${entry.name} ${entry.description}`).includes(search))
  );
  const filteredItems = me.inventory.filter(matches);
  const filtering = category !== "all" || search.length > 0;
  const loadPercent = Math.min(100, Math.round((me.load.weightKg / Math.max(1, me.load.maxKg)) * 100));
  const overloaded = me.load.weightKg > me.load.comfortableKg;

  return (
    <Drawer title="Mochila" onClose={onClose}>
      <div className="bag-layout">
        <section className={`bag-load-card ${overloaded ? "is-heavy" : ""}`}>
          <div className="bag-load-figure" aria-hidden="true">
            <i style={{ height: `${loadPercent}%` }} />
            <span><ItemGlyph category="mochila" /></span>
          </div>
          <div className="bag-load-copy">
            <span>{overloaded ? "CARGA PESADA" : "CARGA ATUAL"}</span>
            <strong>{me.load.weightKg}<small> / {me.load.maxKg} kg</small></strong>
            <div className="bag-load-track"><i style={{ width: `${loadPercent}%` }} /></div>
            <p>{overloaded ? "Movimento e cansaço já estão sendo afetados." : `${Math.max(0, me.load.comfortableKg - me.load.weightKg).toFixed(1)} kg até começar a perder ritmo.`}</p>
          </div>
          <div className="bag-load-stats">
            <span><small>ITENS</small><b>{me.inventory.reduce((sum, entry) => sum + entry.quantity, 0)}</b></span>
            <span><small>RITMO</small><b>×{me.load.encumbrance}</b></span>
          </div>
        </section>

        <section className="bag-finder" aria-label="Localizar item">
          <label className="bag-search">
            <span aria-hidden="true">⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar pelo nome ou descrição…" />
            {query && <button type="button" onClick={() => setQuery("")} aria-label="Limpar busca">×</button>}
          </label>
          <div className="bag-filters" aria-label="Filtrar por tipo">
            <button type="button" className={category === "all" ? "is-active" : ""} onClick={() => setCategory("all")}>
              <span className="bag-filter-all" aria-hidden="true">•••</span> Todos <i>{me.inventory.length}</i>
            </button>
            {categories.map((entryCategory) => (
              <button type="button" key={entryCategory} className={category === entryCategory ? "is-active" : ""} onClick={() => setCategory(entryCategory)}>
                <span aria-hidden="true"><ItemGlyph category={entryCategory} /></span>
                {CATEGORY_LABEL[entryCategory] ?? entryCategory}
              </button>
            ))}
          </div>
        </section>

        {filtering && (
          <div className="bag-result-count">
            <span>{filteredItems.length} {filteredItems.length === 1 ? "item encontrado" : "itens encontrados"}</span>
            <button type="button" onClick={() => { setQuery(""); setCategory("all"); }}>LIMPAR FILTROS</button>
          </div>
        )}
        {ORDER.map((c) => {
          const allItems = me.inventory.filter((i) => i.container === c);
          const items = allItems.filter(matches);
          const info = cap[c];
          if (filtering && items.length === 0) return null;
          if (c !== "equipped" && info && info.capacityMl === 0 && allItems.length === 0) return null;
          const capacity = info?.capacityMl > 0 ? Math.min(100, Math.round((info.usedMl / info.capacityMl) * 100)) : 0;
          return (
            <section key={c} className="bag-section" data-container={c}>
              <div className="bag-head">
                <span className="bag-container-mark" aria-hidden="true">{CONTAINER_MARK[c]}</span>
                <span className="bag-container-name">
                  <b>{CONTAINER_LABEL[c]}</b>
                  <small>{allItems.length} {allItems.length === 1 ? "tipo de item" : "tipos de item"}</small>
                </span>
                {info && info.capacityMl > 0 && (
                  <span className="bag-capacity">
                    <b>{capacity}%</b>
                    <small>{(info.usedMl / 1000).toFixed(1)} / {(info.capacityMl / 1000).toFixed(1)} L</small>
                  </span>
                )}
              </div>
              {info && info.capacityMl > 0 && (
                <div className="bag-capacity-track" aria-hidden="true">
                  <i style={{ width: `${capacity}%` }} />
                </div>
              )}
              {items.length === 0 && <div className="bag-empty"><span aria-hidden="true">◇</span> Compartimento vazio</div>}
              {items.map((i) => (
                <div key={i.id} className="item-line">
                  <button
                    className={`item-row ${i.durability !== null && i.maxDurability !== null && i.durability <= 0 ? "item-broken" : i.durability !== null && i.maxDurability !== null && i.durability / Math.max(1, i.maxDurability) <= .3 ? "item-degraded" : ""}`}
                    data-category={i.category}
                    onClick={() => setOpen(i.id)}
                    aria-label={`Abrir ${i.name}`}
                  >
                    <span className="item-icon"><ItemGlyph category={i.category} /></span>
                    <span className="item-copy">
                      <span className="item-name">{i.name}{i.quantity > 1 && <i>×{i.quantity}</i>}</span>
                      <span className="item-meta">
                        <b>{CATEGORY_LABEL[i.category] ?? i.category}</b>
                        <i>{(i.weightG * i.quantity / 1000).toFixed(2)} kg</i>
                        {i.battery !== null && <i>bateria {i.battery}%</i>}
                        {i.usesLeft !== null && <i>{i.usesLeft} usos</i>}
                      </span>
                    </span>
                    <span className="item-state">
                      {i.contaminated && <i className="is-danger">NÃO TRATADA</i>}
                      {i.wetness > 50 && <i className="is-wet">MOLHADO</i>}
                      <b>›</b>
                    </span>
                  </button>
                  <ItemButtons
                    item={i}
                    busy={busy}
                    onAct={onAct}
                    onOpen={() => setOpen(i.id)}
                    onFriend={(mode) => setFriendFor({ id: i.id, mode })}
                  />
                </div>
              ))}
            </section>
          );
        })}
        {filtering && filteredItems.length === 0 && (
          <div className="bag-no-results">
            <span aria-hidden="true">⌕</span>
            <strong>Nenhum item encontrado</strong>
            <p>Tente outro nome ou retire o filtro de categoria.</p>
          </div>
        )}
        {ground.length > 0 && (
          <section className="bag-section bag-ground">
            <div className="bag-head">
              <span className="bag-container-mark" aria-hidden="true">⌖</span>
              <span className="bag-container-name"><b>Ao seu alcance</b><small>Itens no chão deste local</small></span>
            </div>
            {ground.map((g) => (
              <div key={g.id} className="ground-item">
                <span className="item-icon"><ItemGlyph category="outro" /></span>
                <span className="item-copy">
                  <span className="item-name">{g.name}<i>×{g.quantity}</i></span>
                  <span className="item-meta"><i>{(g.weightG / 1000).toFixed(2)} kg</i><i>{(g.volumeMl / 1000).toFixed(1)} L</i></span>
                </span>
                <button className="ground-pickup" disabled={busy || !g.available} title={g.reason ?? undefined} onClick={() => onAct("pegar_item", { groundItemId: g.id })}>
                  <span aria-hidden="true">＋</span> PEGAR
                </button>
              </div>
            ))}
          </section>
        )}
      </div>
      {item && (
        <ItemSheet
          item={item}
          busy={busy}
          onClose={() => setOpen(null)}
          onAct={onAct}
          onFriend={(mode) => { setOpen(null); setFriendFor({ id: item.id, mode }); }}
        />
      )}
      {friendItem && friendFor && <FriendPicker item={friendItem} mode={friendFor.mode} busy={busy} onAct={onAct} onClose={() => setFriendFor(null)} />}
    </Drawer>
  );
}
