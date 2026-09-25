/**
 * Boot do banco: migração (por versão), sincronização do conteúdo (por hash) e ADM MASTER.
 * Idempotente e barato quando nada mudou — importante em ambiente serverless (Vercel).
 */
import { createHash } from "node:crypto";
import type { Db } from "./database";
import { nowIso } from "./database";
import { SCHEMA_SQL, SCHEMA_VERSION, schemaForPostgres } from "./schema";
import { SCENARIOS } from "../content/valeSilente";
import { ACHIEVEMENTS } from "../content/achievements";
import { getConfig } from "../config";
import { hashPassword, verifyPassword } from "../services/password";
import { newId } from "../services/ids";

async function meta(db: Db, key: string): Promise<string | null> {
  try {
    return (await db.get<{ value: string }>("SELECT value FROM schema_meta WHERE key = ?", key))?.value ?? null;
  } catch {
    return null; // tabela ainda não existe
  }
}

async function setMeta(db: Db, key: string, value: string): Promise<void> {
  await db.run(
    "INSERT INTO schema_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    key, value,
  );
}

export async function migrate(db: Db, force = false): Promise<void> {
  if (!force && (await meta(db, "version")) === String(SCHEMA_VERSION)) return;
  await db.exec(db.kind === "postgres" ? schemaForPostgres() : `PRAGMA foreign_keys = ON;\n${SCHEMA_SQL}`);
  // v3: username em bancos criados antes da coluna existir (CREATE TABLE IF NOT EXISTS não altera tabelas).
  try {
    await db.exec("ALTER TABLE users ADD COLUMN username TEXT");
  } catch {
    /* coluna já existe */
  }
  await db.exec("CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username ON users(username)");
  await setMeta(db, "version", String(SCHEMA_VERSION));
}

function contentHash(): string {
  return createHash("sha256").update(JSON.stringify({ s: SCENARIOS, a: ACHIEVEMENTS })).digest("hex").slice(0, 16);
}

export async function seedContent(db: Db, force = false): Promise<void> {
  const hash = contentHash();
  if (!force && (await meta(db, "content_hash")) === hash) return;
  await db.tx(async () => {
    for (const content of Object.values(SCENARIOS)) {
      for (const it of Object.values(content.items)) {
        await db.run(
          `INSERT INTO items(id,name,description,category,weight_g,volume_ml,stackable,max_stack,max_durability,battery_capacity,properties)
           VALUES(?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, category=excluded.category,
             weight_g=excluded.weight_g, volume_ml=excluded.volume_ml, stackable=excluded.stackable, max_stack=excluded.max_stack,
             max_durability=excluded.max_durability, battery_capacity=excluded.battery_capacity, properties=excluded.properties`,
          it.id, it.name, it.description, it.category, it.weightG, it.volumeMl, it.stackable ? 1 : 0, it.maxStack,
          it.maxDurability, it.batteryCapacity, JSON.stringify(it.properties),
        );
        if (it.clothing) {
          await db.run(
            `INSERT INTO clothing(item_id,slot,warmth,water_resistance,protection) VALUES(?,?,?,?,?)
             ON CONFLICT(item_id) DO UPDATE SET slot=excluded.slot, warmth=excluded.warmth, water_resistance=excluded.water_resistance, protection=excluded.protection`,
            it.id, it.clothing.slot, it.clothing.warmth, it.clothing.waterResistance, it.clothing.protection,
          );
        }
      }
      for (const l of Object.values(content.locations)) {
        await db.run(
          `INSERT INTO locations(id,scenario_id,name,description,x,y,terrain,hidden_initially,danger_level,properties)
           VALUES(?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, x=excluded.x, y=excluded.y,
             terrain=excluded.terrain, hidden_initially=excluded.hidden_initially, danger_level=excluded.danger_level, properties=excluded.properties`,
          l.id, content.scenarioId, l.name, l.description, l.x, l.y, l.terrain, l.hiddenInitially ? 1 : 0, l.dangerLevel, JSON.stringify(l.properties),
        );
      }
      for (const k of content.links) {
        await db.run(
          `INSERT INTO location_links(from_id,to_id,base_minutes,hidden,risk) VALUES(?,?,?,?,?)
           ON CONFLICT(from_id,to_id) DO UPDATE SET base_minutes=excluded.base_minutes, hidden=excluded.hidden, risk=excluded.risk`,
          k.from, k.to, k.minutes, k.hidden ? 1 : 0, k.risk,
        );
      }
      for (const ev of content.events) {
        await db.run(
          `INSERT INTO events(id,scenario_id,title,body,location_id,trigger,priority,repeatable) VALUES(?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET title=excluded.title, body=excluded.body, location_id=excluded.location_id,
             trigger=excluded.trigger, priority=excluded.priority, repeatable=excluded.repeatable`,
          ev.id, content.scenarioId, ev.title, ev.body, ev.locationId, JSON.stringify(ev.trigger), ev.priority, ev.repeatable ? 1 : 0,
        );
        for (const [i, ch] of ev.choices.entries()) {
          await db.run(
            `INSERT INTO event_choices(id,event_id,label,duration_minutes,requirements,outcome,safe,sort_order) VALUES(?,?,?,?,?,?,?,?)
             ON CONFLICT(id) DO UPDATE SET label=excluded.label, duration_minutes=excluded.duration_minutes,
               requirements=excluded.requirements, outcome=excluded.outcome, safe=excluded.safe, sort_order=excluded.sort_order`,
            ch.id, ev.id, ch.label, ch.durationMinutes, JSON.stringify(ch.requirements ?? {}), JSON.stringify(ch.outcome), ch.safe ? 1 : 0, i,
          );
        }
      }
    }
    for (const a of ACHIEVEMENTS) {
      await db.run(
        `INSERT INTO achievements(id,name,description,icon,points,hidden) VALUES(?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, icon=excluded.icon, points=excluded.points, hidden=excluded.hidden`,
        a.id, a.name, a.description, a.icon, a.points, a.hidden ? 1 : 0,
      );
    }
    await setMeta(db, "content_hash", hash);
  });
}

