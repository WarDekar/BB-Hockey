import { useCallback, useEffect, useRef, useState } from "react";
import { getJson } from "./lib/api";
import { socket } from "./lib/socket";

export interface Loaded<T> { data: T | null; error: string | null; loading: boolean; reload: () => void; at: number }

// Last payload per path, kept for the session: a tab that remounts renders it at once and refreshes in the
// background (stale-while-revalidate) instead of showing "Loading…" while the whole board downloads again.
const cache = new Map<string, { data: unknown; at: number }>();
/** A timer tick or a worker push inside this window after a completed load is skipped (both fire about once a minute). */
const COALESCE_MS = 15_000;

/** GET on mount (from cache first when there is one), again every `every` ms, and whenever the worker pushes an update. */
export function useApi<T>(path: string | null, every = 0, live = true): Loaded<T> {
  const hit = path ? cache.get(path) : undefined;
  const [data, setData] = useState<T | null>((hit?.data as T | undefined) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [at, setAt] = useState(hit?.at ?? 0);
  const tick = useRef(0);
  const load = useCallback((force = true) => {
    if (!path) return;
    const last = cache.get(path)?.at ?? 0;
    if (!force && Date.now() - last < COALESCE_MS) return;
    const id = ++tick.current;
    setLoading(true);
    getJson<T>(path)
      .then((d) => { const now = Date.now(); cache.set(path, { data: d, at: now }); if (id === tick.current) { setData(d); setError(null); setAt(now); } })
      .catch((e: Error) => { if (id === tick.current) setError(e.message); })
      .finally(() => { if (id === tick.current) setLoading(false); });
  }, [path]);
  useEffect(() => {
    if (!path) return;
    const c = cache.get(path);
    if (c) { setData(c.data as T); setAt(c.at); setError(null); }
    else { setData(null); setAt(0); }
    load(false);
  }, [load, path]);
  useEffect(() => {
    if (!every || !path) return;
    const t = setInterval(() => load(false), every);
    return () => clearInterval(t);
  }, [every, load, path]);
  useEffect(() => {
    if (!live || !path) return;
    const s = socket();
    const h = () => load(false);
    s.on("update", h);
    return () => { s.off("update", h); };
  }, [live, load, path]);
  return { data, error, loading, reload: () => load(true), at };
}

export function useHash(): [string, (h: string) => void] {
  const [hash, setHash] = useState(() => window.location.hash.slice(1));
  useEffect(() => {
    const h = () => setHash(window.location.hash.slice(1));
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);
  return [hash, (h: string) => { window.location.hash = h; }];
}
