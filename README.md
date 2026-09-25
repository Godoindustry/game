# Linha de Sobrevivência

WebApp de sobrevivência, mistério e terror psicológico: jogo solo ou cooperativo (até 4 jogadores), baseado em decisões com consequências. Cada ação leva tempo, a mochila tem peso e volume, e a morte é permanente.

> Mecânicas médicas e de sobrevivência são **ficção de jogo**, não orientação real.

- Planejamento, suposições e arquitetura: [`docs/PLANEJAMENTO.md`](docs/PLANEJAMENTO.md)
- Banco de dados: [`docs/BANCO.md`](docs/BANCO.md)
- Campanha "Vale Silente" (locais, eventos, finais, pistas, NPC): [`docs/CAMPANHA-VALE-SILENTE.md`](docs/CAMPANHA-VALE-SILENTE.md)

## Stack

| Camada | Escolha | Por quê |
|---|---|---|
| Web | **Next.js 16** (App Router, Turbopack) + React 19 + TypeScript | Um deploy serve páginas e API, e os segredos ficam no servidor. |
| Estado no cliente | Zustand + hook `useGame` com sync/polling | Simples. O servidor é a fonte da verdade. |
| Backend | TypeScript puro em `src/server/` (sem depender do Next) | Testável sem subir servidor. O Next só encaminha `/api/*`. |
| Banco | **PostgreSQL/Supabase** em produção; SQLite (`node:sqlite`) local e nos testes | Mesma camada assíncrona (`src/server/db/database.ts`) com dois adaptadores. |
| Validação | zod | Tudo que entra na API é validado; objetos são estritos. |
| IA | `AIProvider` + cadeia Groq → OpenRouter → Gemini (e Anthropic/mock) | Troca de provedor por variável de ambiente. Fallback sempre. |
| Testes | Vitest | Unidade (motor) + integração (HTTP em memória). |

## Instalação

Requisitos: **Node.js ≥ 22.5** (testado no 26.8) e npm.

```bash
npm install
cp .env.example .env.local      # edite: ADMIN_EMAIL, ADMIN_PASSWORD e, se quiser IA real, as chaves
npm run dev                     # http://localhost:3000
```

Produção local:

```bash
npm run build && npm start
```

Outros comandos:

```bash
npm test            # 80 testes (SQLite em memória)
npm run db:migrate  # cria tabelas + RLS, conteúdo e ADM MASTER no banco configurado
npm run typecheck   # tsc --noEmit
npm run lint        # eslint (inclui regra que proíbe useEffect com corpo de expressão)
```

O banco (`./data/linha.sqlite`) é criado e migrado sozinho no primeiro acesso, e o conteúdo da campanha é sincronizado a cada boot. Para zerar tudo, apague a pasta `data/`.

## Variáveis de ambiente

Veja [`.env.example`](.env.example). As principais:

| Variável | Padrão | Função |
|---|---|---|
| `APP_URL` | `http://localhost:3000` | Links de e-mail, convites e OAuth |
| `DATABASE_URL` | — | Postgres (Supabase, pooler transacional :6543). Sem ela, usa SQLite |
| `DATABASE_PATH` | `./data/linha.sqlite` | Arquivo do SQLite local |
| `TEST_DATABASE_URL` | — | Opcional: roda a suíte no Postgres (pooler de sessão :5432, schema `ls_test`) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | — | **ADM MASTER inicial** (único jeito de existir um master) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | — | Liga o login com Google (redirect: `{APP_URL}/api/auth/google/callback`) |
| `PREMIUM_EARLY_SLOTS` | `12` | Quantos primeiros cadastros ganham premium |
| `ACTION_REAL_SECONDS_PER_GAME_MINUTE` / `ACTION_MAX_REAL_SECONDS` | `0.5` / `60` | Espera real por minuto de jogo e teto |
| `ROUND_TIMEOUT_SECONDS` / `PAUSE_AFTER_SECONDS` | `300` / `60` | Prazo da rodada no coop e detecção de "todos offline" |
| `AI_PROVIDER` | `mock` | `chain`, `mock`, `openai_compatible`, `anthropic` ou `none` |
| `AI_CHAIN` | `groq,openrouter,gemini` | Ordem da cadeia (só entram provedores com chave) |
| `GROQ_API_KEY` / `GROQ_MODEL` | — / `openai/gpt-oss-20b` | Groq |
| `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` | — / `meta-llama/llama-3.3-70b-instruct:free` | OpenRouter |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | — / `gemini-3.1-flash-lite` | Google Gemini (endpoint compatível) |
| `AI_TIMEOUT_MS`, `AI_MAX_OUTPUT_TOKENS`, `AI_MAX_PROMPT_CHARS`, `AI_CACHE_TTL_HOURS` | 6000, 220, 2400, 72 | Limites da IA |
| `AI_DAILY_BUDGET_USD`, `AI_COST_*_PER_MTOK`, `AI_USER_DAILY_REQUESTS`, `AI_PREMIUM_DAILY_REQUESTS` | 1, 0, 40, 400 | Orçamento, custo e cotas |

