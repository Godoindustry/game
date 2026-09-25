# Etapa 1 — Planejamento, ambiguidades e decisões

## Documentos de entrada

| Documento | Situação | O que foi feito |
|---|---|---|
| Prompt geral do projeto | Recebido | Base de todos os requisitos. |
| Documento de game design (Kilo) | **Não recebido** (só o placeholder `[COLE AQUI…]`) | GDD próprio mínimo em [`CAMPANHA-VALE-SILENTE.md`](CAMPANHA-VALE-SILENTE.md), fácil de substituir. |
| Direção visual (GPT) | **Não recebida** como texto | Adotado o mapa `public/assets/mapa-vale-silente.png`, já presente no projeto, como região jogável. A identidade visual inicial foi própria ("dispositivo de sobrevivência") e depois re-estilizada por outro agente ("S-OS v1.4"), mantendo os nomes de classe. |

## Ambiguidades e suposições

1. **Stack.** O pedido era "escolha e justifique", mas a pasta já tinha sido iniciada com `create-next-app` (Next.js 16). Mantive **Next.js 16 + TypeScript**:
   - Um único deploy serve frontend e API, e os segredos ficam no servidor.
   - A lógica **não depende do Next**: `src/server/` é TypeScript puro (motor, serviços, IA, HTTP com `Request`/`Response`). O Next só encaminha `/api/*` para `handleApi()`, e os testes chamam essa mesma função sem subir servidor.
2. **Banco.** PostgreSQL (Supabase) em produção e SQLite nativo (`node:sqlite`) no desenvolvimento e nos testes, atrás da mesma camada assíncrona. Dentro de `db.tx()`, toda consulta usa a mesma conexão via `AsyncLocalStorage`, com SAVEPOINT para transações aninhadas. Corridas críticas (vagas premium, entrada em campanha, resolução de rodada) usam `pg_advisory_xact_lock`; no SQLite, um mutex serializa as transações.
3. **"Tempo real" das ações.** Cada ação tem duração oficial em **minutos de jogo**, calculada pelo servidor. A espera real é `minutos × ACTION_REAL_SECONDS_PER_GAME_MINUTE`, com teto em `ACTION_MAX_REAL_SECONDS` (padrão 0,5 s/min e 60 s). Dormir 8 h não prende o jogador 8 horas reais.
4. **Pausa offline.** O tempo de jogo **só avança quando uma rodada é resolvida**. Ninguém perde água, comida ou vida desconectado. No cooperativo, se todos ficarem sem sincronizar por `PAUSE_AFTER_SECONDS`, o prazo da rodada é estendido pelo tempo de pausa.
5. **Rodadas.** Solo e cooperativo usam o mesmo mecanismo: a rodada fecha quando todos os vivos agiram (ou o prazo venceu) **e** todas as esperas terminaram. A rodada dura o tempo da ação mais longa, e quem terminou antes fica "aguardando" (gasto metabólico mínimo).
6. **Decisão coletiva.** Em evento de grupo vence a escolha mais votada. No empate, vale o voto do administrador da campanha; sem ele, a ordem das escolhas. **Os testes são individuais:** a mesma decisão pode ferir um e poupar outro.
7. **Premium dos 12 primeiros.** "Primeiros" = primeiros **cadastros** (e-mail ou Google). O ADM MASTER não ocupa vaga, e vaga de conta removida **não** é reaproveitada. Benefícios no MVP: mais campanhas simultâneas (12 contra 3) e cota diária de IA maior (400 contra 40).
8. **Convites.** Código aleatório de 128 bits, armazenado só como hash. Válido por 48 h e até 3 usos. Só funciona com a campanha em lobby e é rejeitado se ela estiver cheia (máx. 4).
9. **Morte.** É permanente para o personagem. No cooperativo o grupo continua. A campanha termina em derrota quando todos morrem, e em vitória quando qualquer final positivo dispara.

## Regras alteradas em relação ao prompt (com justificativa)

