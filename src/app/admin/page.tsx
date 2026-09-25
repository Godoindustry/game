"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/client/api";
import { AppShell, Spinner } from "@/client/ui";
import { toastError, useToasts } from "@/client/session";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tab = "resumo" | "usuarios" | "campanhas" | "logs" | "emails";

function Admin() {
  const push = useToasts((s) => s.push);
  const [tab, setTab] = useState<Tab>("resumo");
  const [stats, setStats] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [camps, setCamps] = useState<any[]>([]);
  const [logs, setLogs] = useState<any>(null);
  const [mail, setMail] = useState<any[]>([]);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    try {
      if (tab === "resumo") setStats(await api("GET", "/api/admin/stats"));
      if (tab === "usuarios") setUsers(await api("GET", `/api/admin/users?q=${encodeURIComponent(q)}`));
      if (tab === "campanhas") setCamps(await api("GET", "/api/admin/campaigns"));
      if (tab === "logs") setLogs(await api("GET", "/api/admin/logs"));
      if (tab === "emails") setMail(await api("GET", "/api/admin/outbox"));
    } catch (err) {
      toastError(err);
    }
  }, [tab, q]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca assíncrona ao montar; o setState ocorre após o await
    void load();
  }, [load]);

  async function userAction(id: string, action: string) {
    if (action === "ban" && !confirm("Banir este usuário? As sessões dele serão encerradas.")) return;
    try {
      await api("POST", `/api/admin/users/${id}/action`, { action });
      push("ok", "Ação registrada no log de auditoria.");
      await load();
    } catch (err) {
      toastError(err);
    }
  }

  const TABS: [Tab, string][] = [["resumo", "Resumo"], ["usuarios", "Usuários"], ["campanhas", "Campanhas"], ["logs", "Auditoria"], ["emails", "E-mails (dev)"]];
  return (
    <div className="stack-lg">
      <div className="row-between">
        <h1 className="h1" style={{ fontSize: 40 }}>Painel ADM</h1>
        <span className="chip chip-red">ADM MASTER</span>
      </div>
      <div className="row">
        {TABS.map(([t, l]) => <button key={t} className={`btn btn-sm ${tab === t ? "btn-primary" : ""}`} onClick={() => setTab(t)}>{l}</button>)}
      </div>

      {tab === "resumo" && (!stats ? <Spinner /> : (
        <div className="stack-lg">
          <div className="grid-3">
            {[
              ["Usuários", stats.users], ["Banidos", stats.bannedUsers], ["Premium", stats.premiumUsers],
              ["Vagas pioneiro", `${stats.earlySlots.used}/${stats.earlySlots.total}`], ["Campanhas ativas", stats.campaigns.active],
              ["Em lobby", stats.campaigns.lobby], ["Encerradas", stats.campaigns.finished], ["Ações resolvidas", stats.actionsResolved], ["Mortes", stats.deaths],
            ].map(([l, v]) => (
              <div key={l as string} className="panel panel-tight"><div className="label">{l}</div><div className="mono" style={{ fontSize: 26 }}>{v}</div></div>
            ))}
          </div>
          <section className="panel stack">
            <div className="panel-head" style={{ marginBottom: 0 }}>
              <span className="h2">IA · hoje</span>
              <span className="chip mono">{stats.ai.provider}{stats.ai.model ? ` / ${stats.ai.model}` : ""} · orçamento US$ {stats.ai.budgetUsd}</span>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Status</th><th>Chamadas</th><th>Tokens in/out</th><th>Custo (US$)</th></tr></thead>
                <tbody>
                  {stats.ai.today.map((r: any) => (
                    <tr key={r.status}><td>{r.status}</td><td className="mono">{r.n}</td><td className="mono">{r.tokens_in}/{r.tokens_out}</td><td className="mono">{Number(r.cost).toFixed(4)}</td></tr>
                  ))}
                  {stats.ai.today.length === 0 && <tr><td colSpan={4} className="muted">Nenhuma chamada hoje.</td></tr>}
                </tbody>
              </table>
            </div>
            <details>
              <summary className="small muted" style={{ cursor: "pointer" }}>Últimas 50 chamadas</summary>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Quando</th><th>Uso</th><th>Status</th><th>Latência</th><th>Fallback</th><th>Erro</th></tr></thead>
                  <tbody>
                    {stats.ai.recent.map((r: any, i: number) => (
                      <tr key={i}><td className="mono tiny">{new Date(r.created_at).toLocaleString("pt-BR")}</td><td>{r.purpose}</td><td>{r.status}</td><td className="mono">{r.latency_ms ?? "—"}</td><td>{r.used_fallback ? "sim" : "não"}</td><td className="tiny muted">{r.error ?? ""}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>
        </div>
      ))}

      {tab === "usuarios" && (
        <div className="stack">
          <form className="row" onSubmit={(e) => { e.preventDefault(); void load(); }}>
            <input className="input" style={{ maxWidth: 320 }} placeholder="Buscar e-mail ou nome" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn btn-sm">Buscar</button>
          </form>
          <div className="panel panel-tight table-wrap">
            <table className="table">
              <thead><tr><th>Usuário</th><th>Papel</th><th>Status</th><th>Premium</th><th>Ações</th></tr></thead>
              <tbody>
                {users.map((u) => {
                  const prem = u.is_premium && !u.premium_revoked_at;
                  return (
                    <tr key={u.id}>
                      <td><strong>{u.display_name}</strong><div className="tiny muted">{u.email}</div></td>
                      <td>{u.role === "master" ? <span className="chip chip-red">master</span> : "usuário"}</td>
                      <td>{u.status === "banned" ? <span className="chip chip-red">banido</span> : <span className="chip chip-green">ativo</span>}</td>
                      <td>{prem ? <span className="chip chip-amber">★ {u.slot_number ? `nº ${u.slot_number}` : "concedido"}</span> : "—"}</td>
                      <td>
                        <div className="row">
                          {u.role !== "master" && (u.status === "banned"
                            ? <button className="btn btn-sm" onClick={() => userAction(u.id, "unban")}>Desbanir</button>
                            : <button className="btn btn-sm btn-danger" onClick={() => userAction(u.id, "ban")}>Banir</button>)}
                          {prem
                            ? <button className="btn btn-sm" onClick={() => userAction(u.id, "revoke_premium")}>Revogar premium</button>
                            : <button className="btn btn-sm" onClick={() => userAction(u.id, "grant_premium")}>Dar premium</button>}
                          <button className="btn btn-sm btn-ghost" onClick={() => userAction(u.id, "logout_all")}>Derrubar sessões</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "campanhas" && (
        <div className="panel panel-tight table-wrap">
          <table className="table">
            <thead><tr><th>Campanha</th><th>Dono</th><th>Modo</th><th>Status</th><th>Rodada</th><th /></tr></thead>
            <tbody>
              {camps.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}<div className="tiny faint mono">{c.id.slice(0, 8)}</div></td>
                  <td>{c.owner}</td>
                  <td>{c.mode} · {c.members}p</td>
                  <td>{c.status}{c.ending ? ` · ${c.ending}` : ""}</td>
                  <td className="mono">{c.current_round}</td>
                  <td>{c.status !== "finished" && (
                    <button className="btn btn-sm btn-danger" onClick={async () => {
                      if (!confirm("Encerrar esta campanha?")) return;
                      try { await api("POST", `/api/admin/campaigns/${c.id}/end`); await load(); } catch (err) { toastError(err); }
                    }}>Encerrar</button>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "logs" && (!logs ? <Spinner /> : (
        <div className="grid-2">
          <section className="panel panel-tight table-wrap">
            <div className="h3" style={{ padding: 8 }}>Ações administrativas</div>
            <table className="table">
              <tbody>
                {logs.admin.map((l: any) => (
                  <tr key={l.id}><td className="mono tiny">{new Date(l.created_at).toLocaleString("pt-BR")}</td><td>{l.actor ?? "?"}</td><td><strong>{l.action}</strong><div className="tiny muted">{l.target_type} {l.target_id?.slice(0, 8)} {l.details}</div></td></tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="panel panel-tight table-wrap">
            <div className="h3" style={{ padding: 8 }}>Segurança</div>
            <table className="table">
              <tbody>
                {logs.security.map((l: any) => (
                  <tr key={l.id}><td className="mono tiny">{new Date(l.created_at).toLocaleString("pt-BR")}</td><td>{l.kind}</td><td className="tiny muted">{l.ip ?? ""} {l.details}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      ))}

      {tab === "emails" && (
        <div className="stack">
          <p className="small muted" style={{ margin: 0 }}>Caixa de saída do mailer de desenvolvimento (substitua por SMTP/API em produção).</p>
          {mail.map((m) => (
            <div key={m.id} className="panel panel-tight">
              <div className="row-between"><strong>{m.subject}</strong><span className="tiny faint">{new Date(m.created_at).toLocaleString("pt-BR")}</span></div>
              <div className="tiny muted">para {m.to_email}</div>
              <pre className="mono tiny" style={{ whiteSpace: "pre-wrap", margin: "8px 0 0" }}>{m.body}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminPage() {
  return (
    <AppShell master>
      <Admin />
    </AppShell>
  );
}