Chaves de API ficam **só** no `.env.local`, que o git ignora, ou nas variáveis de ambiente do provedor de hospedagem. Nunca vão para o frontend.

## Credenciais de teste (fictícias)

| Papel | Como obter |
|---|---|
| ADM MASTER | Defina `ADMIN_EMAIL=admin@linha.local` e `ADMIN_PASSWORD=TroqueEstaSenha123` no `.env.local`. É criado no boot. |
| Jogador | Cadastre-se em `/cadastro` (ex.: `jogador@linha.local` / `Senha1234`). Os 12 primeiros ganham premium. |
| E-mails (reset de senha) | Em desenvolvimento, aparecem em **Admin → E-mails (dev)** e no console do servidor. |

## Rotas

### Páginas

| Rota | Tela |
|---|---|
| `/` | Início |
| `/entrar`, `/cadastro`, `/esqueci-senha`, `/redefinir-senha?token=` | Autenticação |
| `/painel` | Dashboard: campanhas, criar campanha, entrar por convite |
| `/perfil` | Perfil, estatísticas e conquistas |
| `/ranking` | Ranking |
| `/convite/[code]` | Aceitar convite |
| `/campanha/[id]/personagem` | Criação do personagem (ficha + atributos) |
| `/campanha/[id]/lobby` | Lobby (membros, convite, iniciar) |
| `/campanha/[id]/jogar` | Jogo: mapa, HUD, painel do personagem, mochila, item, evento, espera, resultado, morte e vitória |
| `/admin` | Painel do ADM MASTER |

### API

Todas as mutações exigem o cabeçalho `x-csrf-token`, igual ao cookie `ls_csrf` (obtido em `GET /api/auth/csrf`).

| Método e rota | Acesso | Função |
|---|---|---|
| `GET /api/meta`, `GET /api/meta/character-options` | público | Configuração pública e opções da ficha |
| `GET /api/auth/csrf` | público | Token CSRF |
| `POST /api/auth/register` · `login` · `logout` · `forgot` · `reset` | público | Autenticação |
| `GET /api/auth/me` | público | Usuário da sessão |
| `GET /api/auth/google/start` · `callback` | público | Google OAuth (state + PKCE) |
| `GET/PATCH /api/profile`, `GET /api/achievements`, `GET /api/ranking` | logado | Perfil, conquistas, ranking |
| `GET/POST /api/campaigns` | logado | Listar e criar campanhas |
| `GET /api/campaigns/:id/lobby` | membro | Lobby |
| `POST/DELETE /api/campaigns/:id/invites` | dono | Gerar e revogar convites |
| `POST /api/invites/accept` | logado | Aceitar convite |
| `POST /api/campaigns/:id/character` | membro | Criar personagem |
| `POST /api/campaigns/:id/start` · `end` · `leave` | dono / dono / membro | Ciclo de vida |
| `DELETE /api/campaigns/:id/members/:userId` | dono ou master | Remover participante |
| `GET /api/campaigns/:id/state`, `POST …/sync` | membro | Estado; sync = heartbeat + resolve rodada |
| `POST /api/campaigns/:id/actions`, `DELETE …/actions/pending` | membro | Enviar e cancelar ação |
| `GET /api/admin/stats` · `users` · `campaigns` · `logs` · `outbox` | master | Painel |
| `POST /api/admin/users/:id/action`, `POST /api/admin/campaigns/:id/end` | master | Banir, premium, sessões, encerrar (auditado) |

## Funcionalidades do MVP

