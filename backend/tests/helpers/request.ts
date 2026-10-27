// Test helper for authenticated API calls.
//
// The API gate in src/api/app.ts requires an identity for everything except
// /api, /api/health, /api/auth/* and the legacy /api/admin surface. Tests that
// exercise normal read paths therefore need credentials; `authedRequest` adds
// the legacy ADMIN_TOKEN as a Bearer token unless the caller already supplied
// an Authorization/Cookie header (so negative tests keep testing what they
// mean to test).

import type { createApp } from "../../src/api/app";

type App = ReturnType<typeof createApp>;

export function makeRequester(app: App, token: string) {
  return function request(path: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers as HeadersInit | undefined);
    if (!headers.has("authorization") && !headers.has("cookie")) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    return app.request(path, { ...init, headers });
  };
}
