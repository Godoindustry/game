/**
 * narrador.js
 *
 * Toca as falas geradas no Colab (pasta com narrador.json + arquivos .mp3).
 *
 * Uso:
 *   <script src="narrador.js"></script>
 *
 *   const narrador = new Narrador({ pasta: "narrador/" });
 *   await narrador.carregar();                        // baixa e prepara todas as falas
 *
 *   narrador.narrar("ponto");                         // entra na fila curta
 *   narrador.narrar("vitoria", { urgente: true });    // corta o que estiver falando
 *
 * O navegador só libera som depois do primeiro clique, toque ou tecla do jogador.
 * O narrador se destrava sozinho nesse momento. Falas pedidas antes disso são ignoradas,
 * para não sair tudo de uma vez atrasado.
 *
 * Opções do construtor (todas opcionais):
 *   pasta                   pasta das falas, padrão "narrador/"
 *   manifesto               nome do índice, padrão "narrador.json"
 *   volume                  0 a 1, padrão 1
 *   maxFila                 quantas falas podem esperar na fila, padrão 2 (o resto é descartado)
 *   intervaloMesmoEventoMs  tempo mínimo para o mesmo evento falar de novo, padrão 1500
 *   pausaEntreFalasMs       respiro entre uma fala e outra, padrão 150
 *   aoFalar(fala)           chamado quando uma fala começa (fala.texto serve para legenda)
 *   aoTerminar(fala)        chamado quando uma fala termina
 */