- **Contas:** cadastro, login, logout, recuperação de senha, sessões seguras, bloqueio por força bruta, Google OAuth (ativa ao configurar), perfil e premium para os 12 primeiros.
- **Papéis:** usuário, administrador da campanha (dono) e ADM MASTER (só via `.env`). Nenhum usuário consegue se promover.
- **Campanhas:** solo e cooperativo (máx. 4), convites seguros, lobby, início, rodadas com prazo e ação automática segura, pausa quando todos estão offline, remoção de participante e encerramento.
- **Personagem:** ficha completa (físico, profissão, conhecimentos, medos, histórico, personalidade, até 2 experiências) e 24 pontos em 12 atributos, validados no servidor.
- **Motor determinístico:** tempo, fome, sede, energia, sono, dor, estresse, temperatura corporal, umidade, sangramento, infecção, doenças, mobilidade, membros, peso, volume, compartimentos, acessibilidade, durabilidade, bateria, testes de atributo (5–95%), eventos, consequências, morte e finais.
- **Ações:** examinar, procurar, caminhar, descansar, dormir, comer, beber, coletar/purificar/ferver água, tratar ferimento, analgésico, montar abrigo, fogueira, lenha, pegar/largar/mover/equipar itens, conversar com NPC e escolhas de evento. Todas com duração oficial calculada pelo servidor.
- **Conteúdo:** 9 locais, 12 trilhas (3 ocultas), 31 itens, 18 eventos, 18 pistas, 1 NPC, 3 finais positivos + 1 negativo.
- **Salvamento automático:** cada rodada é salva numa transação única com controle de versão.
- **Conquistas (11) e ranking.**
- **IA:** narrativa, fala do NPC e classificação de intenção, com cache, timeout, cotas, orçamento, filtro e fallback.
- **Admin:** estatísticas, uso e custo de IA, usuários, campanhas, auditoria e caixa de e-mails de dev.

## O que foi testado

**Automatizado: 80 testes (`npm test`), todos passando.**

| Área | Cobertura |
|---|---|
| Cadastro e login | hash scrypt, cookie httpOnly, e-mail duplicado, senha fraca, mensagem genérica, bloqueio após 5 falhas, logout invalida a sessão, banido perde acesso |
| Recuperação de senha | link, uso único, derruba sessões antigas, resposta igual para e-mail inexistente |
| Segurança | CSRF ausente → 403, origem estrangeira → 403, `role: "master"` no cadastro → 400, HTML removido do nome |
| Permissões e acesso indevido | não membro recebe 404, jogador comum barrado no admin (e registrado), só o dono convida/inicia/remove, ações do master auditadas |
| Convites e limite de 4 | convite válido, inválido, expirado, revogado; 5º jogador recusado; solo não convida |
| Personagem e atributos | 24 pontos exatos, máximo 6, campos extras rejeitados, bônus de profissão, segunda ficha recusada |
| Mochila | peso total, recusa por volume, recusa por peso máximo, penalidade de carga |
| Água e energia | sede sobe com o tempo (mais caminhando), beber reduz sede e deixa a garrafa vazia, energia cai caminhando e sobe descansando, hipotermia com roupa molhada |
| Duração de ação | 5/10/15/30 min; noite sem luz e carga pesada aumentam a caminhada; cliente não consegue mudar a duração |
| Ferimentos e morte | hemorragia mata, atadura estanca, morto não age, evento pode matar, morte por desidratação encerra a campanha |
| Finalização | derrota com ranking, abandono pelo dono, vitória com ranking e conquista |
| Duplicação de ações | mesma chave de idempotência → mesma ação; segunda ação na rodada → 409; cancelar e reenviar |
| Multiplayer | rodada espera todos, voto majoritário com testes individuais, timeout gera ação segura, pausa estende o prazo sem gastar tempo de jogo |
| Premium | 12 primeiros sim, 13º não, master não ocupa vaga, vaga não é reaproveitada, admin concede/revoga |
| Fallback da IA | erro, timeout, JSON inválido, IA "matando" personagem, conteúdo inseguro, cache, sem provedor, orçamento, prompt grande, cadeia de provedores, jogo segue com a IA fora |
| Salvamento automático | estado idêntico após "reiniciar" o servidor com o mesmo arquivo |
| Concorrência / banco | 20 cadastros simultâneos → 12 premium; 6 aceites simultâneos → 4 membros; 5 syncs simultâneos → rodada resolvida 1 vez; rollback; placeholders e schema Postgres com RLS |
| Fluxo solo completo | do acidente ao resgate pelo rádio (eventos, inventário, deslocamento, vitória, ranking, conquista) |

**Manual:**

- Build de produção (`next build`).
- Fluxo real via HTTP (curl).
- Fluxo completo pela interface no Edge headless em **1440×900 e 390×844**, sem erros de página e sem rolagem horizontal.
- Chamadas reais aos provedores de IA: Groq e Gemini respondem; a cadeia cai para o próximo quando um falha.

## Limitações conhecidas

