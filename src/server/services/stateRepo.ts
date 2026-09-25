/**
 * Ponte entre as tabelas e os objetos do motor (WorldState / CharacterState).
 * Salvar é sempre "estado completo" dentro de uma transação: é o autosave.
 */
import { getDb, json, nowIso } from "../db/database";
import type { ActiveEvent, Attributes, CharacterState, Disease, GroundItem, InvItem, WorldState, Wound } from "../engine/types";
import { ATTRIBUTE_KEYS } from "../engine/types";
import { newId } from "./ids";

// ---------- Mundo ----------
export async function loadWorld(campaignId: string): Promise<WorldState> {
  const db = getDb();
  const c = await db.get<{ id: string; seed: string; game_minutes: number; current_round: number; flags: string; ending: string | null; ending_type: string | null }>(
    "SELECT id, seed, game_minutes, current_round, flags, ending, ending_type FROM campaigns WHERE id = ?",
    campaignId,
  );
  if (!c) throw new Error("campanha inexistente");
  const locations: WorldState["locations"] = {};
  const locRows = await db.all<{ location_id: string; discovered: number; visited: number; examined: number; loot_state: string; shelter_built: number; fire_until_minute: number }>(
    "SELECT * FROM campaign_locations WHERE campaign_id = ?",
    campaignId,
  );
  for (const l of locRows) {
    locations[l.location_id] = {
      locationId: l.location_id,
      discovered: !!l.discovered,
      visited: !!l.visited,
      examined: !!l.examined,
      loot: json<number[]>(l.loot_state, []),
      shelterBuilt: !!l.shelter_built,
      fireUntilMinute: Number(l.fire_until_minute),
    };
  }
  const eventHistory: Record<string, number> = {};
  const evRows = await db.all<{ event_id: string; m: number }>(
    "SELECT event_id, MAX(triggered_at_minute) AS m FROM campaign_events WHERE campaign_id = ? GROUP BY event_id",
    campaignId,
  );
  for (const e of evRows) eventHistory[e.event_id] = Number(e.m);
  const clues = await db.all<{ clue_key: string }>("SELECT clue_key FROM campaign_clues WHERE campaign_id = ? ORDER BY found_at_minute, clue_key", campaignId);
  const links = await db.all<{ from_id: string; to_id: string }>("SELECT from_id, to_id FROM campaign_links WHERE campaign_id = ?", campaignId);
  const ground = await db.all<{ id: string; location_id: string; item_id: string; quantity: number; state: string }>(
    "SELECT id, location_id, item_id, quantity, state FROM ground_items WHERE campaign_id = ? ORDER BY id",
    campaignId,
  );
  return {
    campaignId,
    seed: c.seed,
    minute: Number(c.game_minutes),
    round: Number(c.current_round),
    flags: json(c.flags, {}),
    clues: clues.map((r) => r.clue_key),
    locations,
    revealedLinks: links.map((r) => `${r.from_id}|${r.to_id}`),
    ground: ground.map((g): GroundItem => ({ id: g.id, locationId: g.location_id, itemId: g.item_id, quantity: g.quantity, state: json(g.state, {}) })),
    ending: c.ending ? { key: c.ending, type: (c.ending_type as "victory" | "defeat") ?? "defeat" } : null,
    eventHistory,
  };
}

