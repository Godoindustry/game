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

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Lê os campos do próprio formulário: o preenchimento automático do celular nem sempre
    // dispara onChange, e o estado ficaria vazio com a tela preenchida.
    const fd = new FormData(e.currentTarget);
    const data = {
      displayName: String(fd.get("displayName") ?? "").trim(),
      email: String(fd.get("email") ?? "").trim(),
      password: String(fd.get("password") ?? ""),
    };
    setForm(data);
    const problem =
      data.displayName.length < 2 ? "Digite um nome de exibição com pelo menos 2 letras." :
      !/^\S+@\S+\.\S+$/.test(data.email) ? "Digite um e-mail válido." :
      data.password.length < 8 ? "A senha precisa de pelo menos 8 caracteres." :
      !/[A-Za-z]/.test(data.password) || !/\d/.test(data.password) ? "A senha precisa ter letras e números (ex.: zumbi123)." :
      "";
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await api<{ user: User }>("POST", "/api/auth/register", data);
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
          <input className="input" name="displayName" autoComplete="nickname" maxLength={40} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required />
        </label>
        <label className="field">
          <span className="label">E-mail</span>
          <input className="input" name="email" type="email" autoComplete="email" autoCapitalize="none" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        </label>
        <label className="field">
          <span className="label">Senha</span>
          <input className="input" name="password" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          <span className={`hint ${form.password && !pwOk ? "red" : ""}`}>Mínimo 8 caracteres, com letras e números.</span>
        </label>
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? <Spinner /> : "Criar conta"}
        </button>
        <p className="small muted" style={{ margin: 0 }}>
          Já tem conta? <Link href="/entrar">Entrar</Link>
        </p>
      </form>
    </AuthFrame>
  );
}
