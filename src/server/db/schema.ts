/**
 * Schema SQL (SQLite). Escrito de forma portável para PostgreSQL:
 * ids TEXT (UUID), timestamps ISO-8601, JSON em TEXT (→ JSONB no Postgres).
 *
 * Regras de exclusão:
 *  - Excluir usuário → CASCADE em sessões, perfil, premium, membros, personagens,
 *    conquistas e ranking. Campanhas de que ele é dono → CASCADE (a campanha some).
 *  - Excluir campanha → CASCADE em membros, convites, personagens, eventos,
 *    ações, pistas e estado do mundo.
 *  - Itens do catálogo são RESTRICT (não se apaga item em uso).
 *  - Logs administrativos e de IA → SET NULL (o log sobrevive ao alvo).
 */
export const SCHEMA_VERSION = 3;

export const SCHEMA_SQL = /* sql */ `

CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ============ Identidade e acesso ============
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  username TEXT,                                      -- opcional; só contas criadas pelo servidor (ADM MASTER)
  password_hash TEXT,                                 -- NULL para contas só-OAuth
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','master')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','banned')),
  email_verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  avatar TEXT NOT NULL DEFAULT 'bussola',
  bio TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (provider, provider_user_id)
);
CREATE INDEX IF NOT EXISTS idx_oauth_user ON oauth_accounts(user_id);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,                                -- SHA-256 do token (token nunca é salvo)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_resets_user ON password_resets(user_id);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL COLLATE NOCASE,
  ip TEXT,
  success INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_email_time ON login_attempts(email, created_at);
CREATE INDEX IF NOT EXISTS idx_login_ip_time ON login_attempts(ip, created_at);

CREATE TABLE IF NOT EXISTS premium_status (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  is_premium INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL CHECK (source IN ('early_adopter','admin_grant')),
  slot_number INTEGER UNIQUE,                         -- 1..12 para early adopters; nunca reaproveitado
  granted_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS mail_outbox (                -- mailer de desenvolvimento
  id TEXT PRIMARY KEY,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- ============ Conteúdo (catálogo) ============
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  weight_g INTEGER NOT NULL CHECK (weight_g >= 0),
  volume_ml INTEGER NOT NULL CHECK (volume_ml >= 0),
  stackable INTEGER NOT NULL DEFAULT 0,
  max_stack INTEGER NOT NULL DEFAULT 1,
  max_durability INTEGER,
  battery_capacity INTEGER,
  properties TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS clothing (
  item_id TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  slot TEXT NOT NULL,
  warmth REAL NOT NULL,
  water_resistance INTEGER NOT NULL,
  protection INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  terrain TEXT NOT NULL,
  hidden_initially INTEGER NOT NULL DEFAULT 0,
  danger_level INTEGER NOT NULL DEFAULT 0,
  properties TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_locations_scenario ON locations(scenario_id);

CREATE TABLE IF NOT EXISTS location_links (
  from_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  to_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  base_minutes INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  risk INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (from_id, to_id)
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  location_id TEXT REFERENCES locations(id) ON DELETE SET NULL,
  trigger TEXT NOT NULL DEFAULT '{}',
  priority INTEGER NOT NULL DEFAULT 0,
  repeatable INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS event_choices (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  requirements TEXT NOT NULL DEFAULT '{}',
  outcome TEXT NOT NULL,
  safe INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_choices_event ON event_choices(event_id);

CREATE TABLE IF NOT EXISTS achievements (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 10,
  hidden INTEGER NOT NULL DEFAULT 0
);

-- ============ Campanhas ============
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scenario_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('solo','coop')),
  status TEXT NOT NULL DEFAULT 'lobby' CHECK (status IN ('lobby','active','finished')),
  max_players INTEGER NOT NULL DEFAULT 4 CHECK (max_players BETWEEN 1 AND 4),
  seed TEXT NOT NULL,
  game_minutes INTEGER NOT NULL DEFAULT 0,
  current_round INTEGER NOT NULL DEFAULT 1,
  round_deadline_at TEXT,
  last_heartbeat_at TEXT,
  flags TEXT NOT NULL DEFAULT '{}',
  ending TEXT,
  ending_type TEXT CHECK (ending_type IN ('victory','defeat','abandoned')),
  version INTEGER NOT NULL DEFAULT 0,                 -- controle otimista / autosave
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_campaigns_owner ON campaigns(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);

CREATE TABLE IF NOT EXISTS campaign_members (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','player')),
  joined_at TEXT NOT NULL,
  last_seen_at TEXT,
  UNIQUE (campaign_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON campaign_members(user_id);

CREATE TABLE IF NOT EXISTS campaign_invites (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,                     -- SHA-256; o código só é exibido na criação
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  max_uses INTEGER NOT NULL DEFAULT 3,
  uses INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invites_campaign ON campaign_invites(campaign_id);

CREATE TABLE IF NOT EXISTS campaign_locations (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  discovered INTEGER NOT NULL DEFAULT 0,
  visited INTEGER NOT NULL DEFAULT 0,
  examined INTEGER NOT NULL DEFAULT 0,
  loot_state TEXT NOT NULL DEFAULT '[]',
  shelter_built INTEGER NOT NULL DEFAULT 0,
  fire_until_minute INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (campaign_id, location_id)
);

CREATE TABLE IF NOT EXISTS campaign_links (             -- trilhas reveladas por campanha
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  PRIMARY KEY (campaign_id, from_id, to_id)
);

CREATE TABLE IF NOT EXISTS ground_items (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  state TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_ground_campaign_loc ON ground_items(campaign_id, location_id);

CREATE TABLE IF NOT EXISTS campaign_events (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('active','resolved')),
  participants TEXT NOT NULL DEFAULT '[]',
  chosen_choice_id TEXT,
  round_triggered INTEGER NOT NULL,
  triggered_at_minute INTEGER NOT NULL,
  resolved_at_minute INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cevents_campaign_status ON campaign_events(campaign_id, status);

CREATE TABLE IF NOT EXISTS campaign_clues (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  clue_key TEXT NOT NULL,
  character_id TEXT,
  found_at_minute INTEGER NOT NULL,
  PRIMARY KEY (campaign_id, clue_key)
);

CREATE TABLE IF NOT EXISTS campaign_log (                -- feed de mensagens da campanha
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  character_id TEXT,                                   -- NULL = visível a todos
  game_minute INTEGER NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clog_campaign ON campaign_log(campaign_id, id);

-- ============ Personagens ============
CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  age INTEGER NOT NULL,
  height_cm INTEGER NOT NULL,
  weight_kg INTEGER NOT NULL,
  body_type TEXT NOT NULL,
  conditioning TEXT NOT NULL,
  profession TEXT NOT NULL,
  knowledge TEXT NOT NULL DEFAULT '',
  fears TEXT NOT NULL DEFAULT '',
  history TEXT NOT NULL DEFAULT '',
  personality TEXT NOT NULL DEFAULT '',
  experiences TEXT NOT NULL DEFAULT '[]',
  alive INTEGER NOT NULL DEFAULT 1,
  death_cause TEXT,
  died_at_minute INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (campaign_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_characters_user ON characters(user_id);

CREATE TABLE IF NOT EXISTS character_attributes (
  character_id TEXT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  forca INTEGER NOT NULL CHECK (forca BETWEEN 1 AND 8),
  resistencia INTEGER NOT NULL CHECK (resistencia BETWEEN 1 AND 8),
  agilidade INTEGER NOT NULL CHECK (agilidade BETWEEN 1 AND 8),
  percepcao INTEGER NOT NULL CHECK (percepcao BETWEEN 1 AND 8),
  inteligencia INTEGER NOT NULL CHECK (inteligencia BETWEEN 1 AND 8),
  controle_emocional INTEGER NOT NULL CHECK (controle_emocional BETWEEN 1 AND 8),
  medicina INTEGER NOT NULL CHECK (medicina BETWEEN 1 AND 8),
  orientacao INTEGER NOT NULL CHECK (orientacao BETWEEN 1 AND 8),
  comunicacao INTEGER NOT NULL CHECK (comunicacao BETWEEN 1 AND 8),
  furtividade INTEGER NOT NULL CHECK (furtividade BETWEEN 1 AND 8),
  improviso INTEGER NOT NULL CHECK (improviso BETWEEN 1 AND 8),
  conhecimento_tecnico INTEGER NOT NULL CHECK (conhecimento_tecnico BETWEEN 1 AND 8)
);

CREATE TABLE IF NOT EXISTS character_status (
  character_id TEXT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL REFERENCES locations(id),
  hunger REAL NOT NULL,
  thirst REAL NOT NULL,
  energy REAL NOT NULL,
  fatigue REAL NOT NULL,
  pain REAL NOT NULL,
  stress REAL NOT NULL,
  body_temp REAL NOT NULL,
  wetness REAL NOT NULL,
  awake_minutes INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS health_states (
  character_id TEXT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  health REAL NOT NULL,
  infection REAL NOT NULL DEFAULT 0,
  mobility REAL NOT NULL DEFAULT 100,
  diseases TEXT NOT NULL DEFAULT '[]',
  limbs TEXT NOT NULL DEFAULT '{}',
  painkiller_until INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wounds (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  body_part TEXT NOT NULL,
  type TEXT NOT NULL,
  severity INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 3),
  bleeding_rate REAL NOT NULL DEFAULT 0,
  bandaged INTEGER NOT NULL DEFAULT 0,
  disinfected INTEGER NOT NULL DEFAULT 0,
  splinted INTEGER NOT NULL DEFAULT 0,
  created_at_minute INTEGER NOT NULL,
  healed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wounds_character ON wounds(character_id);

CREATE TABLE IF NOT EXISTS inventories (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL UNIQUE REFERENCES characters(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY,
  inventory_id TEXT NOT NULL REFERENCES inventories(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  container TEXT NOT NULL CHECK (container IN ('equipped','pockets','backpack_main','backpack_side','hands')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  durability INTEGER,
  battery INTEGER,
  uses_left INTEGER,
  wetness INTEGER NOT NULL DEFAULT 0,
  contaminated INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invitems_inventory ON inventory_items(inventory_id);

-- ============ Ações ============
CREATE TABLE IF NOT EXISTS player_actions (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  round INTEGER NOT NULL,
  type TEXT NOT NULL,
  params TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','resolved','cancelled')),
  auto INTEGER NOT NULL DEFAULT 0,
  submitted_at TEXT NOT NULL,
  completes_at TEXT NOT NULL,
  UNIQUE (character_id, idempotency_key)
);
-- Impede duas ações ativas na mesma rodada para o mesmo personagem.
CREATE UNIQUE INDEX IF NOT EXISTS uq_action_round_active
  ON player_actions(character_id, round) WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS idx_actions_campaign_round ON player_actions(campaign_id, round);

CREATE TABLE IF NOT EXISTS action_resolutions (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL UNIQUE REFERENCES player_actions(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  success INTEGER,
  summary TEXT NOT NULL,
  narrative TEXT NOT NULL,
  effects TEXT NOT NULL DEFAULT '[]',
  status_before TEXT NOT NULL,
  status_after TEXT NOT NULL,
  resolved_at_minute INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_resolutions_character ON action_resolutions(character_id);

-- ============ Progressão ============
CREATE TABLE IF NOT EXISTS user_achievements (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  unlocked_at TEXT NOT NULL,
  PRIMARY KEY (user_id, achievement_id)
);

CREATE TABLE IF NOT EXISTS ranking_scores (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  character_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  survived_minutes INTEGER NOT NULL,
  clues_found INTEGER NOT NULL,
  ending TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (campaign_id, character_id)
);
CREATE INDEX IF NOT EXISTS idx_ranking_score ON ranking_scores(score DESC);

-- ============ Auditoria e IA ============
CREATE TABLE IF NOT EXISTS admin_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  details TEXT NOT NULL DEFAULT '{}',
  ip TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_logs_time ON admin_logs(created_at);

CREATE TABLE IF NOT EXISTS security_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  kind TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}',
  ip TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_security_logs_time ON security_logs(created_at);

CREATE TABLE IF NOT EXISTS ai_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  model TEXT,
  purpose TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  prompt_chars INTEGER NOT NULL,
  max_tokens INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok','cache_hit','error','timeout','rejected','budget_exceeded','quota_exceeded','disabled')),
  latency_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd REAL NOT NULL DEFAULT 0,
  error TEXT,
  used_fallback INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_requests_time ON ai_requests(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_requests_user_time ON ai_requests(user_id, created_at);

CREATE TABLE IF NOT EXISTS ai_responses (
  id TEXT PRIMARY KEY,
  request_id TEXT REFERENCES ai_requests(id) ON DELETE SET NULL,
  cache_key TEXT NOT NULL,
  content TEXT NOT NULL,
  valid INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_responses_cache ON ai_responses(cache_key, valid, expires_at);

-- ============ Rate limiting (compartilhado entre instâncias serverless) ============
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start BIGINT NOT NULL,
  count INTEGER NOT NULL
);
`;

/** Tabelas criadas pelo schema (usado para ativar RLS no Postgres). */
export function schemaTables(): string[] {
  return [...SCHEMA_SQL.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
}

/**
 * Versão PostgreSQL do schema. No Supabase o schema `public` é exposto pela API REST
 * para quem tem a chave anon (pública): por isso TODA tabela recebe RLS sem políticas —
 * a API REST não lê nada, e o backend (dono das tabelas) continua com acesso total.
 */
export function schemaForPostgres(): string {
  const body = SCHEMA_SQL.replace(/ COLLATE NOCASE/g, "")
    .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, "BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY")
    .replace(/\bREAL\b/g, "DOUBLE PRECISION");
  const rls = schemaTables()
    .map((t) => `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`)
    .join("\n");
  return `${body}\n${rls}\n`;
}
