"use client";

const DB_NAME = "vale-silente-voice-v1";
const DB_VERSION = 1;
const AUDIO_STORE = "audio";
const ALIAS_STORE = "aliases";

interface AudioEntry {
  key: string;
  blob: Blob;
  createdAt: number;
}

interface AliasEntry {
  key: string;
  audioKey: string;
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(AUDIO_STORE)) db.createObjectStore(AUDIO_STORE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(ALIAS_STORE)) db.createObjectStore(ALIAS_STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function get<T>(store: IDBObjectStore, key: string): Promise<T | null> {
  return new Promise((resolve) => {
    const request = store.get(key);
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
    request.onerror = () => resolve(null);
  });
}

export async function cachedVoice(requestKey: string): Promise<Blob | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    const tx = db.transaction([AUDIO_STORE, ALIAS_STORE], "readonly");
    const alias = await get<AliasEntry>(tx.objectStore(ALIAS_STORE), requestKey);
    if (!alias) return null;
    return (await get<AudioEntry>(tx.objectStore(AUDIO_STORE), alias.audioKey))?.blob ?? null;
  } finally {
    db.close();
  }
}

export async function storeVoice(requestKey: string, audioKey: string, blob: Blob): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction([AUDIO_STORE, ALIAS_STORE], "readwrite");
      tx.objectStore(AUDIO_STORE).put({ key: audioKey, blob, createdAt: Date.now() } satisfies AudioEntry);
      tx.objectStore(ALIAS_STORE).put({ key: requestKey, audioKey } satisfies AliasEntry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } finally {
    db.close();
  }
}
