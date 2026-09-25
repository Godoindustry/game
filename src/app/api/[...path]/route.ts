/**
 * Ponto único de entrada da API no Next.js. Toda a lógica vive em src/server
 * (framework-agnóstica e testável); aqui só encaminhamos a requisição.
 */
import { handleApi } from "@/server/http/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Na Vercel: resolver uma rodada pode chamar a IA (timeout de ~6 s por provedor na cadeia).
export const maxDuration = 30;

const handler = (req: Request) => handleApi(req);

export { handler as GET, handler as POST, handler as PATCH, handler as DELETE };