export async function saveWorld(world: WorldState, clueFinder: Record<string, string | null> = {}): Promise<void> {
  const db = getDb();
  const now = nowIso();
  await db.run(
    "UPDATE campaigns SET game_minutes=?, current_round=?, flags=?, ending=?, ending_type=COALESCE(?, ending_type), updated_at=?, version=version+1 WHERE id=?",
    world.minute, world.round, JSON.stringify(world.flags), world.ending?.key ?? null, world.ending?.type ?? null, now, world.campaignId,
  );
  for (const l of Object.values(world.locations)) {
    await db.run(
      `INSERT INTO campaign_locations(campaign_id,location_id,discovered,visited,examined,loot_state,shelter_built,fire_until_minute)
       VALUES(?,?,?,?,?,?,?,?)
       ON CONFLICT(campaign_id,location_id) DO UPDATE SET discovered=excluded.discovered, visited=excluded.visited, examined=excluded.examined,
         loot_state=excluded.loot_state, shelter_built=excluded.shelter_built, fire_until_minute=excluded.fire_until_minute`,
      world.campaignId, l.locationId, +l.discovered, +l.visited, +l.examined, JSON.stringify(l.loot), +l.shelterBuilt, l.fireUntilMinute,
    );
  }
  for (const k of world.revealedLinks) {
    const [a, b] = k.split("|");
    await db.run("INSERT INTO campaign_links(campaign_id,from_id,to_id) VALUES(?,?,?) ON CONFLICT DO NOTHING", world.campaignId, a, b);
  }
  await db.run("DELETE FROM ground_items WHERE campaign_id = ?", world.campaignId);
  for (const g of world.ground) {
    await db.run(
      "INSERT INTO ground_items(id,campaign_id,location_id,item_id,quantity,state) VALUES(?,?,?,?,?,?)",
      g.id, world.campaignId, g.locationId, g.itemId, g.quantity, JSON.stringify(g.state),
    );
  }
  for (const clue of world.clues) {
    await db.run(
      "INSERT INTO campaign_clues(campaign_id,clue_key,character_id,found_at_minute) VALUES(?,?,?,?) ON CONFLICT DO NOTHING",
      world.campaignId, clue, clueFinder[clue] ?? null, world.minute,
    );
  }
}

// ---------- Personagens ----------
interface CharRow {
  id: string; user_id: string; name: string; age: number; height_cm: number; weight_kg: number; body_type: string;
  conditioning: string; profession: string; experiences: string; alive: number; death_cause: string | null; died_at_minute: number | null;
}

export async function loadCharacter(characterId: string): Promise<CharacterState | null> {
  const db = getDb();
  const c = await db.get<CharRow>("SELECT * FROM characters WHERE id = ?", characterId);
  if (!c) return null;
  const attrs = await db.get<Record<string, number>>("SELECT * FROM character_attributes WHERE character_id = ?", characterId);
  const st = await db.get<Record<string, number | string>>("SELECT * FROM character_status WHERE character_id = ?", characterId);
  const hs = await db.get<{ health: number; infection: number; mobility: number; diseases: string; painkiller_until: number }>(
    "SELECT * FROM health_states WHERE character_id = ?",
    characterId,
  );
  if (!attrs || !st || !hs) return null;
  const inv = await db.get<{ id: string }>("SELECT id FROM inventories WHERE character_id = ?", characterId);
  const items = inv
    ? await db.all<{ id: string; item_id: string; container: string; quantity: number; durability: number | null; battery: number | null; uses_left: number | null; wetness: number; contaminated: number }>(
        "SELECT * FROM inventory_items WHERE inventory_id = ? ORDER BY created_at, id",
        inv.id,
      )
    : [];
  const wounds = await db.all<{ id: string; body_part: string; type: string; severity: number; bleeding_rate: number; bandaged: number; disinfected: number; splinted: number; created_at_minute: number; healed: number }>(
    "SELECT * FROM wounds WHERE character_id = ? ORDER BY created_at_minute, id",
    characterId,
  );
  return {
    id: c.id,
    userId: c.user_id,
    name: c.name,
    alive: !!c.alive,
    deathCause: c.death_cause,
    diedAtMinute: c.died_at_minute === null ? null : Number(c.died_at_minute),
    attrs: Object.fromEntries(ATTRIBUTE_KEYS.map((k) => [k, Number(attrs[k])])) as Attributes,
    profile: {
      age: c.age,
      heightCm: c.height_cm,
      weightKg: c.weight_kg,
      bodyType: c.body_type as CharacterState["profile"]["bodyType"],
      conditioning: c.conditioning as CharacterState["profile"]["conditioning"],
      profession: c.profession,
      experiences: json(c.experiences, []),
    },
    status: {
      locationId: String(st.location_id),
      hunger: Number(st.hunger),
      thirst: Number(st.thirst),
      energy: Number(st.energy),
      fatigue: Number(st.fatigue),
      pain: Number(st.pain),
      stress: Number(st.stress),
      bodyTemp: Number(st.body_temp),
      wetness: Number(st.wetness),
      awakeMinutes: Number(st.awake_minutes),
    },
    health: {
      health: Number(hs.health),
      infection: Number(hs.infection),
      mobility: Number(hs.mobility),
      diseases: json<Disease[]>(hs.diseases, []),
      painkillerUntil: Number(hs.painkiller_until),
    },
    wounds: wounds.map((w): Wound => ({
      id: w.id,
      bodyPart: w.body_part as Wound["bodyPart"],
      type: w.type as Wound["type"],
      severity: Number(w.severity) as 1 | 2 | 3,
      bleedingRate: Number(w.bleeding_rate),
      bandaged: !!w.bandaged,
      disinfected: !!w.disinfected,
      splinted: !!w.splinted,
      createdAtMinute: Number(w.created_at_minute),
      healed: !!w.healed,
    })),
    inventory: items.map((i): InvItem => ({
      id: i.id,
      itemId: i.item_id,
      container: i.container as InvItem["container"],
      quantity: Number(i.quantity),
      durability: i.durability === null ? null : Number(i.durability),
      battery: i.battery === null ? null : Number(i.battery),
      usesLeft: i.uses_left === null ? null : Number(i.uses_left),
      wetness: Number(i.wetness),
      contaminated: !!i.contaminated,
    })),
  };
}

