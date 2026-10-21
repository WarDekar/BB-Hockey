// Team identity store: the 32 clubs with BB-Odds's ESPN logo URL and colours, fetched once
// from /teams and shared by every surface. BB-Odds is the fleet's identity source (ADR-002
// in BB-Futures): logos are resolved at read time, never hand-kept here. Name-only rows
// (edges, bets, finals) resolve through this store by abbreviation.
import { useEffect, useState } from "react";
import { getJson } from "./api";

export interface TeamIdentity { abbr: string; nhl_abbr: string; city: string; nickname: string; name: string; logo_url: string | null; color: string | null; alt_color: string | null }

let cache: Record<string, TeamIdentity> | null = null;
let inflight: Promise<Record<string, TeamIdentity>> | null = null;
const listeners = new Set<() => void>();

export function loadTeams(): Promise<Record<string, TeamIdentity>> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = getJson<TeamIdentity[]>("/teams").then((rows) => {
      cache = Object.fromEntries(rows.map((r) => [r.abbr, r]));
      listeners.forEach((l) => l());
      return cache;
    }).catch((e) => { inflight = null; throw e; });
  }
  return inflight;
}

/** Re-renders the caller once the identities land; returns the store (empty until then). */
export function useTeams(): Record<string, TeamIdentity> {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    loadTeams().catch(() => undefined);
    return () => { listeners.delete(l); };
  }, []);
  return cache ?? {};
}

export const teamOf = (abbr: string | null | undefined): TeamIdentity | null => (abbr && cache ? cache[abbr] ?? null : null);