/**
 * O ADM MASTER só nasce aqui, a partir de ADMIN_EMAIL/ADMIN_PASSWORD (e ADMIN_USERNAME opcional).
 * Nunca pela API. A cada boot: garante papel master, nome de usuário, premium (sem ocupar vaga
 * de pioneiro) e sincroniza a senha com o .env (trocar a senha no .env passa a valer).
 */
export async function ensureMasterAdmin(db: Db): Promise<void> {
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_USERNAME } = getConfig();
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return;
  const email = ADMIN_EMAIL.trim().toLowerCase();
  const username = ADMIN_USERNAME?.trim().toLowerCase() ?? null;
  const now = nowIso();
  await db.tx(async () => {
    await db.lock("ensure-master");
    let user = await db.get<{ id: string; role: string; password_hash: string | null; username: string | null; status: string }>(
      "SELECT id, role, password_hash, username, status FROM users WHERE email = ? OR (username IS NOT NULL AND username = ?)",
      email, username,
    );
    if (!user) {
      const id = newId();
      await db.run(
        "INSERT INTO users(id,email,username,password_hash,role,status,email_verified,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
        id, email, username, hashPassword(ADMIN_PASSWORD), "master", "active", 1, now, now,
      );
      await db.run("INSERT INTO profiles(user_id,display_name,avatar,created_at,updated_at) VALUES(?,?,?,?,?)", id, username ?? "ADM Master", "radio", now, now);
      user = { id, role: "master", password_hash: null, username, status: "active" };
    } else {
      if (user.role !== "master" || user.status !== "active" || user.username !== username) {
        await db.run("UPDATE users SET role='master', status='active', username=?, updated_at=? WHERE id=?", username, now, user.id);
      }
      if (!verifyPassword(ADMIN_PASSWORD, user.password_hash)) {
        await db.run("UPDATE users SET password_hash=?, updated_at=? WHERE id=?", hashPassword(ADMIN_PASSWORD), now, user.id);
      }
    }
    await db.run(
      `INSERT INTO premium_status(user_id,is_premium,source,granted_at) VALUES(?,1,'admin_grant',?)
       ON CONFLICT(user_id) DO UPDATE SET is_premium=1, revoked_at=NULL`,
      user.id, now,
    );
  });
}

export async function bootDatabase(db: Db): Promise<void> {
  await migrate(db);
  await seedContent(db);
  await ensureMasterAdmin(db);
}
