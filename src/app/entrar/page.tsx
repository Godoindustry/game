"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthFrame } from "@/client/AuthFrame";
import { api } from "@/client/api";
import { useSession, type User } from "@/client/session";
import { Spinner } from "@/client/ui";

function safeReturn(path: string | null): string {
  // Só caminhos internos (evita open redirect).
  return path && path.startsWith("/") && !path.startsWith("//") ? path : "/painel";
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const setUser = useSession((s) => s.setUser);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(params.get("erro") === "google" ? "Não foi possível entrar com o Google." : "");
  const [busy, setBusy] = useState(false);
  const [google, setGoogle] = useState(false);

  useEffect(() => {
    api<{ googleEnabled: boolean }>("GET", "/api/meta").then((m) => setGoogle(m.googleEnabled)).catch(() => undefined);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api<{ user: User }>("POST", "/api/auth/login", { email, password });
      setUser(r.user);
      router.replace(safeReturn(params.get("voltar")));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no login.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      {error && <div className="error-box" role="alert">{error}</div>}
      <label className="field">
        <span className="label">E-mail ou usuário</span>
        <input className="input" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label className="field">
        <span className="label">Senha</span>
        <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      <button className="btn btn-primary btn-block" disabled={busy || !email || !password}>
        {busy ? <Spinner /> : "Entrar"}
      </button>
      <a
        className="btn btn-google btn-block"
        href={google ? "/api/auth/google/start" : undefined}
        aria-disabled={!google}
        style={google ? undefined : { opacity: 0.45, pointerEvents: "none" }}
        title={google ? undefined : "Login com Google não configurado neste servidor"}
      >
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
        </svg>
        Entrar com Google
      </a>
      <div className="row-between small">
        <Link href="/esqueci-senha">Esqueci a senha</Link>
        <Link href="/cadastro">Criar conta</Link>
      </div>
    </form>
  );
}

export default function LoginPage() {
  return (
    <AuthFrame title="Entrar" subtitle="Retome sua campanha de onde parou.">
      <Suspense fallback={<Spinner />}>
        <LoginForm />
      </Suspense>
    </AuthFrame>
  );
}