- **Postgres/Supabase ainda não validado contra o banco real:** o adaptador está pronto e coberto por testes de unidade/concorrência no SQLite, mas a suíte ainda não rodou com `TEST_DATABASE_URL` (falta a string de conexão).
- **Atualização por polling** (3 s no coop, no fim da espera no solo), não WebSocket.
- **E-mail** vai para a caixa de desenvolvimento; falta plugar SMTP/API (ex.: Resend) em produção.
- **Google OAuth** está implementado, mas só foi testado até o redirecionamento (faltam credenciais reais).
- A **IA gratuita** às vezes acrescenta palpites de ambientação que não estão nos fatos. Não altera nenhuma regra, mas o prompt pode ser apertado.
- **CSP** usa `'unsafe-inline'` em scripts (exigência do Next sem nonce). A proteção principal contra XSS é o React escapar todo texto (não há `dangerouslySetInnerHTML`).
- **Mapa no celular** sem zoom/arraste; os rótulos ficam pequenos em telas estreitas.
- Uma região e uma campanha. Clima é só por eventos (chuva), sem sistema contínuo.

## Próximos passos

1. **Deploy Vercel + Supabase** — ver seção abaixo.
2. Mailer real (Resend/SMTP) e credenciais do Google OAuth.
3. Tempo real com WebSocket/Supabase Realtime no cooperativo.
4. Zoom e arraste no mapa; sons ambientes; mais regiões e campanhas.
5. Editor de eventos no painel admin (hoje o conteúdo está em código versionado).

## Deploy: Supabase + Vercel

O código já está pronto; faltam só as credenciais.

1. **Supabase → Connect → Connection string**
   - copie o *Transaction pooler* (porta **6543**) → `DATABASE_URL`;
   - opcional: copie o *Session pooler* (porta **5432**) → `TEST_DATABASE_URL`.
2. **Criar o banco:** com `DATABASE_URL` no `.env.local`, rode `npm run db:migrate`.
   - Cria as tabelas no schema `public` **com RLS ativado em todas**: a chave `anon`, que é pública, não lê nada pela API REST do Supabase. O backend conecta como dono das tabelas.
   - Também sincroniza o conteúdo e cria o ADM MASTER.
3. **Validar no Postgres (opcional):** `TEST_DATABASE_URL=… npm test` roda os 80 testes no schema isolado `ls_test`, sem tocar em `public`.
4. **Vercel:** importe o repositório (GitHub) ou use `npx vercel`. Em *Settings → Environment Variables*, defina:
   - `DATABASE_URL`
   - `APP_URL` (URL final, ex.: `https://linha.vercel.app`)
   - `ADMIN_EMAIL`, `ADMIN_PASSWORD`
   - `AI_PROVIDER=chain` e as chaves `GROQ_API_KEY` / `GEMINI_API_KEY` / `OPENROUTER_API_KEY`
   - opcionais: `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` (redirect `{APP_URL}/api/auth/google/callback`)
5. **Node:** o projeto usa Node ≥ 22.5 (padrão atual da Vercel).
   - A rota da API roda no runtime Node com `maxDuration = 30` s, porque resolver uma rodada pode chamar a IA.
   - O rate limit fica na tabela `rate_limits` e vale entre todas as instâncias serverless.

As chaves `service_role` / `sb_secret` do Supabase **não são usadas** e nunca devem ir para variáveis públicas (`NEXT_PUBLIC_*`).

## Tags de expressão (voz)

Frases de eventos, resultados, finais e narrações da IA podem trazer **tags de expressão escondidas**, entre colchetes e em inglês, logo antes do trecho que afetam:

```
[whispers] “sete… quatro… zero…” [pause] [ominous] Ninguém sabe que você está aqui.
```

- **Onde ficam:** a lista permitida está em [`src/shared/voiceTags.ts`](src/shared/voiceTags.ts). Exemplos: `[whispers]`, `[sighs]`, `[gasps]`, `[trembling]`, `[ominous]`, `[relieved]`, `[pause]`, `[long pause]`.
- **Tela:** a API entrega `text`, **sem** tags, para exibir.
- **Voz:** a API entrega `voice`, **com** as tags permitidas, para o modelo de voz. Vale para eventos, diário e finais.
- **IA:** ela só pode usar tags da lista; qualquer tag inventada é removida.
- **ElevenLabs:** gere os áudios com `npm run audio:generate` (precisa de `ELEVENLABS_API_KEY` no `.env.local`).
  - O modelo padrão `eleven_v3` interpreta as tags como entonação.
  - Com modelos sem suporte (ex.: `eleven_multilingual_v2`), o script remove as tags antes de enviar, para não serem lidas em voz alta.
