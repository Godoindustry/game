# Áudios para baixar no Pixabay

Sons que o jogo já chama, mas que ainda não existem. Enquanto um arquivo falta, a escolha fica
em silêncio (ou toca um som reserva parecido). Assim que o arquivo aparece, ele passa a tocar,
sem mudar código.

Fonte: https://pixabay.com/sound-effects/ — licença Pixabay (uso livre em jogos, sem atribuição
obrigatória). Os termos proíbem baixar com robôs: baixe à mão.

## Como colocar no jogo

1. Busque no Pixabay pelo termo da coluna "O que buscar" (em inglês acha mais opções).
2. Baixe o MP3 para a pasta `audios pixabay/` do projeto (ela é ignorada pelo git).
3. Acrescente uma linha em `scripts/import-audio.mjs` (lista SOURCES), no formato
   `["nome-original-baixado.mp3", "pasta/nome", segundosParaCortar]`, e o crédito em
   `public/audio/CREDITOS.md`. Depois rode `node scripts/import-audio.mjs`.
   (Atalho: se preferir, só baixe os arquivos na pasta e me avise que eu faço o passo 3.)

Dica: prefira sons curtos e secos (a coluna "Duração"). Se o som tiver silêncio no começo,
corte, senão ele parece atrasado em relação ao toque.

## Prioridade

Os quatro primeiros são os que mais fazem falta: o grito de socorro e o dado.

| # | Arquivo (destino) | O que buscar | Onde toca | Duração |
|---|---|---|---|---|
| 1 | `jogador/grito-socorro.mp3` | shouting help / hey over here (de preferência uma voz que sirva para homem e mulher) | Gritar pelo piloto, Acenar e gritar, Chamar por alguém, Pedir ajuda | 1–3 s |
| 2 | `dado/rolando.mp3` | dice roll wooden table | Botão ROLAR D20 | 1–2 s |
| 3 | `dado/sucesso.mp3` | success sting dark / mysterious positive hit | Resultado do D20: sucesso | 1–2 s |
| 4 | `dado/falha.mp3` | horror sting fail / suspense hit low | Resultado do D20: falha | 1–2 s |
| 5 | `jogador/respiracao-correndo.mp3` | running breathing panic / out of breath running | Correr, Fugir | 3–6 s |
| 6 | `jogador/respiracao-contida.mp3` | holding breath scared / nervous breathing | Ficar imóvel, Prender a respiração, Deitar no chão, Observar em silêncio | 3–5 s |
| 7 | `jogador/golpe.mp3` | punch impact struggle / body hit fight | Golpear, Derrubar o capanga, Acabar com isso, Tomar a chave de roda | 1–2 s |
| 8 | `jogador/gemido-dor.mp3` | pain groan short | Enfaixar, tratar ferimento, morder a língua | 1–3 s |
| 9 | `jogador/beber-agua.mp3` | drinking water gulp | Beber da poça, Beber do córrego | 2–3 s |
| 10 | `cenario/metal-forcando.mp3` | metal door creak force / crowbar metal | Forçar a porta, Alavanca, Forçar o cadeado, Pular a cerca | 2–4 s |
| 11 | `cenario/cinto-fivela.mp3` | seatbelt unbuckle | Soltar o cinto (começo do jogo) | 1 s |
| 12 | `cenario/lanterna-clique.mp3` | flashlight click on off | Lanterna, Apagar a luz | 0.5–1 s |
| 13 | `cenario/radio-chiado.mp3` | radio static tuning / walkie talkie static | Ligar e sintonizar o rádio, cena do rádio | 3–6 s |
| 14 | `cenario/sinalizador.mp3` | flare gun shot / signal flare | Disparar o sinalizador | 2–4 s |
| 15 | `cenario/agua-mergulho.mp3` | dive into water splash | Mergulhar até a luz | 2–3 s |
| 16 | `cenario/papel-folhear.mp3` | paper page turn / notebook pages | Ler o diário, Levar o mapa, Ler a lápide | 1–2 s |
| 17 | `cenario/pedras.mp3` | stones rocks moving / rock drop | Cobrir a cova com pedras | 2–3 s |
| 18 | `cenario/corda.mp3` | rope climbing / rope tension | Descer usando a corda, Fixar uma corda | 2–4 s |
| 19 | `cenario/helicoptero.mp3` | helicopter flyby distant | Evento Rotor ao longe / Céu aberto | 5–10 s |
| 20 | `cenario/motor-carro.mp3` | car engine approaching night / off road vehicle | Eventos Motor na ponte e Faróis entre as árvores | 5–8 s |
| 21 | `cenario/celular-vibrando.mp3` | phone vibrate / cellphone static interference | Evento 23h40 (o celular) | 2–4 s |
