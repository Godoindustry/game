# Campanha inicial — Vale Silente

> Conteúdo em [`src/server/content/valeSilente.ts`](../src/server/content/valeSilente.ts). Os efeitos são **dados declarativos** aplicados pelo motor. Nenhum evento chama código arbitrário, e a IA nunca decide efeitos.

## Premissa

23h40. Um bimotor de táxi aéreo cai entre as árvores de um vale de mata fechada. O personagem acorda preso ao assento. A cabine está vazia e o cinto do piloto **foi cortado**. No rádio do painel, uma voz de mulher repete números: *sete… quatro… zero…*

A explicação é realista: o piloto foi pago para desviar o voo e entregar uma carga ilegal numa pista clandestina do vale. Os números, 0-7-4, são o **rumo de pouso** dessa pista, e a voz é uma gravação de Iara Menezes, a hidróloga que viu os pousos em 1998 e desapareceu. Os traficantes usam a voz dela como farol até hoje. Mas algumas coisas, como a voz na névoa, a mulher na febre e o seu nome no celular, **não têm explicação**.

## Região (mapa `public/assets/mapa-vale-silente.png`)

| Local | Papel | Destaques |
|---|---|---|
| Destroços do bimotor | Início | Bagageiro com a **bateria de emergência** (item essencial), jaqueta e kit médico |
| Mata do Vale | Mata | Lenha, abrigo; evento noturno "Alguém chama seu nome" |
| Acampamento abandonado | **Abrigo inicial** | Abrigo natural, caneca, corda; 37 riscos e o nome IARA |
| Trilha da crista | Trilha | Marcas de tinta; revela o atalho para a estação |
| Ponte do córrego | **Córrego** | Água (não tratada), peixes mortos: diesel |
| Poço escuro | Lago | Água; atalho oculto para o rochedo |
| Estação de rádio | **Construção abandonada** | Rádio de bancada, diário de 1998, o piloto (NPC) |
| Mirante do penhasco | **Ponto de perigo** | Descer a ravina (sem corda pode **matar**); voz na névoa |
| Rochedo do marco | Oculto | Caixa com cadeado 7-4-0 (sinalizadores); céu aberto para resgate |

## Eventos (25)

`vs_despertar` (início), `vs_bagageiro`, `vs_vozes`, `vs_acampamento`, `vs_chuva`, `vs_ponte`, `vs_estacao_portao`, `vs_estacao_interior`, `vs_piloto`, `vs_radio`, `vs_penhasco`, `vs_nevoa`, `vs_rochedo`, `vs_helicoptero`, `vs_resgate`, `vs_febre`, `vs_sede`, `vs_frio`, e:

| Evento | Onde / quando | O que muda |
|---|---|---|
| `vs_poco` — O olho d'água | Poço escuro | Mergulhar ou pescar a bolsa de Iara (crachá, pista) |
| `vs_trilha` — Gotas no caminho | Trilha da crista | Rastro de sangue do piloto (revela a trilha à estação); laço de caçador |
| `vs_queixadas` — Estalo de dentes | Mata, de dia | Bando de queixadas: subir, ficar imóvel ou recuar |
| `vs_celular` — 23h40 | Qualquer lugar, na 2ª noite, com o celular | A gravação diz o seu nome; pede para proteger a caixa |
| `vs_brandao_ferida` — A perna do comandante | Estação, depois de ganhar a confiança dele | Tratar a perna → ele revela o rumo 074 e topa confessar pelo rádio |
| `vs_donos_carga` — Motor na ponte | Ponte, dia 2 a partir de 10h40 | Os donos da carga chegam armados; ser visto liga a caçada |
| `vs_cacada` — Faróis entre as árvores | Qualquer lugar, à noite, se eles te viram | Esconder, correr ou deitar; pode ferir |

Os eventos disparam por local, hora (dia/noite), flags, eventos anteriores, itens e estado físico (sede ≥ 75, infecção ≥ 55, temperatura ≤ 35,2 °C). As decisões mudam a sequência. Exemplos:

- ficar e observar na mata revela a trilha para a estação;
- ler o diário ou sintonizar o rádio revela o rochedo;
- ter a corda muda a chance de sobreviver à ravina.

## Finais

| Final | Tipo | Como chegar |
|---|---|---|
| Frequência aberta (`resgate_radio`) | ✅ vitória | Levar a bateria (3,2 kg!) até a estação e ligar o rádio (conhecimento técnico) |
| Fumaça vermelha (`resgate_sinalizador`) | ✅ vitória | De dia, depois do helicóptero, disparar um sinalizador num ponto de céu aberto |
| Coluna de fumaça (`resgate_fogueira`) | ✅ vitória | Fogueira de sinal num ponto de céu aberto |
| A verdade na frequência (`a_verdade`) | ✅ vitória (melhor final) | Tratar a perna de Brandão, ouvir o rumo 074 e ligar o rádio com ele para denunciar a rota. Conquista oculta "Rumo 074" |
| O vale fica com você (`morte`) | ❌ derrota | Todos os personagens mortos (hemorragia, hipotermia, desidratação, queda, névoa…) |

## Pistas (27)

ELT desligado, resposta na mata, pouso tentado, caderno de voo, luz na crista, 37 riscos, diesel no córrego, cerca remendada, diário de Iara, três alfinetes, piloto vivo, a frequência, carga na ravina, sinal para baixo, sua própria voz, a foto, trinta e sete dias, a confissão, marcas de pneu, o crachá, rastro de sangue, o laço, uma gravação, “não deixa eles levarem”, rumo 074, perdida na mata, os donos da carga.

Ponte, estação, mirante e rochedo agora também têm texto ao **examinar** (pneus de quadriciclo, gerador furado a bala, grampos de escalada, 074° riscado no marco).

## NPC — Comandante Brandão

Aparece na estação. A conversa é **texto livre**, e a IA (ou o classificador por palavras-chave) só escolhe uma intenção de uma lista fechada:

`perguntar_acidente`, `perguntar_caminho`, `pedir_ajuda`, `oferecer_item`, `acalmar`, `ameacar`, `perguntar_numeros`, `outro`.

Cada intenção tem efeitos fixos no conteúdo (pista, confiança, revelar caminho, fuga do NPC), e a IA só escreve a fala dele.

## Sistemas cobertos

- **Ferimento:** laceração, corte, entorse, fratura, contusão, queimadura, com sangramento, infecção e imobilização.
- **Item essencial:** a bateria de emergência.
- **Morte possível:** ravina sem corda, voz na névoa, hemorragia, hipotermia, desidratação.
