# Áudios do jogo — organização e créditos

Organização: **uma pasta por pessoa** (quem fala ou quem está em cena); o **nome do arquivo é a situação**.

| Pasta | Pessoa | Origem |
|---|---|---|
| `narrador/` | Narrador (George) | ElevenLabs, gerado por `npm run audio:generate` |
| `sistema/` | Locutor frio do rádio/HUD (Daniel) | ElevenLabs |
| `voz-da-morte/` | Voz da morte (Brian) | ElevenLabs |
| `desconhecido/` | NPC desconhecido (Callum) | ElevenLabs |
| `jogador/`, `iara/`, `mae-das-asas/`, `lobo-de-ambar/`, `tavares/`, `almas/`, `cenario/` | Personagens, criaturas e cenário | Pixabay (abaixo) |

## Efeitos do Pixabay

Baixados manualmente de https://pixabay.com/sound-effects/ sob a **Pixabay Content License**:
uso gratuito, inclusive comercial e em jogos, sem obrigação de atribuição; não é permitido
revender ou redistribuir os arquivos isolados. Os termos do Pixabay proíbem baixar com robôs/scripts —
novos áudios devem ser baixados à mão e colocados na pasta local `audios pixabay/` (ignorada pelo git);
depois, acrescente uma linha em `scripts/import-audio.mjs` e rode `node scripts/import-audio.mjs`.

Alternativas baixadas que ficaram fora do jogo (mesmo som, só pesariam o download): outras 4 fogueiras
(alice_soundz, dragon-studio, soundreality ×3), 2 rios (soundreality big river, birds and waterfall)
e 3 cantos de pássaro (one birds song, voices of birds, song thrush).

