import { useCallback, useEffect, useRef, useState } from "react";
import { getJson } from "./lib/api";
import { socket } from "./lib/socket";

export interface Loaded<T> { data: T | null; error: string | null; loading: boolean; reload: () => void; at: number }

/** GET on mount, again every `every` ms, and whenever the worker pushes an update. */
export function useApi<T>(path: string | null, every = 0, live = true): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [at, setAt] = useState(0);
  const tick = useRef(0);
  const load = useCallback(() => {
    if (!path) return;
    const id = ++tick.current;
    setLoading(true);
    getJson<T>(path)
      .then((d) => { if (id === tick.current) { setData(d); setError(null); setAt(Date.now()); } })
      .catch((e: Error) => { if (id === tick.current) setError(e.message); })
      .finally(() => { if (id === tick.current) setLoading(false); });
  }, [path]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!every || !path) return;
    const t = setInterval(load, every);
    return () => clearInterval(t);
  }, [every, load, path]);
  useEffect(() => {
    if (!live || !path) return;
    const s = socket();
    const h = () => load();
    s.on("update", h);
    return () => { s.off("update", h); };
  }, [live, load, path]);
  return { data, error, loading, reload: load, at };
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