| Regra do prompt | Implementação | Motivo |
|---|---|---|
| "Ações rápidas ≈ 2 min" | Mantido, **+2 min** se o item estiver no compartimento principal da mochila | Implementa "acessibilidade do item" pedida no inventário. |
| "Dormir: várias horas" | Opções de 2, 4 ou 8 h; exige sono ≥ 20 | Evita usar "dormir" como pular tempo sem custo. |
| "A rodada avança quando todos confirmarem" | Confirmar = enviar a ação. Cancelar é permitido até o fim da espera | O RNG é determinístico por (semente, rodada, personagem), então cancelar e reenviar **não** re-rola o dado. |

## Arquitetura

```
src/
├─ app/                     Next.js (App Router): só páginas e o encaminhador /api/[...path]
├─ proxy.ts                 redireciona área logada sem cookie (conveniência; a autorização real é na API)
├─ client/                  frontend: api (CSRF), sessão (zustand), componentes, jogo (mapa, painéis)
└─ server/                  backend, sem dependência do Next
   ├─ config.ts             variáveis de ambiente validadas (zod)
   ├─ db/                   schema SQL, conexão, seed (conteúdo + ADM MASTER)
   ├─ engine/               MOTOR DE REGRAS PURO E DETERMINÍSTICO (sem I/O)
   │   ├─ types, constants, rng
   │   ├─ character   ficha, pontos, carga
   │   ├─ inventory   peso, volume, compartimentos, acessibilidade
   │   ├─ physiology  tempo, fome, sede, energia, sono, temperatura, sangramento, infecção, morte
   │   ├─ effects     testes de atributo e efeitos declarativos do conteúdo
   │   ├─ actions     validação + resolução de cada ação
   │   ├─ events      disparo e resolução de eventos, voto em grupo
   │   ├─ round       resolução de rodada (solo = 1 personagem)
   │   └─ setup       estado inicial e pontuação
   ├─ content/              campanha Vale Silente (itens, locais, eventos, finais, NPC) e conquistas
   ├─ services/             auth, premium, campanhas, jogo, perfil, admin, auditoria, mailer
   ├─ ai/                   AIProvider (mock, OpenAI-compatível, Anthropic) + AIService
   └─ http/                 roteador, CSRF, rate limit, cookies, tabela de rotas
tests/                      vitest: unidade (motor) + integração (HTTP em memória)
```

### Fluxo de uma ação

1. O cliente envia `{type, params, idempotencyKey}`. **Nunca** envia duração, custo nem resultado.
2. O servidor valida sessão, CSRF, participação na campanha, personagem vivo, ação pendente e as regras da ação (local, item, peso, volume, energia, evento).
3. A ação é gravada como `pending` com `completes_at`. Um índice único impede duas ações na mesma rodada, e a chave de idempotência impede duplicar a mesma requisição.
4. Quando a rodada pode fechar, qualquer `sync` resolve: o motor roda de forma determinística, a IA gera **apenas texto** (fora da transação) e tudo é salvo **numa única transação** com controle otimista de versão (`campaigns.version`). Duas resoluções concorrentes nunca aplicam a rodada duas vezes.

### IA sob controle do motor

- A IA recebe só contexto mínimo: nome do local, hora, temperatura, resumo e fatos já decididos. Nunca recebe e-mail, senha ou ids.
- Ela devolve **texto** (ambientação, fala do NPC) ou **uma intenção de uma lista fechada** (conversa com NPC). Os efeitos de cada intenção estão no conteúdo e são aplicados pelo motor.
- Toda saída passa por validação zod, sanitização (sem HTML nem caracteres de controle), filtro de conteúdo e anti-injeção, e por regras determinísticas: não pode declarar morte de personagem vivo nem citar números de mecânica.
- Há timeout, cache, cota diária por usuário, orçamento diário global, registro de tokens e custo, e **fallback sempre**: o jogo funciona com `AI_PROVIDER=none`.
