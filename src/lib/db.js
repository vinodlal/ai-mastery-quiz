// Minimal promise-based IndexedDB wrapper. No dependencies.
// Stores: kv (settings/meta), concepts (scheduler state), answers (log), sessions (daily/final results).
const DB_NAME = "ai-mastery-quiz";
const DB_VERSION = 1;

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("concepts")) db.createObjectStore("concepts", { keyPath: "conceptId" });
      if (!db.objectStoreNames.contains("answers")) db.createObjectStore("answers", { autoIncrement: true });
      if (!db.objectStoreNames.contains("sessions")) db.createObjectStore("sessions", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function kvGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = db.transaction("kv").objectStore("kv").get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function kvSet(key, value) {
  const db = await openDB();
  return tx(db, "kv", "readwrite", (s) => s.put(value, key));
}

export async function getAll(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = db.transaction(store).objectStore(store).getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  });
}

export async function putRecord(store, record) {
  const db = await openDB();
  return tx(db, store, "readwrite", (s) => s.put(record));
}

export async function addRecord(store, record) {
  const db = await openDB();
  return tx(db, store, "readwrite", (s) => s.add(record));
}

export async function clearStore(store) {
  const db = await openDB();
  return tx(db, store, "readwrite", (s) => s.clear());
}

// ---- export / import (backup against iOS 7-day storage eviction) ----
export async function exportAll() {
  const [concepts, answers, sessions] = await Promise.all([
    getAll("concepts"), getAll("answers"), getAll("sessions"),
  ]);
  const kvKeys = ["settings", "meta"];
  const kv = {};
  for (const k of kvKeys) kv[k] = await kvGet(k);
  return {
    app: "ai-mastery-quiz",
    schema: DB_VERSION,
    exportedAt: new Date().toISOString(),
    kv, concepts, answers, sessions,
  };
}

export async function importAll(data) {
  if (!data || data.app !== "ai-mastery-quiz") throw new Error("Not a valid AI Mastery backup file.");
  await Promise.all([clearStore("concepts"), clearStore("answers"), clearStore("sessions")]);
  for (const c of data.concepts || []) await putRecord("concepts", c);
  const db = await openDB();
  await tx(db, "answers", "readwrite", (s) => { for (const a of data.answers || []) s.add(a); });
  for (const s of data.sessions || []) await putRecord("sessions", s);
  for (const [k, v] of Object.entries(data.kv || {})) if (v !== undefined) await kvSet(k, v);
}
