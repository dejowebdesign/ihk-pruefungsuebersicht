import { describe, it, expect, beforeEach } from "vitest";
import {
  canAccessPath,
  isPublicPath,
  isWithin,
  readCachedIdentity,
  writeCachedIdentity,
  clearCachedIdentity,
  roleLabel,
  IDENTITY_CACHE_KEY,
} from "@/lib/auth";

// The client-side policy must mirror the server's: participants get `/` and
// `/muendliche-pruefung*`, nothing else. These helpers only decide what the UI
// offers — the enforcement is server-side — but a mismatch would produce
// confusing dead ends, so the rules are pinned here.

beforeEach(() => {
  localStorage.clear();
});

describe("path matching", () => {
  it("matches an exact prefix", () => {
    expect(isWithin("/fragen", ["/fragen"])).toBe(true);
  });

  it("matches nested paths under a prefix", () => {
    expect(isWithin("/muendliche-pruefung/abc123", ["/muendliche-pruefung"])).toBe(true);
  });

  it("does not match a sibling that merely shares a prefix", () => {
    expect(isWithin("/fragen-archiv", ["/fragen"])).toBe(false);
    expect(isWithin("/vergleich2", ["/vergleich"])).toBe(false);
  });

  it("treats '/' as the exact root only", () => {
    expect(isWithin("/", ["/"])).toBe(true);
    expect(isWithin("/fragen", ["/"])).toBe(false);
  });
});

describe("participant access", () => {
  const allowed = ["/", "/muendliche-pruefung", "/muendliche-pruefung/exam-1"];

  for (const path of allowed) {
    it(`allows the participant ${path}`, () => {
      expect(canAccessPath("participant", path)).toBe(true);
    });
  }

  const blocked = [
    "/ihk/abc",
    "/fragen",
    "/fallbeispiele",
    "/vergleich",
    "/admin",
    "/admin/users",
  ];

  for (const path of blocked) {
    it(`blocks the participant ${path}`, () => {
      expect(canAccessPath("participant", path)).toBe(false);
    });
  }
});

describe("admin access", () => {
  const paths = [
    "/",
    "/muendliche-pruefung",
    "/muendliche-pruefung/x",
    "/ihk/abc",
    "/fragen",
    "/fallbeispiele",
    "/vergleich",
    "/admin",
    "/admin/users",
  ];

  for (const path of paths) {
    it(`allows the admin ${path}`, () => {
      expect(canAccessPath("admin", path)).toBe(true);
    });
  }
});

describe("public routes", () => {
  it("only /login is public", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/fragen")).toBe(false);
  });
});

describe("identity cache", () => {
  it("round-trips a valid identity", () => {
    writeCachedIdentity({ id: "u1", username: "anna", role: "participant", active: true });
    expect(readCachedIdentity()).toEqual({
      id: "u1",
      username: "anna",
      role: "participant",
      active: true,
    });
  });

  it("returns null when nothing is cached", () => {
    expect(readCachedIdentity()).toBeNull();
  });

  it("ignores corrupt cache content", () => {
    localStorage.setItem(IDENTITY_CACHE_KEY, "not-json{");
    expect(readCachedIdentity()).toBeNull();
  });

  it("rejects a cached role that is not a known role", () => {
    localStorage.setItem(
      IDENTITY_CACHE_KEY,
      JSON.stringify({ id: "u", username: "x", role: "superadmin", active: true }),
    );
    expect(readCachedIdentity()).toBeNull();
  });

  it("clears the cache", () => {
    writeCachedIdentity({ id: "u", username: "x", role: "admin", active: true });
    clearCachedIdentity();
    expect(readCachedIdentity()).toBeNull();
  });

  it("never stores a password or token field", () => {
    writeCachedIdentity({ id: "u", username: "x", role: "admin", active: true });
    const raw = localStorage.getItem(IDENTITY_CACHE_KEY)!;
    expect(raw).not.toMatch(/password|token|hash/i);
  });
});

describe("labels", () => {
  it("renders German role names", () => {
    expect(roleLabel("admin")).toBe("Administrator");
    expect(roleLabel("participant")).toBe("Teilnehmer");
  });
});
