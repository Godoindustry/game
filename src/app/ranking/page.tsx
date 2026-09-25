"use client";
import { useEffect, useState } from "react";
import { api } from "@/client/api";
import { AppShell, ENDING_LABEL, Spinner, formatMinutes } from "@/client/ui";
import { toastError } from "@/client/session";

interface Row { position: number; displayName: string; characterName: string; score: number; survivedMinutes: number; cluesFound: number; ending: string; date: string }

function Ranking() {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    api<Row[]>("GET", "/api/ranking").then(setRows).catch(toastError);
  }, []);
  return (
    <div className="stack-lg">
      <h1 className="h1" style={{ fontSize: 40 }}>Ranking</h1>
      <p className="muted" style={{ margin: 0 }}>Pontuação = tempo sobrevivido + pistas encontradas + bônus por sobreviver e ser resgatado.</p>
      {!rows ? <Spinner /> : rows.length === 0 ? <p className="muted">Ninguém terminou uma campanha ainda. Seja o primeiro.</p> : (
        <div className="panel panel-tight table-wrap">
          <table className="table">
            <thead><tr><th>#</th><th>Jogador</th><th>Personagem</th><th>Final</th><th>Sobreviveu</th><th>Pistas</th><th>Pontos</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.position}-${r.date}`}>
                  <td className="mono amber">{r.position}</td>
                  <td>{r.displayName}</td>
                  <td>{r.characterName}</td>
                  <td><span className={`chip ${r.ending.startsWith("resgate") ? "chip-green" : "chip-red"}`}>{ENDING_LABEL[r.ending] ?? r.ending}</span></td>
                  <td className="mono">{formatMinutes(r.survivedMinutes)}</td>
                  <td className="mono">{r.cluesFound}</td>
                  <td className="mono"><strong>{r.score}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function RankingPage() {
  return (
    <AppShell>
      <Ranking />
    </AppShell>
  );
}