| Arquivo | Original (autor – nome – id) | Situação no jogo |
|---|---|---|
| jogador/grito-morte | freesound_community – terror scream – 101302 | Morte do personagem |
| jogador/grito-mordida | magiaz – scream of terror – 325532 | Mordida nova |
| jogador/panico-compulsao | alban_gogh – “panic fear” – 479998 | Compulsão de classe |
| jogador/suspiro-alivio-1 | vikukachannel – suspiro sigh – 171045 | Estresse cai de repente |
| jogador/suspiro-alivio-2 | freesound_community – 04 suspiro – 45078 | Estresse cai de repente |
| jogador/vida | freesound_community – vida – 44129 | (ainda sem uso) |
| iara/aparicao-coral | freesound_community – coro música de aparición – 37181 | Confronto com Iara, despertar Assombrado |
| iara/suspiro | dragon-studio – female sigh – 450446 | Visão de Iara na febre |
| iara/sussurro-chamado | dragon-studio – ghost whisper – 351569 | Celular às 23h40, fim do confronto |
| iara/sussurro-numeros | freesound_community – susurro conjuro – 46499 | “23h40 em ponto” |
| mae-das-asas/grito-aparicao | estudiocoati – demonic_screech_01 – 502919 | Mãe das Asas, despertar Vampiro |
| mae-das-asas/risada | dragon-studio – witch laugh – 401713 | Depois do grito da Mãe |
| mae-das-asas/filhas-risada | dragon-studio – evil girl laughing – 401720 | Asas na escuridão, o chamado |
| lobo-de-ambar/rosnado | rickworm – monster growl – 251374 (15 s iniciais) | Lobo de Âmbar, o uivo, despertar Lobisomem |
| lobo-de-ambar/uivo | freeeverythingxx – wolf howl – 268619 | O uivo sob a pele, despertar Lobisomem |
| lobo-de-ambar/uivo-distante | dragon-studio – howling in the distance – 515982 | Garras a três metros |
| lobo-de-ambar/uivo-eco | pwlpl – realistic wolf howling echoing – 444193 | Depois do rosnado do Lobo, lua cheia |
| bichos/rugido-selvagem | hari0127sound – deer wild animal roar – 378527 | Bando de queixadas |
| tavares/tensao-entrada | u_5pvfy3zhzr – suspense r reverbe – 323043 | Tavares aparece na ponte |
| tavares/risada-sarcastica | universfield – mischievous laugh – 140131 | Tavares se apresenta |
| tavares/risada-cruel | dragon-studio – evil laugh with reverb – 423668 | Faróis entre as árvores |
| almas/murmurios | freesound_community – murmullos – 7133 | A cova aberta |
| almas/sussurro-arrepiante | dragon-studio – creepy whisper – 472369 | Alguém chama seu nome; toque de alma |
| almas/sussurro-submundo | fnx_sound – eerie space whisper of the underworld – 287352 | A voz na névoa; toque de alma |
| almas/risada-demoniaca | freesound_community – evil demonic laugh – 6925 | O que a névoa fez |
| almas/risada-maligna | freesound_community – evil laugh – 89423 | (reserva) |
| cenario/ambiente-noite | freesound_community – terror ambience – 7003 | Fundo noturno (loop) |
| cenario/floresta-dia | freesound_community – amazon florest – 14836 (60 s iniciais) | Fundo de dia ao ar livre (loop) |
| cenario/fogueira-acender | freesound_community – fire breath – 6922 | Fogueira acende |
| cenario/fogueira | maxhammarback – fire sound effect – 21991 | Local com fogueira acesa (loop) |
| cenario/rio | dragon-studio – soothing river flow – 372456 | Ponte do córrego (loop) |
| cenario/poco-gotas | creativenabeel02 – water drops falling in water – 259269 | Poço escuro (loop) |
| cenario/galho-quebrando-1 | freesound_community – wood crack 1 – 105890 | Alguém chama seu nome; passos à noite |
| cenario/galho-quebrando-2 | freesound_community – wood crack 4 – 88688 | Gotas no caminho; passos à noite |
| cenario/osso-quebrando | universfield – bone crack 3 – 121580 | Fratura |
| cenario/passos-floresta | sspsurvival – grass in the forest footsteps – 248351 (5 s iniciais) | Caminhar |
| cenario/luta-chefe | mechitoo – panteón de terror – 454257 | Confronto com chefe (loop) |
| cenario/despertar | audiocrudo – sonido de terror 2026 – 450807 | O Despertar |
| cenario/encontro | u_thxw0i7h4n – terror – 213743 | O Encontro, despertar Caçador |
| cenario/mato-passo | dragon-studio – grass rustling 05 – 511299 | Começar a caminhar |
| cenario/mato-arbusto | dragon-studio – bush rustling – 467467 | Caminhar, queixadas |
| cenario/mato-folhas | soul_serenity_sounds – leaves rustling – 236742 | Caminhar, carcaça |
| cenario/mato-grama | dragon-studio – grass being rustled – 511323 (8 s iniciais) | Caminhar |
| cenario/mato-campo-seco | dragon-studio – dry field grass rustling – 482893 (8 s iniciais) | Caminhar |
| cenario/passos-trilha | dragon-studio – footsteps on the nature trail – 419017 (6 s iniciais) | Caminhar |
| cenario/passos-terra | freesound_community – passos – 101430 (5 s iniciais) | Caminhar |
| cenario/passos-caminhada | freesound_community – passos – 30798 (6 s iniciais) | Caminhar |
| cenario/passos-concreto | freesound_community – concrete footsteps 1 – 6265 (5 s iniciais) | Sair andando de lugar fechado |
| cenario/vento-inverno | dragon-studio – winter wind – 402331 | Noite fria ao ar livre (loop) |
| cenario/vento-forte | dragon-studio – harsh wind – 515272 | Chuva ao ar livre (loop) |
| cenario/zumbido | daub_audio – brain damage – 148577 (9 s iniciais) | Abertura: o zumbido depois do impacto |
| iara/passos-salto | freesound_community – passos de salto – 70753 (7 s iniciais) | 23h40 em ponto: Iara se aproxima |
| almas/sussurro-ola | misfit_melomaniac – hello whisper – 533246 | Alguém chama seu nome |
| mae-das-asas/vampira-olhar | alesiadavina – female vampire calculating gaze – 508989 | Despertar Vampiro, oferecer o pescoço |
