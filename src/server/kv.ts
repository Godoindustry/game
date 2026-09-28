/**
 * Armazenamento distribuído opcional (Upstash Redis no plano gratuito, via REST).
 *
 * O jogo funciona 100% sem isto: sem as variáveis de ambiente o adapter usa memória
 * do processo, exatamente como antes. Isso mantém os testes (`npm test`) e o
 * desenvolvimento local sem nenhuma credencial.
 *
 * Por que REST e não socket: o plano gratuito do Upstash é accessado por HTTPS, o que
 * funciona em serverless sem conexão aberta. Por isso não há dependência npm nova —
 * só `fetch`.
 *
 * Por que memória continua existindo: em Vercel cada requisição pode cair numa
 * instância diferente. A memória cobre a degradação (uma instância só), e o Redis
 * cobre o caso real (todas as instâncias). Nenhum comando falha para o jogador.
 */
import { getConfig } from "./config";
import { newToken } from "./services/ids";

/** Valor guardado no KV. `null` significa "ausente" e nunca é serializado. */
export type KvValue = string | number | boolean | object | null;

type MemEntry = { value: KvValue; expiresAt: number | null };

type KvGlobal = typeof globalThis & {
  __lsKvMem?: Map<string, MemEntry>;
  __lsKvDown?: number;
};

/** Teto de entradas em memória por processo, para o fallback não vazar. */
const MEM_MAX_ENTRIES = 5_000;
const MEM_MAX_VALUE_BYTES = 256 * 1024;
/** Tempo que ignoramos o Redis depois de uma falha, para não martelar um serviço fora. */
const BACKOFF_MS = 30_000;
/** Rede: nunca seguramos uma requisição do jogador por muito tempo por causa do cache. */
const REQUEST_TIMEOUT_MS = 1_200;

function mem(): Map<string, MemEntry> {
  const g = globalThis as KvGlobal;
  g.__lsKvMem ??= new Map();
  return g.__lsKvMem;
}

/** `true` enquanto o Redis está em janela de tolerância após uma falha. */
function isDown(): boolean {
  const g = globalThis as KvGlobal;
  return typeof g.__lsKvDown === "number" && Date.now() < g.__lsKvDown;
}

function markDown(err: unknown): void {
  const g = globalThis as KvGlobal;
  g.__lsKvDown = Date.now() + BACKOFF_MS;
  // Uma vez por janela: sem poluir o log de todo request durante a indisponibilidade.
  if (g.__lsKvDown - BACKOFF_MS > 0) {
    console.warn("[kv] Redis indisponível, usando memória por", BACKOFF_MS / 1000, "s:", err instanceof Error ? err.message : err);
  }
}

function credentials(): { url: string; token: string } | null {
  const c = getConfig();
  if (!c.UPSTASH_REDIS_REST_URL || !c.UPSTASH_REDIS_REST_TOKEN) return null;
  return { url: c.UPSTASH_REDIS_REST_URL.replace(/\/+$/, ""), token: c.UPSTASH_REDIS_REST_TOKEN };
}

/** `false` no desenvolvimento e nos testes: nada sai para a rede. */
export function kvDistributed(): boolean {
  return credentials() !== null;
}

type Command = (string | number)[];

async function call(cmds: Command[]): Promise<unknown[] | null> {
  const creds = credentials();
  if (!creds || isDown()) return null;
  // Pipeline é um round-trip só — importante no custo por comando do plano gratuito.
  const url = cmds.length === 1 ? creds.url : `${creds.url}/pipeline`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(cmds),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body: unknown = await res.json();
    const list = cmds.length === 1 ? [body] : body;
    if (!Array.isArray(list)) throw new Error("resposta inesperada");
    // O Redis responde { result: ... } por comando; em pipeline devolve a lista de resultados.
    return list.map((entry) => {
      if (entry && typeof entry === "object" && "result" in entry) return (entry as { result: unknown }).result;
      if (entry && typeof entry === "object" && "error" in entry) throw new Error(String((entry as { error: unknown }).error));
      return entry;
    });
  } catch (err) {
    markDown(err);
    return null;
  }
}

// ---------- memória ----------

function memRead(key: string): KvValue {
  const store = mem();
  const hit = store.get(key);
  if (!hit) return null;
  if (hit.expiresAt !== null && Date.now() > hit.expiresAt) {
    store.delete(key);
    return null;
  }
  return hit.value;
}

