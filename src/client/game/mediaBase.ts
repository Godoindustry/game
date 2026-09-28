"use client";
/**
 * Base de CDN para o áudio que o cliente monta sozinho (efeitos e ambiente).
 *
 * A narração e as falas gravadas chegam prontas do servidor, já com a URL certa. Estes não:
 * `audioDirector` e o catálogo de `useAudio` conhecem só o caminho em `public/audio`. Com
 * Cloudinary, o servidor manda o prefixo em `state.media.audioBase` e o jogo o aplica aqui.
 *
 * Sem CDN o valor é string vazia e `${base}/audio/x.mp3` continua sendo `/audio/x.mp3` —
 * nenhuma chamada muda, nenhum teste quebra, nada some do cache do service worker.
 */
let audioBase = "";

/** Chamado pelo `useGame` a cada sync; é idempotente e nunca lança. */
export function setMediaAudioBase(base: string | undefined): void {
  audioBase = base ?? "";
}

export function mediaAudioBase(): string {
  return audioBase;
}

/** `sfxUrl("sistema/hud-alert-fome")` → `/audio/sistema/hud-alert-fome.mp3` ou a URL da CDN. */
export function sfxUrl(id: string): string {
  return `${audioBase}/audio/${id}.mp3`;
}
