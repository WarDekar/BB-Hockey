// The board store: every evaluated quote and the slate, fetched once per browser session (GET /board), then kept
// current by the worker's per-pass `board` socket deltas (only the rows that moved) and persisted in IndexedDB so a
// reload paints at once from the last copy. A delta out of sequence (missed while disconnected) or a server restart
// (new `boot`) triggers one resync fetch. Filters stay in localStorage; this data is too big for it (MBs) and the
// IndexedDB write is asynchronous and structured (no JSON.stringify on every pass).
import { useEffect, useState } from "react";
import type { Edge, SlateRow } from "./api";
import { getJson } from "./api";
import { socket } from "./socket";

interface Version { boot: string; seq: number; at: string | null }
interface Delta extends Version { edges_upsert: Edge[]; edges_delete: string[]; slate_upsert: SlateRow[]; slate_delete: number[] }
interface Snapshot extends Version { edges: Edge[]; slate: SlateRow[] }
interface Stored extends Version { edges: Edge[]; slate: SlateRow[]; savedAt: number }

const edges = new Map<string, Edge>();
const slate = new Map<number, SlateRow>();
let version: Version = { boot: "", seq: -1, at: null };
let ready = false;             // something to paint (from IndexedDB or the server)
let synced = false;            // the server copy has been applied this session
let error: string | null = null;
let gen = 0;                   // bumps on every change; hooks re-render on it
const listeners = new Set<() => void>();
const notify = () => { gen++; listeners.forEach((l) => l()); };

// --- IndexedDB (one object store, one record) -------------------------------------------------------------------
const DB = "bbh_board", STORE = "kv", REC = "board";
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    } catch (e) { rej(e); }
  });
}
async function idbRead(): Promise<Stored | null> {
  try {
    const db = await idb();
    return await new Promise((res, rej) => {
      const r = db.transaction(STORE, "readonly").objectStore(STORE).get(REC);
      r.onsuccess = () => res((r.result as Stored) ?? null); r.onerror = () => rej(r.error);
    });
  } catch { return null; }
}
let saveTimer: number | null = null;
function scheduleSave() {
  if (saveTimer !== null) return;
  saveTimer = window.setTimeout(async () => {
    saveTimer = null;
    try {
      const db = await idb();
      const rec: Stored = { ...version, edges: [...edges.values()], slate: [...slate.values()], savedAt: Date.now() };
      db.transaction(STORE, "readwrite").objectStore(STORE).put(rec, REC);
    } catch { /* private mode or quota: the session copy still works */ }
  }, 2000);
}

// --- applying ----------------------------------------------------------------------------------------------------
function replaceAll(s: Snapshot) {
  edges.clear(); slate.clear();
  for (const r of s.edges) edges.set(r.key, r);
  for (const g of s.slate) slate.set(g.id, g);
  version = { boot: s.boot, seq: s.seq, at: s.at };
}
function applyDelta(d: Delta) {
  for (const r of d.edges_upsert) edges.set(r.key, r);
  for (const k of d.edges_delete) edges.delete(k);
  for (const g of d.slate_upsert) slate.set(g.id, g);
  for (const id of d.slate_delete) slate.delete(id);
  version = { boot: d.boot, seq: d.seq, at: d.at };
}

let resyncing: Promise<void> | null = null;
/** One full fetch; coalesced so a burst of out-of-sequence deltas costs one request. */
export function resync(): Promise<void> {
  if (!resyncing) {
    resyncing = getJson<Snapshot>("/board").then((s) => {
      replaceAll(s); ready = true; synced = true; error = null; notify(); scheduleSave();
    }).catch((e: Error) => { error = e.message; notify(); }).finally(() => { resyncing = null; });
  }
  return resyncing;
}

let started = false;
function start() {
  if (started) return;
  started = true;
  idbRead().then((rec) => {
    if (rec && !synced) {          // paint the last copy at once; the server copy or deltas replace it
      replaceAll({ boot: rec.boot, seq: rec.seq, at: rec.at, edges: rec.edges, slate: rec.slate });
      ready = true; notify();
    }
    // Resume from the stored version only when the server is still on the same boot and has emitted nothing since;
    // otherwise fetch. (Deltas carry whole rows, so one that overlaps the fetch re-applies harmlessly.)
    getJson<Version>("/board/version").then((v) => {
      if (rec && v.boot === rec.boot && v.seq === rec.seq) { synced = true; notify(); } else void resync();
    }).catch(() => void resync());
  });
  const s = socket();
  s.on("board", (d: Delta) => {
    if (d.boot === version.boot && d.seq === version.seq + 1) { applyDelta(d); notify(); scheduleSave(); }
    else if (d.boot === version.boot && d.seq <= version.seq) { /* already have it */ }
    else void resync();
  });
  s.io.on("reconnect", () => {   // deltas may have been missed while away
    getJson<Version>("/board/version").then((v) => { if (v.boot !== version.boot || v.seq !== version.seq) void resync(); }).catch(() => undefined);
  });
}

export interface BoardData { edges: Edge[]; slate: SlateRow[]; ready: boolean; synced: boolean; error: string | null; at: string | null; reload: () => void }

/** The live board. Call once at the root; arrays are rebuilt only when something changed (`gen`). */
export function useBoard(): BoardData {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    start();
    return () => { listeners.delete(l); };
  }, []);
  return cached(gen);
}

let cachedGen = -1;
let cachedOut: BoardData | null = null;
function cached(g: number): BoardData {
  if (cachedOut && cachedGen === g) return cachedOut;
  cachedGen = g;
  cachedOut = {
    edges: [...edges.values()].sort((a, b) => b.ev - a.ev),
    slate: [...slate.values()].sort((a, b) => a.game_time.localeCompare(b.game_time) || a.id - b.id),
    ready, synced, error, at: version.at, reload: () => void resync(),
  };
  return cachedOut;
}