export async function loadCampaignCharacters(campaignId: string): Promise<CharacterState[]> {
  const ids = await getDb().all<{ id: string }>("SELECT id FROM characters WHERE campaign_id = ? ORDER BY id", campaignId);
  const chars = await Promise.all(ids.map((r) => loadCharacter(r.id)));
  return chars.filter((c): c is CharacterState => c !== null);
}

/** Cria as linhas de um personagem novo (ficha + estado inicial). */
export async function insertCharacter(
  campaignId: string,
  char: CharacterState,
  sheet: { knowledge: string; fears: string; history: string; personality: string },
): Promise<void> {
  const db = getDb();
  const now = nowIso();
  await db.run(
    `INSERT INTO characters(id,user_id,campaign_id,name,age,height_cm,weight_kg,body_type,conditioning,profession,knowledge,fears,history,personality,experiences,alive,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
    char.id, char.userId, campaignId, char.name, char.profile.age, char.profile.heightCm, char.profile.weightKg, char.profile.bodyType,
    char.profile.conditioning, char.profile.profession, sheet.knowledge, sheet.fears, sheet.history, sheet.personality,
    JSON.stringify(char.profile.experiences), now, now,
  );
  await db.run(
    `INSERT INTO character_attributes(character_id,${ATTRIBUTE_KEYS.join(",")}) VALUES(?,${ATTRIBUTE_KEYS.map(() => "?").join(",")})`,
    char.id, ...ATTRIBUTE_KEYS.map((k) => char.attrs[k]),
  );
  await db.run("INSERT INTO inventories(id,character_id,created_at,updated_at) VALUES(?,?,?,?)", newId(), char.id, now, now);
  await saveCharacter(char);
}

export async function saveCharacter(char: CharacterState): Promise<void> {
  const db = getDb();
  const now = nowIso();
  const s = char.status;
  const h = char.health;
  await db.run("UPDATE characters SET alive=?, death_cause=?, died_at_minute=?, updated_at=? WHERE id=?", +char.alive, char.deathCause, char.diedAtMinute, now, char.id);
  await db.run(
    `INSERT INTO character_status(character_id,location_id,hunger,thirst,energy,fatigue,pain,stress,body_temp,wetness,awake_minutes,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(character_id) DO UPDATE SET location_id=excluded.location_id, hunger=excluded.hunger, thirst=excluded.thirst, energy=excluded.energy,
       fatigue=excluded.fatigue, pain=excluded.pain, stress=excluded.stress, body_temp=excluded.body_temp, wetness=excluded.wetness,
       awake_minutes=excluded.awake_minutes, updated_at=excluded.updated_at`,
    char.id, s.locationId, s.hunger, s.thirst, s.energy, s.fatigue, s.pain, s.stress, s.bodyTemp, s.wetness, Math.round(s.awakeMinutes), now,
  );
  await db.run(
    `INSERT INTO health_states(character_id,health,infection,mobility,diseases,limbs,painkiller_until,updated_at) VALUES(?,?,?,?,?,?,?,?)
     ON CONFLICT(character_id) DO UPDATE SET health=excluded.health, infection=excluded.infection, mobility=excluded.mobility,
       diseases=excluded.diseases, limbs=excluded.limbs, painkiller_until=excluded.painkiller_until, updated_at=excluded.updated_at`,
    char.id, h.health, h.infection, h.mobility, JSON.stringify(h.diseases), JSON.stringify(limbSummary(char)), Math.round(h.painkillerUntil), now,
  );
  // Ferimentos: sincroniza (apaga os que sumiram, faz upsert do resto)
  const woundIds = char.wounds.map((w) => w.id);
  await db.run(
    `DELETE FROM wounds WHERE character_id = ?${woundIds.length ? ` AND id NOT IN (${woundIds.map(() => "?").join(",")})` : ""}`,
    char.id, ...woundIds,
  );
  for (const w of char.wounds) {
    await db.run(
      `INSERT INTO wounds(id,character_id,body_part,type,severity,bleeding_rate,bandaged,disinfected,splinted,created_at_minute,healed,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET bleeding_rate=excluded.bleeding_rate, bandaged=excluded.bandaged, disinfected=excluded.disinfected,
         splinted=excluded.splinted, healed=excluded.healed, updated_at=excluded.updated_at`,
      w.id, char.id, w.bodyPart, w.type, w.severity, w.bleedingRate, +w.bandaged, +w.disinfected, +w.splinted, w.createdAtMinute, +w.healed, now, now,
    );
  }
  // Inventário
  const inv = await db.get<{ id: string }>("SELECT id FROM inventories WHERE character_id = ?", char.id);
  if (!inv) return;
  const ids = char.inventory.map((i) => i.id);
  await db.run(
    `DELETE FROM inventory_items WHERE inventory_id = ?${ids.length ? ` AND id NOT IN (${ids.map(() => "?").join(",")})` : ""}`,
    inv.id, ...ids,
  );
  for (const i of char.inventory) {
    await db.run(
      `INSERT INTO inventory_items(id,inventory_id,item_id,container,quantity,durability,battery,uses_left,wetness,contaminated,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET container=excluded.container, quantity=excluded.quantity, durability=excluded.durability,
         battery=excluded.battery, uses_left=excluded.uses_left, wetness=excluded.wetness, contaminated=excluded.contaminated, updated_at=excluded.updated_at`,
      i.id, inv.id, i.itemId, i.container, i.quantity, i.durability, i.battery, i.usesLeft, Math.round(i.wetness), +i.contaminated, now, now,
    );
  }
  await db.run("UPDATE inventories SET updated_at = ? WHERE id = ?", now, inv.id);
}

function limbSummary(char: CharacterState): Record<string, string> {
  const out: Record<string, string> = {};
  for (const w of char.wounds.filter((x) => !x.healed)) {
    const label = w.severity >= 2 ? "grave" : "ferido";
    if (out[w.bodyPart] !== "grave") out[w.bodyPart] = label;
  }
  return out;
}

// ---------- Evento ativo ----------
export async function loadActiveEvent(campaignId: string): Promise<ActiveEvent | null> {
  const row = await getDb().get<{ id: string; event_id: string; participants: string }>(
    "SELECT id, event_id, participants FROM campaign_events WHERE campaign_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1",
    campaignId,
  );
  return row ? { instanceId: row.id, eventId: row.event_id, participants: json(row.participants, []) } : null;
}

export async function addLog(campaignId: string, characterId: string | null, minute: number, kind: string, text: string): Promise<void> {
  await getDb().run(
    "INSERT INTO campaign_log(campaign_id,character_id,game_minute,kind,text,created_at) VALUES(?,?,?,?,?,?)",
    campaignId, characterId, minute, kind, text.slice(0, 2000), nowIso(),
  );
}
