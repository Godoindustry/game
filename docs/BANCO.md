# Estrutura do banco de dados

Fonte da verdade: [`src/server/db/schema.ts`](../src/server/db/schema.ts), um único SQL. A versão PostgreSQL é derivada dele por `schemaForPostgres()`: identity no lugar de AUTOINCREMENT, `DOUBLE PRECISION`, sem `COLLATE NOCASE` e **RLS ativado em todas as tabelas** (no Supabase, o schema `public` é exposto pela API REST à chave `anon`).

A migração roda no boot só quando `schema_meta.version` muda, e o conteúdo é sincronizado só quando o hash dele muda. Também dá para rodar explicitamente com `npm run db:migrate`.

Convenções: ids `TEXT` (UUID), timestamps ISO-8601 em UTC, JSON em `TEXT` (vira `JSONB` numa migração para PostgreSQL) e `PRAGMA foreign_keys = ON`.

## Identidade e acesso

| Tabela | Chave | Relacionamentos / regras | Índices |
|---|---|---|---|
| `users` | `id` | `email` UNIQUE (case-insensitive); `role` ∈ {user, master}; `status` ∈ {active, banned} | email |
| `profiles` | `user_id` | → users **CASCADE** | — |
| `oauth_accounts` | `id` | → users CASCADE; UNIQUE(provider, provider_user_id) | user_id |
| `sessions` | `id` = SHA-256 do token | → users CASCADE; `expires_at` | user_id, expires_at |
| `password_resets` | `id` | → users CASCADE; `token_hash` UNIQUE; uso único; 30 min | user_id |
| `login_attempts` | autoincremento | base do bloqueio por força bruta | (email, created_at), (ip, created_at) |
| `premium_status` | `user_id` | → users CASCADE; `slot_number` **UNIQUE** (1–12, nunca reaproveitado) | — |
| `mail_outbox` | `id` | e-mails do mailer de desenvolvimento | — |

## Catálogo (conteúdo)

| Tabela | Chave | Observações |
|---|---|---|
| `items` | `id` | peso (g), volume (ml), empilhável, durabilidade e bateria máximas, `properties` JSON |
| `clothing` | `item_id` → items CASCADE | slot, calor, impermeabilidade, proteção |
| `locations` | `id` | cenário, posição x/y (% do mapa), terreno, perigo, `properties` JSON (loot, água, abrigo…) |
| `location_links` | (from_id, to_id) → locations CASCADE | minutos base, oculto, risco |
| `events` | `id` | local (SET NULL), gatilho JSON, prioridade, repetível |
| `event_choices` | `id` → events CASCADE | duração, requisitos JSON, resultado JSON, `safe` (usada no timeout) |
| `achievements` | `id` | pontos, oculta |

## Campanha

| Tabela | Chave | Relacionamentos / regras | Índices |
|---|---|---|---|
| `campaigns` | `id` | dono → users CASCADE; status ∈ {lobby, active, finished}; `max_players` 1–4; `seed`; `game_minutes`; `current_round`; `round_deadline_at`; `last_heartbeat_at`; `flags` JSON; `ending`/`ending_type`; **`version`** (controle otimista) | owner, status |
| `campaign_members` | `id` | → campaigns CASCADE, → users CASCADE; UNIQUE(campaign_id, user_id); role ∈ {owner, player} | user_id |
| `campaign_invites` | `id` | → campaigns CASCADE; `code_hash` UNIQUE; usos/máximo; validade; revogação | campaign_id |
| `campaign_locations` | (campaign_id, location_id) | descoberto/visitado/examinado, loot restante, abrigo, fogueira | — |
| `campaign_links` | (campaign_id, from, to) | trilhas ocultas já reveladas | — |
| `ground_items` | `id` | itens no chão por local; item → items RESTRICT | (campaign_id, location_id) |
| `campaign_events` | `id` | evento ativo/resolvido, participantes JSON, escolha vencedora | (campaign_id, status) |
| `campaign_clues` | (campaign_id, clue_key) | quem achou e quando | — |
| `campaign_log` | autoincremento | diário; `character_id` NULL = público | (campaign_id, id) |

## Personagem

| Tabela | Chave | Observações |
|---|---|---|
| `characters` | `id` | → users CASCADE, → campaigns CASCADE; UNIQUE(campaign_id, user_id); ficha, vivo, causa e minuto da morte |
| `character_attributes` | `character_id` | 12 atributos com CHECK 1–8 |
| `character_status` | `character_id` | local, fome, sede, energia, sono, dor, estresse, temperatura, umidade |
| `health_states` | `character_id` | saúde, infecção, mobilidade, doenças JSON, membros JSON, analgésico |
| `wounds` | `id` → characters CASCADE | parte, tipo, gravidade 1–3, sangramento/h, enfaixado, limpo, imobilizado, curado |
| `inventories` | `id` | 1:1 com o personagem |
| `inventory_items` | `id` → inventories CASCADE | item → items RESTRICT; compartimento (CHECK); quantidade > 0; durabilidade, bateria, usos, umidade, contaminação |

## Ações

| Tabela | Chave | Regras |
|---|---|---|
| `player_actions` | `id` | UNIQUE(character_id, idempotency_key); **índice único parcial (character_id, round) onde status ≠ cancelled** (impede duas ações na rodada); `auto` = ação automática por timeout |
| `action_resolutions` | `id` | `action_id` UNIQUE → player_actions CASCADE; sucesso, resumo, narrativa, efeitos, estado final |

## Progressão, auditoria e IA

| Tabela | Chave | Observações |
|---|---|---|
| `user_achievements` | (user_id, achievement_id) | campanha → SET NULL |
| `ranking_scores` | `id` | UNIQUE(campaign_id, character_id); índice por score DESC |
| `admin_logs` | `id` | ator → users **SET NULL** (o log sobrevive) |
| `security_logs` | autoincremento | login, falhas, bloqueios, acessos negados, rate limit |
| `ai_requests` | `id` | provedor, modelo, finalidade, status (ok, cache_hit, error, timeout, rejected, budget_exceeded, quota_exceeded, disabled), latência, tokens, custo, fallback |
| `ai_responses` | `id` | cache por `cache_key` com validade |

## Infraestrutura

| Tabela | Chave | Observações |
|---|---|---|
| `schema_meta` | `key` | versão do schema, hash do conteúdo |
| `rate_limits` | `key` | janela fixa por IP e tipo de rota; UPSERT atômico com `RETURNING`; vale entre instâncias serverless |
