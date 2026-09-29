"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiError } from "@/client/api";
import { AppShell, Spinner } from "@/client/ui";
import { toastError, useToasts } from "@/client/session";

interface Lobby {
  id: string;
  name: string;
  mode: "solo" | "coop";
  status: string;
  maxPlayers: number;
  isOwner: boolean;
  members: { userId: string; displayName: string; role: string; hasCharacter: boolean; characterName: string | null; isMe: boolean }[];
}

// Link montado com o domínio aberto agora: não depende de APP_URL estar certo no servidor.
const withOrigin = (inv: { code: string; url: string }) => ({ ...inv, url: `${window.location.origin}/convite/${encodeURIComponent(inv.code)}` });

function LobbyView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const push = useToasts((s) => s.push);
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [invite, setInvite] = useState<{ code: string; url: string } | null>(null);
  const [inviteError, setInviteError] = useState("");
  const [busy, setBusy] = useState(false);
  const inviteLoaded = useRef(false);

  const load = useCallback(async () => {
    try {
      const l = await api<Lobby>("GET", `/api/campaigns/${id}/lobby`);
      if (l.status !== "lobby") return router.replace(`/campanha/${id}/jogar`);
      setLobby(l);
    } catch (err) {
      // Removido pelo administrador (ou campanha apagada): sai do lobby em vez de repetir o erro a cada 4 s.
      if (err instanceof ApiError && err.status === 404) {
        push("info", "Você não está mais nesta campanha.");
        return router.replace("/painel");
      }
      toastError(err);
    }
  }, [id, router, push]);

  // Gera o convite automaticamente na primeira vez que o dono abre o lobby coop
  const ensureInvite = useCallback(async (l: Lobby) => {
    if (!l.isOwner || l.mode !== "coop" || inviteLoaded.current) return;
    inviteLoaded.current = true;
    try {
      const inv = await api<{ code: string; url: string }>("POST", `/api/campaigns/${id}/invites`);
      setInvite(withOrigin(inv));
      setInviteError("");
    } catch (err) {
      // Sala cheia, por exemplo: mostra o motivo em vez de "Gerando convite…" para sempre.
      setInviteError(err instanceof Error ? err.message : "Não foi possível gerar o convite.");
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca assíncrona ao montar; o setState ocorre após o await
    void load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- convite é criado por chamada assíncrona e o estado muda após a resposta
    if (lobby) void ensureInvite(lobby);
  }, [lobby, ensureInvite]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  }

  async function renewInvite() {
    setBusy(true);
    try {
      await api("DELETE", `/api/campaigns/${id}/invites`);
      const inv = await api<{ code: string; url: string }>("POST", `/api/campaigns/${id}/invites`);
      setInvite(withOrigin(inv));
      setInviteError("");
      push("ok", "Novo link gerado.");
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!lobby) return <Spinner />;
  const me = lobby.members.find((m) => m.isMe);
  const ready = lobby.members.every((m) => m.hasCharacter);

  return (
    <div className="stack-lg">
      <div>
        <p className="label amber" style={{ marginBottom: 4 }}>Lobby · {lobby.mode === "solo" ? "Solo" : "Cooperativo"}</p>
        <h1 className="h1" style={{ fontSize: 40 }}>{lobby.name}</h1>
      </div>
      <div className="grid-2">
        <section className="panel stack">
          <div className="panel-head" style={{ marginBottom: 0 }}>
            <span className="h2">Sobreviventes</span>
            <span className="chip mono">{lobby.members.length}/{lobby.maxPlayers}</span>
          </div>
          {lobby.members.map((m) => (
            <div key={m.userId} className="row-between" style={{ borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
              <div>
                <strong>{m.displayName}</strong> {m.role === "owner" && <span className="chip chip-amber tiny">admin</span>} {m.isMe && <span className="tiny faint">(você)</span>}
                <div className="small muted">{m.hasCharacter ? `Personagem: ${m.characterName}` : "Montando a ficha…"}</div>
              </div>
              <div className="row">
                <span className={`chip ${m.hasCharacter ? "chip-green" : ""}`}>{m.hasCharacter ? "Pronto" : "Aguardando"}</span>
                {lobby.isOwner && !m.isMe && (
                  <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => run(() => api("DELETE", `/api/campaigns/${id}/members/${m.userId}`))}>
                    Remover
                  </button>
                )}
              </div>
            </div>
          ))}
          {me && !me.hasCharacter && <Link className="btn btn-primary" href={`/campanha/${id}/personagem`}>Criar meu personagem</Link>}
        </section>
        <section className="panel stack">
          {lobby.mode === "coop" && lobby.isOwner && (
            <>
              <div className="panel-head" style={{ marginBottom: 0 }}><span className="h2">Convite</span></div>
              <p className="small muted" style={{ margin: 0 }}>Compartilhe o link ou código com seus amigos. O link vale 48 horas.</p>
              {invite ? (
                <div className="stack">
                  <div className="stack" style={{ gap: 4 }}>
                    <label className="small muted">Link de convite</label>
                    <input className="input mono small" readOnly value={invite.url} onFocus={(e) => e.target.select()} />
                  </div>
                  <div className="stack" style={{ gap: 4 }}>
                    <label className="small muted">Código</label>
                    <input className="input mono small" readOnly value={invite.code} onFocus={(e) => e.target.select()} />
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn" onClick={async () => {
                      try { await navigator.clipboard.writeText(invite.url); push("ok", "Link copiado!"); }
                      catch { push("info", `Link: ${invite.url}`); }
                    }}>
                      Copiar link
                    </button>
                    <button className="btn btn-sm" onClick={async () => {
                      try { await navigator.clipboard.writeText(invite.code); push("ok", "Código copiado!"); }
                      catch { push("info", `Código: ${invite.code}`); }
                    }}>
                      Copiar código
                    </button>
                  </div>
                  <button className="btn btn-sm btn-ghost" disabled={busy} onClick={renewInvite}>
                    Gerar novo link
                  </button>
                </div>
              ) : inviteError ? (
                <div className="small muted">{inviteError}</div>
              ) : (
                <div className="row small muted"><Spinner /> Gerando convite…</div>
              )}
            </>
          )}
          <div className="panel-head" style={{ marginBottom: 0 }}><span className="h2">Início</span></div>
          <p className="small muted" style={{ margin: 0 }}>
            A campanha começa às 23h40, logo após a queda. Tempo de jogo só passa quando vocês agem — offline, o vale espera.
          </p>
          {lobby.isOwner ? (
            <button className="btn btn-primary" disabled={busy || !ready} onClick={() => run(async () => { await api("POST", `/api/campaigns/${id}/start`); router.push(`/campanha/${id}/jogar`); })}>
              {ready ? "Iniciar campanha" : "Aguardando fichas"}
            </button>
          ) : (
            <div className="row small muted"><Spinner /> Aguardando o administrador iniciar…</div>
          )}
          {lobby.isOwner ? (
            <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => confirm("Encerrar a campanha?") && run(async () => { await api("POST", `/api/campaigns/${id}/end`); router.push("/painel"); })}>
              Encerrar campanha
            </button>
          ) : (
            <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => run(async () => { await api("POST", `/api/campaigns/${id}/leave`); router.push("/painel"); })}>
              Sair da campanha
            </button>
          )}
        </section>
      </div>
    </div>
  );
}

export default function LobbyPage() {
  return (
    <AppShell>
      <LobbyView />
    </AppShell>
  );
}
