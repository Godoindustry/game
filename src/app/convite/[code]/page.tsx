"use client";
import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/client/api";
import { AppShell, Spinner } from "@/client/ui";

function Accept() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const [error, setError] = useState("");
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    api<{ campaignId: string }>("POST", "/api/invites/accept", { code: decodeURIComponent(code) })
      .then((r) => router.replace(`/campanha/${r.campaignId}/personagem`))
      .catch((e) => setError(e instanceof Error ? e.message : "Convite inválido."));
  }, [code, router]);
  return (
    <div className="panel stack" style={{ maxWidth: 480, margin: "40px auto" }}>
      <h1 className="h2">Convite</h1>
      {error ? (
        <>
          <div className="error-box">{error}</div>
          <Link href="/painel" className="btn">Voltar ao painel</Link>
        </>
      ) : (
        <div className="row"><Spinner /> Entrando na campanha…</div>
      )}
    </div>
  );
}

export default function InvitePage() {
  return (
    <AppShell>
      <Accept />
    </AppShell>
  );
}
