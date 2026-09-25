/**
 * Gera supabase/setup.sql: schema Postgres (com RLS) + conteúdo do jogo, pronto para
 * colar no SQL Editor do Supabase. Usa as MESMAS funções de migração/seed do app,
 * gravando o SQL em vez de executar.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/gen-supabase-sql.ts
 */
import fs from "node:fs";
import path from "node:path";
import type { Db, Param } from "../src/server/db/database";
import { migrate, seedContent } from "../src/server/db/seed";

const lines: string[] = [];

const lit = (v: Param): string => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  return `'${String(v).replace(/'/g, "''")}'`;
};

/** Substitui cada `?` (fora de literais) pelo valor já escapado. */
function inline(sql: string, params: Param[]): string {
  let i = 0;
  let inStr = false;
  let out = "";
  for (const ch of sql) {
    if (ch === "'") inStr = !inStr;
    out += ch === "?" && !inStr ? lit(params[i++]) : ch;
  }
  if (i !== params.length) throw new Error(`placeholders (${i}) ≠ parâmetros (${params.length}): ${sql.slice(0, 80)}`);
  return out;
}

const recorder = {
  kind: "postgres" as const,
  async get() {
    return undefined; // força migração e seed completos
  },
  async all() {
    return [];
  },
  async run(sql: string, ...params: Param[]) {
    lines.push(inline(sql.trim(), params) + ";");
    return { changes: 1, rows: [] };
  },
  async exec(script: string) {
    // Migração v3 tenta ADD COLUMN (já existe no CREATE) — no SQL final usamos a forma idempotente.
    if (/ALTER TABLE users ADD COLUMN username/.test(script)) {
      lines.push("ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;");
      return;
    }
    const s = script.trim();
    lines.push(s.endsWith(";") ? s : `${s};`);
  },
  async tx<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  },
  async lock() {},
} as unknown as Db;

async function main() {
  await migrate(recorder, true);
  await seedContent(recorder, true);
  const header = `-- ============================================================
-- Linha de Sobrevivência — setup do banco (Supabase / PostgreSQL)
-- Gerado por scripts/gen-supabase-sql.ts em ${new Date().toISOString()}
--
-- Cole TUDO no Supabase → SQL Editor → New query → Run.
-- É idempotente: pode rodar de novo sem apagar dados de jogo.
-- Cria as tabelas com RLS (a chave anon/pública não lê nada pela API REST)
-- e carrega o conteúdo do jogo. O ADM MASTER é criado pelo app no 1º acesso
-- (ADMIN_EMAIL / ADMIN_USERNAME / ADMIN_PASSWORD nas variáveis da Vercel).
-- ============================================================
BEGIN;
`;
  const sql = `${header}\n${lines.join("\n\n")}\n\nCOMMIT;\n`;
  const out = path.join(process.cwd(), "supabase", "setup.sql");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, sql);
  console.log(`✓ ${out} (${(sql.length / 1024).toFixed(0)} KB, ${lines.length} blocos)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
