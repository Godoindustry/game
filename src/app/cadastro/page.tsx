"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthFrame } from "@/client/AuthFrame";
import { api } from "@/client/api";
import { useSession, useToasts, type User } from "@/client/session";
import { Spinner } from "@/client/ui";

export default function RegisterPage() {
  const router = useRouter();
  const setUser = useSession((s) => s.setUser);
  const push = useToasts((s) => s.push);
  const [form, setForm] = useState({ displayName: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [slots, setSlots] = useState<{ used: number; total: number } | null>(null);

  useEffect(() => {
    api<{ earlySlots: { used: number; total: number } }>("GET", "/api/meta").then((m) => setSlots(m.earlySlots)).catch(() => undefined);
  }, []);

  const pwOk = form.password.length >= 8 && /[A-Za-z]/.test(form.password) && /\d/.test(form.password);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api<{ user: User }>("POST", "/api/auth/register", form);
      setUser(r.user);
      if (r.user.premium) push("ok", "Você é um dos 12 primeiros: conta Premium ativada!");
      router.replace("/painel");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no cadastro.");
    } finally {
      setBusy(false);
    }
  }

  const left = slots ? Math.max(0, slots.total - slots.used) : null;

  return (
    <AuthFrame title="Criar conta" subtitle="Seu perfil guarda campanhas, conquistas e ranking.">
      {left !== null && left > 0 && (
        <div className="chip chip-amber" style={{ alignSelf: "flex-start" }}>
          ★ Restam {left} de {slots!.total} vagas Premium de pioneiro
        </div>
      )}
      <form className="stack" onSubmit={submit} noValidate>
        {error && <div className="error-box" role="alert">{error}</div>}
        <label className="field">
          <span className="label">Nome de exibição</span>
          <input className="input" maxLength={40} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required />
        </label>
        <label className="field">
          <span className="label">E-mail</span>
          <input className="input" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        </label>
        <label className="field">
          <span className="label">Senha</span>
          <input className="input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          <span className={`hint ${form.password && !pwOk ? "red" : ""}`}>Mínimo 8 caracteres, com letras e números.</span>
        </label>
        <button className="btn btn-primary btn-block" disabled={busy || !pwOk || !form.email || form.displayName.trim().length < 2}>
          {busy ? <Spinner /> : "Criar conta"}
        </button>
        <p className="small muted" style={{ margin: 0 }}>
          Já tem conta? <Link href="/entrar">Entrar</Link>
        </p>
      </form>
    </AuthFrame>
  );
}