(function (global) {
  "use strict";

  class Narrador {
    constructor(opcoes = {}) {
      const pasta = String(opcoes.pasta ?? "narrador/");
      this.pasta = pasta === "" ? "" : pasta.replace(/\/*$/, "/");
      this.manifesto = opcoes.manifesto ?? "narrador.json";
      this.maxFila = opcoes.maxFila ?? 2;
      this.intervaloMesmoEventoMs = opcoes.intervaloMesmoEventoMs ?? 1500;
      this.pausaEntreFalasMs = opcoes.pausaEntreFalasMs ?? 150;
      this.aoFalar = opcoes.aoFalar ?? null;
      this.aoTerminar = opcoes.aoTerminar ?? null;

      this.eventos = {};
      this.fila = [];
      this.atual = null;
      this.mudo = false;
      this.ctx = null;

      this._volume = Narrador._limitar(opcoes.volume ?? 1);
      this._saida = null;
      this._timer = null;
      this._ultimaFala = {};
      this._ultimoPedido = {};
      this._avisouBloqueio = false;
    }

    /** Baixa o narrador.json e decodifica todos os áudios. */
    async carregar() {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) throw new Error("Narrador: este navegador não suporta Web Audio.");

      if (!this.ctx) {
        this.ctx = new AC();
        this._saida = this.ctx.createGain();
        this._saida.connect(this.ctx.destination);
        this._aplicarGanho();
        this._instalarDesbloqueio();
      }

      const url = this.pasta + this.manifesto;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Narrador: não consegui abrir ${url} (HTTP ${resp.status}).`);
      const dados = await resp.json();
      const eventos = dados.eventos || {};

      const tarefas = [];
      for (const falas of Object.values(eventos)) {
        for (const fala of falas) tarefas.push(this._prepararFala(fala));
      }
      await Promise.all(tarefas);

      this.eventos = {};
      for (const [evento, falas] of Object.entries(eventos)) {
        const prontas = falas.filter((f) => f.buffer);
        if (prontas.length) this.eventos[evento] = prontas;
      }
      return this;
    }

    /**
     * Pede uma fala do evento. Devolve true se a fala foi aceita.
     * urgente: interrompe a fala atual, limpa a fila e fala na hora (use em vitória, derrota, recorde).
     */
    narrar(evento, { urgente = false } = {}) {
      if (this.mudo || !this.ctx) return false;

      const falas = this.eventos[evento];
      if (!falas || !falas.length) {
        console.warn(`Narrador: não há falas para o evento "${evento}".`);
        return false;
      }

      if (this.ctx.state !== "running") {
        if (!this._avisouBloqueio) {
          console.info("Narrador: aguardando o primeiro clique ou tecla para liberar o som.");
          this._avisouBloqueio = true;
        }
        return false;
      }

      const agora = Date.now();
      const ultimo = this._ultimoPedido[evento] ?? -Infinity;
      if (!urgente) {
        if (agora - ultimo < this.intervaloMesmoEventoMs) return false;
        if (this.fila.length >= this.maxFila) return false;
      }
      this._ultimoPedido[evento] = agora;

      const fala = this._sortear(evento, falas);
      if (urgente) {
        this.fila.length = 0;
        this._pararAtual();
      }
      this.fila.push(fala);
      this._proxima();
      return true;
    }

    /** Para a fala atual e esvazia a fila. */
    parar() {
      this.fila.length = 0;
      this._pararAtual();
    }

    /** Liga ou desliga o narrador. */
    silenciar(mudo = true) {
      this.mudo = !!mudo;
      if (this.mudo) this.parar();
      this._aplicarGanho();
    }

    get volume() {
      return this._volume;
    }

    set volume(valor) {
      this._volume = Narrador._limitar(valor);
      this._aplicarGanho();
    }

    get falando() {
      return !!this.atual;
    }

    temEvento(evento) {
      return !!(this.eventos[evento] && this.eventos[evento].length);
    }

    // Funções internas

    async _prepararFala(fala) {
      try {
        const resp = await fetch(this.pasta + fala.arquivo);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const bytes = await resp.arrayBuffer();
        fala.buffer = await new Promise((ok, erro) => {
          const r = this.ctx.decodeAudioData(bytes, ok, erro);
          if (r && typeof r.catch === "function") r.catch(() => {});
        });
      } catch (e) {
        console.warn(`Narrador: falha ao carregar ${fala.arquivo}`, e);
      }
    }

    _instalarDesbloqueio() {
      const tipos = ["pointerdown", "keydown", "touchend"];
      if (typeof global.addEventListener !== "function") return;
      const destravar = () => {
        if (!this.ctx) return;
        try {
          // toque silencioso: alguns iPhones só liberam o som assim
          const s = this.ctx.createBufferSource();
          s.buffer = this.ctx.createBuffer(1, 1, 22050);
          s.connect(this.ctx.destination);
          s.start(0);
        } catch (e) {
          /* ignora */
        }
        Promise.resolve(this.ctx.resume ? this.ctx.resume() : null)
          .then(() => {
            if (this.ctx.state === "running") {
              tipos.forEach((t) => global.removeEventListener(t, destravar, true));
            }
          })
          .catch(() => {});
      };
      tipos.forEach((t) => global.addEventListener(t, destravar, true));
    }

    _sortear(evento, falas) {
      if (falas.length === 1) return falas[0];
      const anterior = this._ultimaFala[evento];
      const opcoes = falas.filter((f) => f !== anterior);
      const fala = opcoes[Math.floor(Math.random() * opcoes.length)];
      this._ultimaFala[evento] = fala;
      return fala;
    }

    _proxima() {
      if (this.atual || this._timer || !this.fila.length) return;

      const fala = this.fila.shift();
      const fonte = this.ctx.createBufferSource();
      fonte.buffer = fala.buffer;
      fonte.connect(this._saida);

      const tocando = { fala, fonte };
      this.atual = tocando;
      fonte.onended = () => {
        if (this.atual !== tocando) return; // foi interrompida por uma fala urgente
        this.atual = null;
        if (this.aoTerminar) this.aoTerminar(fala);
        this._timer = setTimeout(() => {
          this._timer = null;
          this._proxima();
        }, this.pausaEntreFalasMs);
      };

      if (this.aoFalar) this.aoFalar(fala);
      fonte.start();
    }

    _pararAtual() {
      if (this._timer) {
        clearTimeout(this._timer);
        this._timer = null;
      }
      const tocando = this.atual;
      this.atual = null;
      if (tocando) {
        try {
          tocando.fonte.stop();
        } catch (e) {
          /* já tinha parado */
        }
      }
    }

    _aplicarGanho() {
      if (this._saida) this._saida.gain.value = this.mudo ? 0 : this._volume;
    }

    static _limitar(valor) {
      const n = Number(valor);
      return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
    }
  }

  if (typeof module !== "undefined" && module.exports) module.exports = Narrador;
  global.Narrador = Narrador;
})(typeof window !== "undefined" ? window : globalThis);