function memWrite(key: string, value: KvValue, ttlSec: number | null): void {
  const store = mem();
  // Expulsão do mais antigo quando cheia (Map preserva a ordem de inserção).
  if (store.size >= MEM_MAX_ENTRIES && !store.has(key)) {
    const oldest = store.keys().next();
    if (!oldest.done) store.delete(oldest.value);
  }
  store.set(key, { value, expiresAt: ttlSec === null ? null : Date.now() + ttlSec * 1000 });
}

/** Ignora valores grandes demais para o fallback de memória (evita reter áudio na RAM). */
function tooBigForMemory(value: KvValue): boolean {
  try {
    return JSON.stringify(value).length > MEM_MAX_VALUE_BYTES;
  } catch {
    return true;
  }
}

// ---------- API pública ----------

/** Lê uma chave. Devolve `null` se não existir ou se o KV estiver indisponível. */
export async function kvGet<T extends KvValue = KvValue>(key: string): Promise<T | null> {
  const res = await call([["GET", key]]);
  if (res) {
    const raw = res[0];
    if (raw === null || raw === undefined) return null;
    try {
      return JSON.parse(String(raw)) as T;
    } catch {
      return null;
    }
  }
  return memRead(key) as T | null;
}

/** Grava uma chave. `ttlSec = null` não expira. */
export async function kvSet(key: string, value: KvValue, ttlSec: number | null = null): Promise<void> {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) return;
  // Também guardamos em memória: se o Redis cair, a instância ainda tem o valor recente.
  if (!tooBigForMemory(value)) memWrite(key, value, ttlSec);
  const cmd: Command = ttlSec === null ? ["SET", key, encoded] : ["SET", key, encoded, "EX", Math.max(1, Math.floor(ttlSec))];
  await call([cmd]);
}

/** Apaga chaves. Sem erro se não existirem. */
export async function kvDel(...keys: string[]): Promise<void> {
  if (!keys.length) return;
  const store = mem();
  for (const k of keys) store.delete(k);
  if (credentials() && !isDown()) await call(keys.map((k) => ["DEL", k] as Command));
}

/**
 * Incrementa um contador atômico e devolve o novo valor, criando a chave com
 * `ttlSec` no primeiro incremento. É o que substitui a janela do rate limit em memória.
 */
export async function kvIncr(key: string, ttlSec: number): Promise<number> {
  const res = await call([["INCR", key]]);
  if (res) {
    const n = Number(res[0] ?? 0);
    // TTL só no primeiro incremento: `EX` a cada batida estenderia a janela para sempre.
    if (n === 1) await call([["EXPIRE", key, Math.max(1, Math.floor(ttlSec))]]);
    memWrite(key, n, ttlSec);
    return n;
  }
  const current = Number(memRead(key) ?? 0) + 1;
  memWrite(key, current, ttlSec);
  return current;
}

/** Testes: limpa o fallback em memória e a janela de tolerância. */
export function resetKvForTests(): void {
  const g = globalThis as KvGlobal;
  g.__lsKvMem = new Map();
  g.__lsKvDown = undefined;
  (globalThis as MemList).__lsKvLists = new Map();
}

/**
 * Tenta uma trava distribuída. Devolve o token se bequeceu, ou `null` se outra
 * instância já está fazendo o trabalho. O TTL impede trava órfã se o processo cair.
 */
export async function kvLock(key: string, ttlMs: number): Promise<string | null> {
  const token = newToken(12);
  const res = await call([["SET", key, token, "NX", "PX", Math.max(1, Math.floor(ttlMs))]]);
  if (res) return res[0] === "OK" ? token : null;
  // Na memória o processo já é o único, então a trava é sempre nossa: quem já
  // estava gerando localmente é justamente quem deve continuar.
  const held = mem().get(key);
  if (held) return null;
  mem().set(key, { value: token, expiresAt: Date.now() + ttlMs });
  return token;
}

/** Solta a trava só se ainda for nossa (evita apagar a de quem estourou o timeout). */
export async function kvUnlock(key: string, token: string): Promise<void> {
  const script = "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end";
  const res = await call([["EVAL", script, "1", key, token]]);
  if (!res) {
    const held = mem().get(key);
    if (held?.value === token) mem().delete(key);
  }
}

