"use client";
// Cached-identity hook.
//
// The server is the authority on who you are; this hook only mirrors the
// identity the server last confirmed so the header can render role-aware
// navigation. `refresh()` re-asks the server and clears the cache when the
// session is gone (e.g. the account was deactivated mid-session).

import { useCallback, useEffect, useState } from "react";
import { api, type AuthUser } from "./api";
import {
  readCachedIdentity,
  writeCachedIdentity,
  clearCachedIdentity,
  subscribeIdentity,
} from "./auth";

export function useIdentity() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { user: fresh } = await api.me();
      writeCachedIdentity(fresh);
      return fresh;
    } catch {
      clearCachedIdentity();
      return null;
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    // Render instantly from cache, then confirm with the server.
    setUser(readCachedIdentity());
    // Keep every mounted consumer in sync — a login on /login must update the
    // header in the same tab without a reload.
    const unsubscribe = subscribeIdentity(setUser);
    void refresh();
    return unsubscribe;
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      clearCachedIdentity();
    }
  }, []);

  return { user, loaded, refresh, logout };
}
