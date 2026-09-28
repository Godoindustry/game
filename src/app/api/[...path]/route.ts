/**
 * Ponto único de entrada da API no Next.js. Toda a lógica vive em src/server
 * (framework-agnóstica e testável); aqui só encaminhamos a requisição.
 */
import { handleApi } from "@/server/http/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// TTS pode percorrer modelos Gemini e gerar mais de um trecho; o áudio continua cacheado depois.
export const maxDuration = 300;

const handler = (req: Request) => handleApi(req);

export { handler as GET, handler as POST, handler as PATCH, handler as DELETE };