// ---------- listas (filas de passagem) ----------

/**
 * Anexa valores ao fim da lista, mantendo no máximo `max` itens (os mais antigos caem).
 * É `RPUSH` + `EXPIRE` + `LTRIM` dentro de um script: um comando só, e sem janela em que
 * outra pessoa sinalizando ao mesmo tempo consiga ler ou apagar o que acabou de entrar.
 */
const LIST_APPEND_LUA = `
local ttl = tonumber(ARGV[1])
local max = tonumber(ARGV[2])
for i = 3, #ARGV do redis.call('RPUSH', KEYS[1], ARGV[i]) end
redis.call('EXPIRE', KEYS[1], ttl)
redis.call('LTRIM', KEYS[1], -max, -1)
return 1
`;

/** Lê e apaga no mesmo comando, para que um sinal seja entregue uma única vez. */
const LIST_TAKE_LUA = `
local items = redis.call('LRANGE', KEYS[1], 0, tonumber(ARGV[1]) - 1)
redis.call('DEL', KEYS[1])
return items
`;

/** Anexa valores ao fim da lista, criando-a com `ttlSec` se ainda não existir. */
export async function kvListPush(key: string, values: KvValue[], ttlSec: number): Promise<void> {
  await kvListAppend(key, values, ttlSec, Number.MAX_SAFE_INTEGER);
}

/**
 * Anexa ao fim sem perder o que já estava na fila — o jeito certo de encaminhar um sinal
 * para alguém. Fazer `take` e depois `push` de volta abriria uma janela em que o sinal do
 * vizinho desapareceria.
 */
export async function kvListAppend(key: string, values: KvValue[], ttlSec: number, max: number): Promise<void> {
  if (!values.length) return;
  const encoded = values.map((v) => JSON.stringify(v));
  const res = await call([["EVAL", LIST_APPEND_LUA, "1", key, String(Math.max(1, Math.floor(ttlSec))), String(Math.max(1, max)), ...encoded]]);
  if (res) return;
  memListPush(key, values, ttlSec, max);
}

/** Lê até `max` itens e apaga a lista em seguida — entrega cada sinal uma única vez. */
export async function kvListTake<T extends KvValue = KvValue>(key: string, max: number): Promise<T[]> {
  const res = await call([["EVAL", LIST_TAKE_LUA, "1", key, String(Math.max(1, max))]]);
  if (res) return ((res[0] as unknown[]) ?? []).map(parseEntry).filter((v): v is T => v !== null);
  return memListTake(key, max) as T[];
}

function parseEntry(raw: unknown): KvValue {
  if (raw === null || raw === undefined) return null;
  try {
    return JSON.parse(String(raw)) as KvValue;
  } catch {
    return null;
  }
}

type MemList = typeof globalThis & { __lsKvLists?: Map<string, MemEntry> };

function memLists(): Map<string, MemEntry> {
  const g = globalThis as MemList;
  g.__lsKvLists ??= new Map();
  return g.__lsKvLists;
}

function memListPush(key: string, values: KvValue[], ttlSec: number, max = Number.MAX_SAFE_INTEGER): void {
  const store = memLists();
  if (store.size >= MEM_MAX_ENTRIES && !store.has(key)) {
    const oldest = store.keys().next();
    if (!oldest.done) store.delete(oldest.value);
  }
  const current = store.get(key);
  const list = Array.isArray(current?.value) ? (current.value as KvValue[]) : [];
  list.push(...values);
  // Mesma regra do LTRIM do Redis: preserva os `max` mais novos.
  const capped = max === Number.MAX_SAFE_INTEGER ? list : list.slice(-max);
  store.set(key, { value: capped, expiresAt: Date.now() + ttlSec * 1000 });
}

function memListTake(key: string, max: number): KvValue[] {
  const store = memLists();
  const hit = store.get(key);
  if (!hit || (hit.expiresAt !== null && Date.now() > hit.expiresAt)) {
    store.delete(key);
    return [];
  }
  const list = Array.isArray(hit.value) ? (hit.value as KvValue[]) : [];
  const out = list.slice(0, max);
  if (out.length === list.length) store.delete(key);
  else store.set(key, { value: list.slice(out.length), expiresAt: hit.expiresAt });
  return out;
}

