/**
 * Prepara o banco configurado (DATABASE_URL → Postgres/Supabase; senão SQLite local):
 * cria tabelas + RLS, sincroniza o conteúdo e garante o ADM MASTER.
 *
 *   npm run db:migrate
 */
import { openDb, setDb } from "./database";
import { migrate, seedContent, ensureMasterAdmin } from "./seed";
import { schemaTables } from "./schema";
import { getConfig } from "../config";

async function main() {
  const c = getConfig();
  const target = c.DATABASE_URL ? `Postgres (${new URL(c.DATABASE_URL).host})` : `SQLite (${c.DATABASE_PATH})`;
  console.log(`→ Banco: ${target}`);
  const db = await openDb();
  setDb(db);
  await migrate(db, true);
  await seedContent(db, true);
  await ensureMasterAdmin(db);
  for (const t of schemaTables()) {
    const r = await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`);
    console.log(`  ${t.padEnd(22)} ${String(r?.n ?? 0).padStart(5)} linhas`);
  }
  console.log(c.ADMIN_EMAIL ? `✓ Pronto. ADM MASTER: ${c.ADMIN_EMAIL}` : "✓ Pronto. (ADMIN_EMAIL não definido: nenhum ADM MASTER criado)");
  await db.close();
}

main().catch((err) => {
  console.error("✗ Falhou:", err instanceof Error ? err.message : err);
  process.exit(1);
});
